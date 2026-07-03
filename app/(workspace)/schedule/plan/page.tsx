"use client";

/**
 * 공정계획 위저드 — PM 4단계 + 휴먼인더루프 (md/strategy/pm_philosophy_4stages.md).
 *
 *   [1 입력·스코프] → P2 생성 → [2 Gate A: 액티비티 검토·수정] → P3+P4
 *   → [3 Gate B: 관계·기간 검토·수정] → S1 CPM → [4 Gate C: 간트 확인·확정] → P6 XML
 *
 * AI = 초안 제안, PM = 각 게이트에서 컨펌·수정 (사람이 진실원천).
 * 원샷 데모는 /schedule/generate (PoC 보존). 디자인 언어는 generate 와 동일(styled-jsx·slate).
 */
import { type FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  cancelPlan, confirmPlan, extractIfcWorkUnitsViaS3, getPlan, inferScheduleContext, recommendWbs, wbsFromText, planP6XmlDownloadUrl, planXerUrl, riskBrief, planAudit, planAuditFix, planAuditLoop, getBasis, getWeatherRates, type BasisResult, type AuditFinding, type IfcWorkUnitsResult,
  savePlanActivities, startPlan, ScheduleApiError, parseBoq, boqBrief,
  type GanttTask, type GenMilestone, type GenWorkUnit, type PlanActivity, type PlanScopeWbs, type PlanStage, type PlanState, type ScheduleRisk, type BoqResult,
} from "../../../../lib/api/schedule";
import { classifyIfcType, normStorey } from "../../../../lib/fourd/match";
import { savePlanIfcs } from "../../../../lib/fourd/fileCache";
import GanttChartRaw from "../../../../components/process/GanttChart";

const GanttChart = GanttChartRaw as unknown as FC<{ tasks: GanttTask[]; height?: number; viewMode?: string; fillWidth?: boolean }>;

// 멀티파싱 임포트 — 공종(디시플린) 슬롯. 순서 = 시공 시퀀스(토목→구조→건축→MEP→조경→가설).
// active=공정 엔진 보유(토목 civil / 구조 LLM / 건축 architecture / MEP mep / 조경 landscape = 6공종 완전체).
// 가설만 잠금(오버레이 — 납품물 아님).
// 넣은 공종만 공정표에 반영(구독형) — 단일이면 그 공종, 복수면 병합(2·3단계).
const DISCIPLINES: { key: string; label: string; icon: string; active: boolean; hint: string }[] = [
  // 종합 = REV 같은 전 공종 1파일 → PSet Trade + IFC 타입으로 토목/구조/건축 자동 분리 후 순서대로 생성.
  { key: "종합", label: "종합", icon: "🗂️", active: true, hint: "전 공종 1파일(REV 등) — 자동 분리" },
  { key: "토목", label: "토목", icon: "🏗️", active: true, hint: "굴착·흙막이" },
  { key: "구조", label: "구조", icon: "🏢", active: true, hint: "골조" },
  { key: "건축", label: "건축", icon: "🧱", active: true, hint: "마감(조적·창호·타일·도장…)" },
  { key: "MEP", label: "MEP", icon: "🔧", active: true, hint: "기계·소방·전기·통신(설비)" },
  { key: "조경", label: "조경", icon: "🌳", active: true, hint: "식재·포장·시설물" },
  { key: "가설", label: "가설", icon: "🚧", active: true, hint: "비계·동바리·펜스(오버레이)" },
];

// 슬롯 검증 — 업로드 파일의 공종 분포(서버 discipline_summary, 흙막이 보정 후)가 슬롯과 맞는지.
// 가설은 오버레이(납품물 아님)라 '주공종' 판정에서 제외 → 토목+가설 합본을 토목 슬롯에 넣어도 OK,
// 가설 비중만 정보로 안내. 슬롯에 엉뚱한 파일(구조→토목 슬롯)이면 경고 = 분리 작업 QA 도구.
const SCHEDULABLE = ["토목", "구조", "건축", "MEP", "조경"];
function validateSlot(slot: string, summary?: { discipline: string; count: number }[]): string | null {
  if (slot === "종합") { // 종합 = 전 공종 허용 → 경고 X. 구성만 정보로 안내.
    if (!summary?.length) return null;
    const top = [...summary].filter((d) => SCHEDULABLE.includes(d.discipline)).sort((a, b) => b.count - a.count);
    return top.length ? `ℹ️ 종합 — ${top.map((d) => `${d.discipline} ${d.count.toLocaleString()}`).join(" · ")} (자동 분리)` : null;
  }
  if (!summary || !summary.length) return null; // 클라 파싱 폴백 등 — 분포 없음 → 검증 생략
  const m: Record<string, number> = {};
  for (const d of summary) m[d.discipline] = d.count;
  const schedTotal = SCHEDULABLE.reduce((s, k) => s + (m[k] || 0), 0) + (m["가설"] || 0);
  if (schedTotal === 0) return `⚠️ ${slot} 공정 부재가 없습니다 — 슬롯이 맞나요?`;
  // 무PSet 정상 오분류 보정 — 슬롯별 '호환' 공종. 흙막이 기둥→구조, 마감 벽/슬래브→구조, 버팀보/거푸집→가설.
  // (검증으로 확인: 무PSet 토목/건축은 분류기가 구조로 봄 → 슬롯이 진실이므로 호환으로 처리)
  const COMPAT: Record<string, string[]> = {
    토목: ["토목", "구조", "가설"], 구조: ["구조", "가설"], 건축: ["건축", "구조", "가설"],
    MEP: ["MEP"], 조경: ["조경", "토목"],
  };
  // 타입이 확실한 공종(창호/문→건축, 배관/덕트→MEP, 식재→조경) — 오분류 적어 '슬롯 의심'의 강한 신호.
  const RELIABLE = ["건축", "MEP", "조경"];
  const compat = COMPAT[slot] ?? [slot];
  const slotN = m[slot] || 0;
  // 슬롯과 무관한 '타입 확실' 공종 비율 — 30%+ 면 진짜 잘못된 파일 의심(창호 파일을 토목 슬롯에 등 실수).
  const badN = RELIABLE.filter((d) => !compat.includes(d)).reduce((s, k) => s + (m[k] || 0), 0);
  if (badN >= schedTotal * 0.3) {
    let dom = slot, domN = slotN;
    for (const k of SCHEDULABLE) if ((m[k] || 0) > domN) { dom = k; domN = m[k] || 0; }
    return `⚠️ ${dom} 부재가 많습니다 (${slot} 슬롯) — 파일/슬롯을 확인하세요`;
  }
  // 슬롯 공종이 직접은 적지만 무PSet상 구조/가설로 분류된 경우 — 경고 아닌 안내(슬롯 기준 정상 처리).
  const compatN = compat.reduce((s, k) => s + (m[k] || 0), 0);
  if (slotN < compatN * 0.5 && compat.includes("구조")) {
    return `ℹ️ 무PSet 파일 — 일부가 구조로 분류되나 ${slot} 슬롯 기준으로 처리됩니다`;
  }
  return null;
}

// 파일명에서 프로젝트 키 추출 — 끝의 공종 토큰·복사본 접미·확장자 제거. 슬롯 간 다른 프로젝트 검출용.
// (IFC 내부명은 'Default' 등 기본값이 많아 신뢰도 낮음 → 파일명이 더 확실한 신호)
function projectKey(filename: string): string {
  let s = filename.replace(/\.[^.]+$/, "").replace(/\s*\(\d+\)\s*$/, "").trim();
  const m = s.match(/^(.*?)[_\-\s]+(종합|토목|구조|건축|mep|조경|가설|stru\w*|arch\w*|civil\w*|struct\w*|landscape\w*|temp\w*)[\w\-]*$/i);
  if (m && m[1].trim()) s = m[1];
  return s.trim().toLowerCase();
}

let _ganttLoad: Promise<void> | null = null;
function loadFrappeGantt(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if ((window as unknown as { Gantt?: unknown }).Gantt) return Promise.resolve();
  if (_ganttLoad) return _ganttLoad;
  _ganttLoad = new Promise<void>((resolve, reject) => {
    if (!document.querySelector("link[data-frappe-gantt]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet"; link.href = "/libs/frappe-gantt.css"; link.setAttribute("data-frappe-gantt", "1");
      document.head.appendChild(link);
    }
    const s = document.createElement("script");
    s.src = "/libs/frappe-gantt.umd.js"; s.onload = () => resolve(); s.onerror = () => reject(new Error("gantt 로드 실패"));
    document.body.appendChild(s);
  });
  return _ganttLoad;
}

// 공정 플래닝 세부 5단계 (회사 노하우 — pm_philosophy_4stages.md)
const PLAN_SUBS = ["WBS 생성", "액티비티 정의", "액티비티 리스트", "릴레이션", "듀레이션"] as const;

/** 플래닝 서브스텝 진행수 — progress 의 "[n/5]" 를 파싱 (백엔드 노드가 정확히 표기) */
const subDone = (st: PlanStage | null, progress?: string | null): number => {
  if (!st) return 0;
  if (st !== "running_p2") return 5;                        // 플래닝 완료 이후
  const m = /\[(\d)\/5\]/.exec(progress ?? "");
  return m ? Math.max(0, Number(m[1]) - 1) : 1;             // [n/5] 진행 중 = n-1 완료
};

/** 대단계: 0=입력, 1=플래닝(진행·검토), 2=스케줄링 */
const bigStep = (st: PlanStage | null, hasPlan: boolean): number =>
  !hasPlan ? 0 : st === "scheduled" || st === "done" ? 2 : 1;

// 진행 중 계획 체크포인트 — 페이지 이동/새로고침 후 돌아와도 이어서 (URL ?plan= 과 이중 안전망)
const PLAN_CKPT = "clm.schedule.plan.active";

const OP_KO: Record<string, string> = { FT: "기초", CR: "코어/골조", MD: "슬래브/모듈", PR: "마감" };
// 공종 자동 가동률(CPE 벤치마킹 — 기상 민감도 기반 추정. 기상 데이터 연동 시 정밀화). 비우면 이 값 자동 적용.
// 공종별 기상 임계 프리셋(CPE 벤치마킹) — 플레이스홀더(비우면 이 값 자동). [동절기최저℃, 혹서최고℃, 강우mm, 강설cm, 풍속m/s]
const THRESH_PRESET: Record<string, [string, string, string, string, string]> = {
  종합: ["-5", "35", "10", "1", "15"], 토목: ["-10", "35", "10", "5", "15"], 구조: ["-5", "35", "10", "1", "15"],
  건축: ["", "35", "50", "5", "20"], MEP: ["", "35", "50", "5", "20"], 조경: ["-5", "33", "10", "1", "15"], 가설: ["-10", "35", "20", "5", "15"],
};
const PH_KO: Record<string, string> = { RB: "철근", FM: "거푸집", CN: "콘크리트", IN: "설치" };

// 공종 자동 가동률(공정분류별, CPE 벤치마킹) — 백엔드 scheduling.py disc_util 과 동일. 검토 표시용.
const UTIL_PRESET: { cat: string; val: number; note: string }[] = [
  { cat: "타설", val: 0.68, note: "추위·비에 가장 취약" },
  { cat: "골조", val: 0.78, note: "외부 골조작업" },
  { cat: "토공", val: 0.80, note: "굴착·되메우기" },
  { cat: "외부마감", val: 0.78, note: "외장·옥외 노출" },
  { cat: "내부습식", val: 0.80, note: "미장·타일·방수" },
  { cat: "내부건식", val: 0.92, note: "실내 건식·설비" },
  { cat: "양생", val: 1.0, note: "날씨 무관(대기·감리)" },
];

// 기상관측소(ASOS) 지역 — 가동률 실측 정밀화용. 검토 카드 + 폼 공용.
const WEATHER_REGIONS = ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "수원", "청주", "전주", "강릉", "춘천", "포항", "창원", "제주", "목포", "여수", "안동", "대관령"];

// 구조유형 → 거푸집·시공전략 권장(검토용 — 사람이 아래 드롭다운으로 수정).
function recommendForm(structType: string, hasBasement: boolean): { formwork: string; strategy: string } {
  const st = structType || "";
  let formwork = "유로폼 (재래식급)";
  if (st.includes("모듈러") || st.includes("PC")) formwork = "공장제작 (현장 거푸집 최소)";
  else if (st.includes("SRC") || st.includes("철골")) formwork = "데크플레이트 (합성 슬래브) + 코어 갱폼";  // SRC가 'RC' 포함 → RC보다 먼저
  else if (st.includes("RC")) formwork = "알폼 (아파트 골조 사이클 단축)";
  return { formwork, strategy: hasBasement ? "순타·일괄 (지하 깊으면 역타 검토)" : "순타·일괄" };
}

// WBS 미리보기 — work_units 메타로 트리 구성(날짜 불필요). 백엔드 wbs_structure.py 미러.
const _DISC_KO_W: Record<string, string> = { EARTHWORK: "토목", FOUNDATION: "기초", STRUCTURE: "구조", TEMPORARY: "가설", ARCHITECTURE: "건축", MEP: "MEP", LANDSCAPE: "조경" };
const _PHASE_KO_W: Record<string, string> = { EARTHWORK: "토공·기초", FOUNDATION: "토공·기초", STRUCTURE: "골조", TEMPORARY: "가설", ARCHITECTURE: "마감·설비", MEP: "마감·설비", LANDSCAPE: "마감·설비" };
const _mainZoneW = (z: string) => (z || "").replace(/[-_ .]?\d+$/, "").trim() || "-";
const WBS_PRESETS_W: Record<string, string[]> = { zone: ["zone", "trade"], trade: ["trade", "zone"], sequence: ["phase", "zone"], storey: ["storey", "zone", "trade"], trade_detail: ["trade", "zone", "storey"] };
function resolveWbsKeysW(s: string): string[] {
  if (WBS_PRESETS_W[s]) return WBS_PRESETS_W[s];
  const ks = (s || "").split(/[>,\s]+/).filter((k) => ["zone", "storey", "trade", "phase", "stage"].includes(k));
  return ks.length ? ks : WBS_PRESETS_W.zone;
}
function wbsKeyValW(w: { zone?: string; storey?: string; discipline?: string }, k: string): string {
  if (k === "zone") return _mainZoneW(w.zone || "");
  if (k === "storey") return w.storey || "-";
  if (k === "trade") return _DISC_KO_W[(w.discipline || "").toUpperCase()] || w.discipline || "공종";
  if (k === "phase") return _PHASE_KO_W[(w.discipline || "").toUpperCase()] || w.discipline || "공통";
  return "-";
}
type WbsNode = { count: number; children: Record<string, WbsNode> };
function buildWbsTree(units: { zone?: string; storey?: string; discipline?: string; count?: number }[], keys: string[]): WbsNode {
  const root: WbsNode = { count: 0, children: {} };
  for (const u of units) {
    let node = root; root.count += u.count || 1;
    for (const k of keys) {
      const v = wbsKeyValW(u, k);
      if (v === "-") continue;
      node.children[v] = node.children[v] || { count: 0, children: {} };
      node = node.children[v]; node.count += u.count || 1;
    }
  }
  return root;
}
function flattenWbsTree(node: WbsNode, depth = 0, maxBranch = 6): { depth: number; label: string; count: number }[] {
  const out: { depth: number; label: string; count: number }[] = [];
  const entries = Object.entries(node.children).sort((a, b) => b[1].count - a[1].count);
  entries.slice(0, maxBranch).forEach(([label, child]) => {
    out.push({ depth, label, count: child.count });
    out.push(...flattenWbsTree(child, depth + 1, maxBranch));
  });
  if (entries.length > maxBranch) out.push({ depth, label: `… 외 ${entries.length - maxBranch}개`, count: 0 });
  return out;
}

// 장비 1대당 직종 크루(표준품셈) — 자원계획 장비 대수 → 인력(운전수·신호수·조수·보통인부) 자동 도출.
const _EQUIP_CREW: Record<string, Record<string, number>> = {
  "굴삭기(백호)": { 운전수: 1, 신호수: 1, 보통인부: 1 },
  "덤프트럭": { 운전수: 1 },
  "록브레이커/천공": { 운전수: 1, 신호수: 1 },
  "다짐롤러": { 운전수: 1 },
  "크레인": { 운전수: 1, 신호수: 1 },
  "이동식크레인": { 운전수: 1, 신호수: 1 },
  "천공기(오거/RCD)": { 운전수: 1, 보통인부: 1 },
  "항타기": { 운전수: 1, 신호수: 1, 보통인부: 1 },
  "그라우팅장비": { 운전수: 1, 보통인부: 1 },
  "콘크리트펌프카": { 운전수: 1, 보통인부: 1 },
};

// 공종별 투입 가능 장비 — 자원계획이 아무 장비나 아무 카드에 뜨는 것 방지(구조에 굴삭기 등 stale 잔재 필터).
//   토목=토공·기초 장비 / 구조·종합=타설·양중 / 건축·MEP·조경=작업조 위주. 작업조는 모든 공종 공통.
const DISC_EQUIP: Record<string, string[]> = {
  토목: ["굴삭기(백호)", "덤프트럭", "록브레이커/천공", "다짐롤러", "천공기(오거/RCD)", "그라우팅장비", "항타기", "콘크리트펌프카", "작업조"],
  구조: ["콘크리트펌프카", "크레인", "작업조"],
  종합: ["콘크리트펌프카", "크레인", "작업조"],
  건축: ["이동식크레인", "작업조"],
  MEP: ["작업조"],
  조경: ["굴삭기(백호)", "작업조"],
  가설: ["크레인", "작업조"],
};
const equipAllowed = (disc: string, name: string): boolean => (DISC_EQUIP[disc] ?? ["작업조"]).includes(name);
// 구조/종합에서 '작업조'는 SGS 동시 시공 '구역 수'(병렬도) — 셀당 인력인 '골조 투입조'와 혼동 방지 표기.
const equipLabel = (disc: string, name: string): string =>
  (name === "작업조" && (disc === "구조" || disc === "종합")) ? "동시구역" : name;
// 공종별 '작업조' 1조 직종 구성(표준품셈) — 장비 아닌 직영 인력(형틀목공·철근공…)을 작업조 수에서 도출.
const _CREW_COMPOSITION: Record<string, Record<string, number>> = {
  구조: { 형틀목공: 6, 철근공: 5, 콘크리트공: 2, 보통인부: 4 },   // 골조 사이클 1작업조
  종합: { 형틀목공: 6, 철근공: 5, 콘크리트공: 2, 보통인부: 4 },
  건축: { 마감공: 4, 보통인부: 2 },
  MEP: { 설비공: 3, 보통인부: 1 },
  조경: { 조경공: 3, 보통인부: 2 },
};
// 자원계획 → 직종별 인력 합계. 장비 키=장비크루(운전수…), '작업조' 키=공종 직영크루(형틀목공…).
function laborOf(equip: Record<string, number>, disc: string): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (job: string, n: number) => { out[job] = (out[job] || 0) + n; };
  for (const [name, cnt] of Object.entries(equip || {})) {
    if (!cnt) continue;
    if (name === "작업조") {
      const comp = _CREW_COMPOSITION[disc];
      if (comp) for (const [job, per] of Object.entries(comp)) add(job, per * cnt);
    } else if (_EQUIP_CREW[name]) {
      for (const [job, per] of Object.entries(_EQUIP_CREW[name])) add(job, per * cnt);
    }
  }
  return out;
}

export default function SchedulePlanWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // ── 1단계: 입력 폼 ──
  const [buildingType, setBuildingType] = useState("");
  const [scope, setScope] = useState("");
  const [gfa, setGfa] = useState(""); // 연면적(㎡) — 건축/MEP 물량 기반 기간(선택)
  const [prepDays, setPrepDays] = useState("");     // 국토부 고시 ①준비기간(일) — 0/빈=미반영(비파괴 opt-in)
  const [closeoutDays, setCloseoutDays] = useState(""); // 국토부 고시 ④정리기간(일)
  const [structureType, setStructureType] = useState("");
  const [discipline, setDiscipline] = useState(""); // 공종(토목/구조/건축/MEP/조경) — 자동채움+사람수정(휴먼인더루프)
  const [slots, setSlots] = useState<Record<string, { name: string; count?: number; wp?: number; warn?: string | null; ai?: number }>>({}); // 공종별 업로드 현황(count/wp/ai 는 분석 후)
  const slotFilesRef = useRef<Record<string, File>>({}); // 공종별 원본 IFC(File) — 4D 전달용(공종 태그 보존)
  const [startDate] = useState(() => new Date().toISOString().slice(0, 10)); // 폴백(공종 카드 착공일이 우선)
  const [durationMonths] = useState("");  // 폴백(공종 카드 마감일로 산출)
  const [wdpw] = useState(6);  // 폴백(공종 카드 근무가 우선)
  // ── 자원(투입조·장비) 모델 ──────────────────────────────────────────────
  //   단일 출처 = discEquip (공종별 자원계획 {장비/작업조: 수}, 자원계획 패널·내역서 자동).
  //   값이 없을 때만 RES_FALLBACK 표준값 사용. (백엔드는 crew.work_front 단일 모델로 병렬도 산정.)
  //   토목 굴착만 별도 2-축: excavFleet(세트 '수') × excavSize(백호 '규격' → 조당 생산성).
  const RES_FALLBACK = { 크레인: 2, 작업조: 3, 공종작업조: { 건축: 3, MEP: 3, 조경: 2 } as Record<string, number> };
  const [excavFleet, setExcavFleet] = useState(5);  // 토목 굴착 장비 세트 '수'(백호·덤프·CIP) — 병렬 work-front
  const [excavSize, setExcavSize] = useState("");   // 굴착 백호 '규격'(온톨로지 Equipment) — 조당 생산성. ""=default(1.0㎥)
  // 공종별 분리 입력(WBS개수·착공일·마감일·가동률·시공전략·참고) — 비우면 프로젝트 기본값(③④) 폴백. 백엔드 적용=Phase 2.
  const [discSet, setDiscSet] = useState<Record<string, { wbs?: string; start?: string; finish?: string; util?: string; wdpw?: string; strategy?: string; notes?: string; win?: string; heat?: string; rain?: string; snow?: string; wind?: string; cell_days?: string; crewRb?: string; crewFm?: string; crewCn?: string }>>({});
  const [discBoq, setDiscBoq] = useState<Record<string, BoqResult & { loading?: boolean; confirm?: boolean }>>({});  // 공종 카드별 내역서 파싱 결과(+기간보정 컨펌)
  // 장비별 1일 표준 생산성(단위/일) — 추천 대수 산정용(qty ÷ (rate × 목표작업일 200)). 크레인은 고정.
  const EQUIP_RATE: Record<string, number> = {
    "굴삭기(백호)": 600, "덤프트럭": 200, "콘크리트펌프카": 150, "천공기(오거/RCD)": 40,
    "항타기": 30, "다짐롤러": 800, "록브레이커/천공": 350, "그라우팅장비": 120,
  };
  const suggestEquipCount = (equip: string, qty: number): number => {
    if (equip === "크레인") return 2;
    const rate = EQUIP_RATE[equip] ?? 300;
    return Math.max(1, Math.min(40, Math.ceil(qty / (rate * 200))));
  };
  const [discEquip, setDiscEquip] = useState<Record<string, Record<string, number>>>({}); // 공종별 자원계획 {장비: 대수}
  const handleBoqUpload = async (cardKey: string, file: File | undefined) => {
    if (!file) return;
    setDiscBoq((s) => ({ ...s, [cardKey]: { loading: true } }));
    try {
      const r = await parseBoq(file);
      setDiscBoq((s) => ({ ...s, [cardKey]: { ...r, loading: false } }));
      // 예측 장비 + 작업조(+구조 크레인) → 자원 계획 자동 채움(추천 기본값, 수동 수정 가능).
      const auto: Record<string, number> = {};
      for (const e of r.equipment ?? []) auto[e.equip] = suggestEquipCount(e.equip, e.qty);
      const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
      const conc = r.quantities?.concrete_m3 || (r.quantities?.formwork_m2 ?? 0) / 8.5;  // 구조 driver
      const itemSum = (r.items ?? []).reduce((s, it) => s + (it.qty || 0), 0);            // 건축/MEP driver(마감·설비 물량)
      if (cardKey === "구조" || cardKey === "종합") {
        // 크레인: 실측 앵커 ~4대/15만㎥(포스코) → 1대당 ~4만㎥. 작업조 ≈ 크레인×2.
        auto["크레인"] = clamp(Math.round(conc / 40000), 2, 12);
        auto["작업조"] = clamp(Math.round(conc / 20000), 3, 16);
      } else if (cardKey !== "토목") {
        // 건축·MEP·조경: 자기 물량(마감㎡·설비m 합)으로 작업조 스케일. 토목은 굴삭기=장비 세트.
        auto["작업조"] = clamp(Math.round(itemSum / 25000), 3, 12);
      }
      setDiscEquip((s) => {   // 기존 수동값 보존 + 공종 무효 장비(stale 잔재) 필터
        const merged = { ...auto, ...s[cardKey] };
        return { ...s, [cardKey]: Object.fromEntries(Object.entries(merged).filter(([name]) => equipAllowed(cardKey, name))) };
      });
    } catch (e) {
      setDiscBoq((s) => ({ ...s, [cardKey]: { loading: false, error: e instanceof Error ? e.message : "파싱 실패" } }));
    }
  };
  const setDS = (k: string, patch: Partial<{ wbs: string; start: string; finish: string; util: string; wdpw: string; strategy: string; notes: string; win: string; heat: string; rain: string; snow: string; wind: string; cell_days: string; crewRb: string; crewFm: string; crewCn: string }>) =>
    setDiscSet((s) => ({ ...s, [k]: { ...s[k], ...patch } }));
  const [util, setUtil] = useState(0.85); // 가동률(0<u≤1) — 공기 현실화(공수÷가동률). 공휴일은 서버가 항상 자동 제외
  const [weatherStation, setWeatherStation] = useState(""); // 기상 지역(ASOS) — 선택 시 공종별 가동률 기상 기반 산정
  const [weatherRates, setWeatherRates] = useState<Record<string, number> | null>(null); // 기상지역 실측 가동률(카드 표시용)
  const [weatherLoading, setWeatherLoading] = useState(false); // 실측 가동률 계산 중 — 프리셋 68% 오해 방지(계산중 표시)
  const [formwork, setFormwork] = useState(""); // 거푸집 시스템(골조 기준층 사이클) — 비우면 LLM 기준(재래식급)
  const [rapidConcrete, setRapidConcrete] = useState(false); // 조강콘크리트 — 양생 단축
  const [seasonal, setSeasonal] = useState(false); // 계절 비작업일(동절기·우기) — 가동률과 별개 축
  const [civilQty, setCivilQty] = useState<{ depth_m?: number; footprint_m2?: number; perimeter_m?: number; pile_count?: number } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);   // 드래그앤드롭 — 호버 중인 공종 슬롯
  const [milestones, setMilestones] = useState<GenMilestone[]>([]); // 외부 마일스톤(인허가/자재반입/계약) — BIM에 없는 게이트
  const [brief, setBrief] = useState<string | null>(null); // AI 리스크 브리핑
  const [briefBusy, setBriefBusy] = useState(false);
  const [audit, setAudit] = useState<AuditFinding[] | null>(null); // AI 공정 검토 — 모순 목록
  const [auditBusy, setAuditBusy] = useState(false);
  const [auditFixBusy, setAuditFixBusy] = useState(false);
  const [auditFixMsg, setAuditFixMsg] = useState<string | null>(null);
  const [auditLoopBusy, setAuditLoopBusy] = useState(false);   // 모순 자동해소 루프
  const [basis, setBasis] = useState<BasisResult | null>(null);   // 공정계획서 산정근거
  const [basisBusy, setBasisBusy] = useState(false);
  const [auditLoopMsg, setAuditLoopMsg] = useState<string | null>(null);
  const [boqBriefTxt, setBoqBriefTxt] = useState<string | null>(null); // AI 내역서 대조 브리핑
  const [boqBriefBusy, setBoqBriefBusy] = useState(false);
  const [strategy] = useState("bottom_up");  // 폴백(공종 카드 시공전략이 우선)
  const [wbsStructure, setWbsStructure] = useState("zone");  // WBS 구조(PM 관리방식) — 스케줄과 직교(날짜 불변)
  const [wbsReason, setWbsReason] = useState<string | null>(null);  // WBS 재추천/자연어 사유
  const [wbsRecBusy, setWbsRecBusy] = useState(false);
  const [wbsText, setWbsText] = useState("");          // 자연어 WBS 요청 입력
  const [wbsCustomLabel, setWbsCustomLabel] = useState<string | null>(null);  // 커스텀(프리셋 아님) 표시
  const [workUnits, setWorkUnits] = useState<GenWorkUnit[]>([]);
  // WBS 미리보기 트리 — work_units 메타로 선택 구조 시각화(날짜 불필요, 생성 전 제시)
  const wbsPreview = useMemo(() =>
    workUnits.length ? flattenWbsTree(buildWbsTree(workUnits, resolveWbsKeysW(wbsStructure))) : [],
    [workUnits, wbsStructure]);
  const [zones, setZones] = useState<string[]>([]);
  const [storeys, setStoreys] = useState<string[]>([]);
  const [bimName, setBimName] = useState<string | null>(null);
  const [bimBusy, setBimBusy] = useState(false);
  const [inferReason, setInferReason] = useState<string | null>(null);

  // ── 계획 상태 ──
  const [planId, setPlanId] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanState | null>(null);
  const [scopeWbs, setScopeWbs] = useState<PlanScopeWbs | null>(null);
  const [acts, setActs] = useState<PlanActivity[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ganttReady, setGanttReady] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 복구 — URL ?plan= 우선, 없으면 localStorage 체크포인트 (페이지 이동/새로고침 후 이어서)
  useEffect(() => {
    const q = searchParams.get("plan") || (typeof window !== "undefined" ? localStorage.getItem(PLAN_CKPT) : null);
    if (q && !planId) {
      setPlanId(q);
      router.replace(`?plan=${q}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stage: PlanStage | null = plan?.stage ?? null;
  const step = bigStep(stage, !!planId);
  const running = stage === "running_p2";   // 플래닝 그래프가 logic_ready 까지 한 번에 (p34/s1 상태 미사용)
  const subs = subDone(stage, plan?.progress);


  const refresh = useCallback(async (id: string) => {
    try {
      const p = await getPlan(id);
      setPlan(p);
      // scope 는 PlanScopeWbs 객체여야 함 — 문자열 등 비정상이면 무시(렌더 .length 크래시 방어)
      if (p.payload.scope && Array.isArray((p.payload.scope as PlanScopeWbs).wbs)) setScopeWbs(p.payload.scope);
      const serverActs = p.payload.activities_user ?? p.payload.activities;
      if (serverActs && !dirty) setActs(serverActs);
      if (p.stage === "error") setErr(p.payload.error ?? p.progress ?? "오류");
      // 체크포인트는 done 에도 유지 — '새 계획 시작' 누를 때까지 새로고침/이동 후 복원 보장.
    } catch (e) {
      // 좀비 플랜 정리 — 삭제/없는 플랜(404)을 체크포인트·URL이 가리켜 무한 폴링하던 것 차단.
      // 폴링 중단 + 체크포인트·URL 정리 + 위저드 복귀('새 계획 시작'과 동일).
      if (e instanceof ScheduleApiError && e.status === 404) {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        if (typeof window !== "undefined") localStorage.removeItem(PLAN_CKPT);
        setPlan(null);
        setErr(null);
        router.replace("/schedule/plan");
        return;
      }
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [dirty, router]);


  useEffect(() => {
    if (!planId) return;
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    // 생성 중(running_p2)·초기(null)에만 3초 폴링. 안정상태(logic_ready/scheduled/done/error)면
    // 폴링 중단 — 488행 표+간트를 매 3초 통째 재렌더하던 렉 제거 + DB(Neon) 3초마다 찌르던 부하 제거.
    if (stage && stage !== "running_p2") return; // 안정상태 → 폴링 중단(데이터는 직전 폴이 이미 가져옴)
    pollRef.current = setInterval(() => { void refresh(planId); }, 3000);
    void refresh(planId);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [planId, refresh, stage]);

  useEffect(() => {
    if (stage === "scheduled" || stage === "done")
      loadFrappeGantt().then(() => setGanttReady(true)).catch(() => setGanttReady(false));
  }, [stage]);

  // 기상지역 선택 시 실측 가동률 조회 → 카드가 하드코딩 프리셋 대신 실측값 표시.
  useEffect(() => {
    if (!weatherStation) { setWeatherRates(null); setWeatherLoading(false); return; }
    let live = true;
    setWeatherRates(null); setWeatherLoading(true);   // 로딩 시작 — 프리셋 대신 '계산중' 표시(오해 방지)
    void getWeatherRates(weatherStation)
      .then((r) => { if (live) setWeatherRates(r.source === "asos" ? r.rates : null); })
      .catch(() => { if (live) setWeatherRates(null); })
      .finally(() => { if (live) setWeatherLoading(false); });
    return () => { live = false; };
  }, [weatherStation]);

  // ── 슬롯 업로드 = 파일만 보관(즉시). 분석은 '생성' 클릭 시 일괄(onStart). 업로드마다 서버추출 안 함. ──
  const onBim = (file: File, fixedDiscipline?: string) => {
    if (!fixedDiscipline) return;
    setErr(null);
    setDiscipline(fixedDiscipline);
    slotFilesRef.current[fixedDiscipline] = file; // 원본 IFC 보관(4D 핸드오프 + 생성 시 분석)
    setSlots((s) => ({ ...s, [fixedDiscipline]: { name: file.name } })); // 대기 — 부재/WP 는 생성 시 채움
  };

  // 슬롯 파일 1개 분석 — 서버 추출(C-1), 실패 시 클라 파싱 폴백. work_unit/요약 반환(onStart 가 일괄 호출).
  const analyzeSlotFile = async (file: File): Promise<IfcWorkUnitsResult> => {
    try {
      return await extractIfcWorkUnitsViaS3(file);
    } catch (serverErr) {
      console.warn("[BIM] 서버 추출 실패 → 클라 폴백:", serverErr);
      const { parseIfc } = await import("../../../../lib/fourd/ifc");
      const parsed = await parseIfc(await file.arrayBuffer());
      const agg = new Map<string, GenWorkUnit>();
      const zoneSet = new Set<string>(); const storeySet = new Set<string>();
      const typeCount = new Map<string, number>(); const typeNames = new Map<string, Set<string>>();
      const tradeCount = new Map<string, number>();
      for (const el of parsed.elements) {
        typeCount.set(el.ifcType, (typeCount.get(el.ifcType) ?? 0) + 1);
        if (el.trade) tradeCount.set(el.trade, (tradeCount.get(el.trade) ?? 0) + 1);
        if (el.name) { const ns = typeNames.get(el.ifcType) ?? new Set<string>(); if (ns.size < 3) { ns.add(el.name.slice(0, 30)); typeNames.set(el.ifcType, ns); } }
        const zone = el.zone ?? "-"; const storey = el.storey4d ?? normStorey(el.storeyName) ?? "-";
        const cat = classifyIfcType(el.ifcType, el.name);
        if (el.zone) zoneSet.add(el.zone); if (storey !== "-") storeySet.add(storey);
        const key = `${zone}|${storey}|${cat}`;
        const u = agg.get(key) ?? { zone, storey, element_type: cat, count: 0 };
        u.count = (u.count ?? 0) + 1; agg.set(key, u);
      }
      return {
        work_units: [...agg.values()] as IfcWorkUnitsResult["work_units"],
        zones: [...zoneSet], storeys: [...storeySet],
        trade_summary: [...tradeCount.entries()].map(([trade, count]) => ({ trade, count })),
        element_summary: [...typeCount.entries()].sort((a, b) => b[1] - a[1]).map(([type, count]) => ({ type, count, names: [...(typeNames.get(type) ?? [])] })),
        element_count: parsed.elements.length,
      };
    }
  };


  // ── [버튼 1] 분석 & 추천 — 업로드한 슬롯 일괄 분석 → 공종·구조 판정·건물유형 추천(필드 채움). 생성은 별개. ──
  const onAnalyze = async () => {
    const entries = Object.entries(slotFilesRef.current);
    if (!entries.length) { setErr("BIM 파일을 공종 슬롯에 올리세요"); return; }
    setBimBusy(true); setErr(null);
    try {
      const allWu: GenWorkUnit[] = [];
      const zoneSet = new Set<string>(); const storeySet = new Set<string>();
      let cq = civilQty;
      let inferSrc: IfcWorkUnitsResult | null = null;
      const declared = new Set(entries.map(([d]) => d));   // 명시 슬롯 = 사용자의 scope 선언
      for (const [disc, file] of entries) {
        setInferReason(`분석 중 — ${disc} (${file.name})…`);
        const r = await analyzeSlotFile(file);
        // 슬롯 = 기본 공종. 단 실제 파일은 섞임(건축 IFC에 조경·구조 IFC에 흙막이 pile) → 분류기가
        // 확실히 잡은 타 공종(토목·MEP·조경)은 **그 공종 슬롯이 함께 올라온 경우에만** 살린다.
        // 슬롯에 없는 공종 부재를 살려두면 백엔드가 그 공종 전체를 켜(최소 증거 3개) 지반 영속 물량까지
        // 끌어와 과대 생성(실측: 구조만 올렸는데 토목 104활동+굴착 164만㎥) — "넣은 공종만 반영" 약속 위반.
        // 제외분은 슬롯 카드 경고로 가시화(조용히 누락 X). 종합 슬롯은 전부 분류기(전 공종 허용).
        const comprehensive = disc === "종합";
        const KEEP = new Set(["토목", "MEP", "조경"]);   // 이름·타입이 확실한 공종(분류기 신뢰)
        const droppedCnt: Record<string, number> = {};
        allWu.push(...(comprehensive
          ? (r.work_units as GenWorkUnit[])
          : (r.work_units as GenWorkUnit[]).flatMap((w) => {
              const d = String(w.discipline || "");
              if (!KEEP.has(d)) return [{ ...w, discipline: disc }];
              if (declared.has(d)) return [w];           // 그 공종 슬롯도 올라옴 → 분류기 결과 존중
              droppedCnt[d] = (droppedCnt[d] || 0) + (w.count || 1);
              return [];                                  // 슬롯 미선언 공종 → 제외(약속: 넣은 공종만)
            })));
        r.zones.forEach((z) => zoneSet.add(z)); r.storeys.forEach((s) => storeySet.add(s));
        if (r.civil_quantities) cq = r.civil_quantities;
        if (r.suggested_equip) setExcavFleet(r.suggested_equip);  // 물량 기반 권장 장비 세트 자동 반영(대형현장 현실화)
        const dropMsg = Object.entries(droppedCnt).map(([d, n]) => `${d} ${n.toLocaleString()}부재 제외(슬롯 미선언 — 필요 시 ${d} 슬롯에 IFC 추가)`).join(" · ");
        const baseWarn = validateSlot(disc, r.discipline_summary);
        setSlots((s) => ({ ...s, [disc]: { name: file.name, count: r.element_count, wp: r.work_units.length,
          warn: [baseWarn, dropMsg ? `⚠️ ${dropMsg}` : null].filter(Boolean).join("  ") || null, ai: r.ai_classified } }));
        if (disc === "구조" || !inferSrc) inferSrc = r; // 구조유형 추론은 구조 파일 우선
      }
      setWorkUnits(allWu); setZones([...zoneSet]); setStoreys([...storeySet]); setCivilQty(cq);
      // ③ zone 기반 구조 자원 보정 — 넓은 건물(다구역)은 물량 기준만으론 작업조 부족 → SGS 직렬화·공기폭주.
      //   메인존(A/B/C/D)당 크레인 1대, 세부존 병렬 위해 작업조 = max(물량기준, 세부존×0.6). 직렬화 완화.
      const subZones = [...zoneSet].filter((z) => z && z !== "-");
      const mainZones = new Set(subZones.map((z) => z.replace(/[-_ .]?\d+$/, "") || z)).size || 1;
      if (subZones.length > 4) {
        const cl = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
        const sk = slotFilesRef.current["구조"] ? "구조" : (slotFilesRef.current["종합"] ? "종합" : null);
        if (sk) {
          setDiscEquip((s) => {
            const cur = s[sk] || {};
            return { ...s, [sk]: { ...cur,
              크레인: cl(Math.max(cur["크레인"] ?? 0, mainZones), 2, 16),                       // 메인존당 1크레인
              작업조: cl(Math.max(cur["작업조"] ?? 0, Math.round(subZones.length * 0.6)), 3, 30) } }; // 세부존 병렬
          });
        }
      }
      // 공종·구조·건물유형 추천 → 빈 칸 채움(사람이 검토·수정 후 생성)
      if (inferSrc) {
        const ctx = await inferScheduleContext({
          storeys: [...storeySet], zones: [...zoneSet], element_summary: inferSrc.element_summary,
          trade_summary: inferSrc.trade_summary, discipline_summary: inferSrc.discipline_summary, total_count: inferSrc.element_count,
          name_signals: inferSrc.name_signals,   // 부재명 신호(강재단면 54% 등) — RC 오추론 방지
        });
        if (ctx.building_type && !buildingType.trim()) setBuildingType(ctx.building_type);
        if (ctx.scope && !scope.trim()) setScope(ctx.scope);
        if (ctx.structure_type && !structureType.trim()) setStructureType(ctx.structure_type);
        setInferReason(ctx.reason || null);
      } else { setInferReason(null); }
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBimBusy(false); }
  };

  // WBS 재추천 — 프로젝트 맥락(구역·층·공종)으로 5안 중 1개 AI 추천 → 드롭다운 갱신.
  const onRecommendWbs = async () => {
    setWbsRecBusy(true);
    try {
      const zones = [...new Set(workUnits.map((w) => w.zone).filter(Boolean) as string[])];
      const storeys = [...new Set(workUnits.map((w) => w.storey).filter(Boolean) as string[])];
      const dc: Record<string, number> = {};
      for (const w of workUnits) { const d = (w.discipline || "").trim(); if (d) dc[d] = (dc[d] || 0) + 1; }
      const discipline_summary = Object.entries(dc).map(([discipline, count]) => ({ discipline, count }));
      const r = await recommendWbs({ building_type: buildingType, structure_type: structureType, zones, storeys, discipline_summary });
      if (r.wbs_structure) setWbsStructure(r.wbs_structure);
      setWbsCustomLabel(null);   // 추천은 프리셋
      setWbsReason(r.reason || null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setWbsRecBusy(false); }
  };

  // 자연어 WBS — "공종 중심으로", "층별 다음 공종별로" 등 → 키 순서로 변환·적용(프리셋 또는 커스텀).
  const onWbsFromText = async () => {
    const t = wbsText.trim();
    if (!t) return;
    setWbsRecBusy(true);
    try {
      const r = await wbsFromText(t);
      setWbsStructure(r.structure || "zone");
      const presets = ["zone", "trade", "sequence", "storey", "trade_detail"];
      setWbsCustomLabel(presets.includes(r.structure) ? null : `${r.label || "커스텀"} (${(r.keys || []).join(" › ")})`);
      setWbsReason(r.reason || null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setWbsRecBusy(false); }
  };

  // ── [버튼 2] 생성 — 분석된 work_unit + (검토한) 건물유형·공종·구조유형으로 공정표 생성. ──
  const onStart = async () => {
    if (!workUnits.length) { setErr("먼저 '분석 & 추천'을 실행하세요"); return; }
    // 공종 카드에서 프로젝트 기본 도출 (Phase1: 백엔드는 전역값만 — 가장 이른 착공일 + 대표공종 값. 공종별 적용=Phase2)
    const starts = Object.values(discSet).map((s) => s.start).filter(Boolean).sort();
    const projStart = starts[0] || startDate;
    if (!projStart) { setErr("공종 카드에 착공일을 1개 이상 입력하세요"); return; }
    const prim = discSet["종합"] || discSet["구조"] || Object.values(discSet)[0] || {};
    const projUtil = prim.util ? Number(prim.util) : util;
    const projStrategy = prim.strategy || strategy;
    const projWdpw = prim.wdpw ? Number(prim.wdpw) : wdpw;
    // 각 공종 카드 참고사항 → constraints (공종 라벨 붙여 AI 공정 반영)
    const noteStr = Object.entries(discSet)
      .map(([k, s]) => (s.notes?.trim() ? `[${k}] ${s.notes.trim()}` : ""))
      .filter(Boolean).join(" / ");
    const finishes = Object.values(discSet).map((s) => s.finish).filter(Boolean).sort();
    const lastFinish = finishes[finishes.length - 1];
    let projMonths = durationMonths ? Number(durationMonths) : undefined;
    if (lastFinish) {
      const md = (new Date(lastFinish + "T00:00:00").getTime() - new Date(projStart + "T00:00:00").getTime()) / 86400000 / 30.4;
      if (md > 0) projMonths = Math.round(md);
    }
    setBusy(true); setErr(null);
    // 모듈러/OSC 구조유형은 종합(OSC) 슬롯 전용 — 종합 없이 구조 슬롯만이면 모듈러 값 잔재 차단(재래식 경로로).
    //   예전 모듈러 테스트가 structureType="PC·모듈러" 남겨도 구조 생성이 모듈러 경로 타는 것 방지.
    const _stRaw = structureType.trim();
    const _stClamped = (!slots["종합"] && /모듈러|하이브리드|패널라이즈드|OSC|PPVC|PC·|PC모듈/.test(_stRaw)) ? "" : _stRaw;
    try {
      const r = await startPlan({
        building_type: buildingType.trim() || "건물", scope: scope.trim() || undefined,
        structure_type: _stClamped || undefined, discipline: discipline.trim() || undefined,
        zones, storeys, work_units: workUnits, methods: [],
        start_date: projStart, duration_months: projMonths,
        // 자원 = 자원 계획(discEquip, 내역서 자동+수동)에서 도출. 없으면 기존 기본값 폴백.
        work_days_per_week: projWdpw,
        tower_cranes: discEquip["구조"]?.["크레인"] ?? discEquip["종합"]?.["크레인"] ?? RES_FALLBACK.크레인,
        work_crews: discEquip["구조"]?.["작업조"] ?? discEquip["종합"]?.["작업조"] ?? RES_FALLBACK.작업조,
        civil_equipment: discEquip["토목"]?.["굴삭기(백호)"] || excavFleet,   // 토목 굴착 세트 '수'(병렬도)
        excav_equipment: excavSize || undefined,   // 굴착 백호 '규격' → 온톨로지 조당 생산성
        civil_quantities: civilQty ?? undefined,
        discipline_crews: { ...RES_FALLBACK.공종작업조, ...Object.fromEntries(["건축", "MEP", "조경"].map((k) => [k, discEquip[k]?.["작업조"] ?? RES_FALLBACK.공종작업조[k] ?? 3])) },
        gross_floor_area: gfa ? Number(gfa) : undefined,
        prep_days: prepDays ? Number(prepDays) : 0,          // 국토부 고시 공사기간 프레임(opt-in)
        closeout_days: closeoutDays ? Number(closeoutDays) : 0,
        discipline_settings: Object.fromEntries(   // 공종별 분리 + 내역서 물량(boq) + 자원계획 병합
          Object.keys({ ...discSet, ...discBoq, ...discEquip }).map((k) => {
            const base: Record<string, unknown> = {
              ...(discSet[k] || {}),
              ...(discBoq[k]?.quantities ? {
                boq: discBoq[k].quantities, boq_confirm: true,  // 내역서 올리면 물량 보정 기본 적용(factor=물량비, 일치 시 1.0=무해)
                boq_items: (discBoq[k]?.items ?? []).map((it) => ({ name: it.name, unit: it.unit, qty: it.qty, op: it.op })),
              } : {}),
              ...(discEquip[k] ? { equipment: Object.fromEntries(Object.entries(discEquip[k]).filter(([name]) => equipAllowed(k, name))) } : {}),
            };
            if (k === "구조") {   // 구조 공종별 투입조(사용자 입력) → crews dict(백엔드 duration.py). 비우면 자동 스케일.
              const crews = Object.fromEntries(
                ([["철근", discSet["구조"]?.crewRb], ["거푸집", discSet["구조"]?.crewFm], ["콘크리트", discSet["구조"]?.crewCn]] as [string, string | undefined][])
                  .map(([t, v]) => [t, Number(v)]).filter(([, v]) => (v as number) > 0));
              if (Object.keys(crews).length) base.crews = crews;
            }
            return [k, base];
          }),
        ),
        weather_station: weatherStation || undefined,   // 기상 지역 — 있으면 공종별 가동률 기상 기반 산정
        utilization_rate: projUtil, formwork_system: formwork || undefined, rapid_concrete: rapidConcrete,
        seasonal_weather: weatherStation ? false : seasonal,   // 기상지역 실측 가동률이 계절 손실 포함 → 이중계산 차단
        milestones: milestones.filter((m) => m.name.trim() && m.target_date),
        constraints: noteStr || undefined, strategy: projStrategy, wbs_structure: wbsStructure,
      });
      setScopeWbs(r.scope);
      setPlanId(r.plan_id);
      // 슬롯 IFC(공종 태그째)를 plan_id 로 보관 → /fourd?plan=X 가 통합 4D 로 읽음(파일명 추측 X)
      const planIfcs = Object.entries(slotFilesRef.current).map(([discipline, file]) => ({ file, discipline }));
      if (planIfcs.length) void savePlanIfcs(r.plan_id, planIfcs);
      router.replace(`?plan=${r.plan_id}`);
      localStorage.setItem(PLAN_CKPT, r.plan_id);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const onSaveActs = async () => {
    if (!planId) return;
    setBusy(true);
    try { await savePlanActivities(planId, acts); setDirty(false); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const onConfirm = async () => {
    if (!planId) return;
    setBusy(true); setErr(null);
    try {
      if (dirty) await onSaveActs();   // 통합 테이블: 이름·기간·선행 전부 activities 로 저장
      await confirmPlan(planId);
      await refresh(planId);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const ganttTasks: GanttTask[] = useMemo(() => {
    const tasks = (plan?.payload.schedule?.tasks ?? []) as Array<Record<string, unknown>>;
    const bump = (s: string, e: string) => {
      if (e > s) return e;
      const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + 1);
      return d.toISOString().slice(0, 10);
    };
    return tasks.filter((t) => t.start && t.end).map((t) => ({
      id: String(t.code), activity_code: String(t.code), name: String(t.name),
      wbs_code: String(t.wbs ?? "").split(/\s*>\s*/).filter(Boolean).join("."),
      start: String(t.start).slice(0, 10), end: bump(String(t.start).slice(0, 10), String(t.end).slice(0, 10)),
      progress: 0, is_cp: false, total_float_hr_cnt: null, status: "",
      dependencies: ((t.predecessors as string[]) ?? []).filter((p) => p !== t.code),
    }))
      // 시공 순서(시간순)로 정렬 — 기초(PT)가 지하(B1)보다 먼저 착공이므로 위에. 코드 문자열 순(B1<PT)이
      // 시간순을 역전시키던 문제 차단. 동일 시작일은 코드순.
      .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1
        : a.activity_code < b.activity_code ? -1 : a.activity_code > b.activity_code ? 1 : 0)) as GanttTask[];
  }, [plan]);

  const editAct = (i: number, patch: Partial<PlanActivity>) => {
    setActs((prev) => prev.map((a, j) => (j === i ? { ...a, ...patch } : a)));
    setDirty(true);
  };
  const removeAct = (i: number) => { setActs((prev) => prev.filter((_, j) => j !== i)); setDirty(true); };


  // ════════════════ 렌더 ════════════════
  return (
    <div style={{ padding: 20, height: "100%", overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>공정계획 위저드</h1>
        <p style={{ fontSize: 13, color: "#64748b", margin: "4px 0 0" }}>
          <b>공정 플래닝</b>(WBS → 액티비티 정의 → 리스트 → 릴레이션 → 듀레이션) 이 끝나면 DB에 저장되고,
          <b> PM이 수정 또는 컨펌</b>하면 <b>공정 스케줄링</b>(베이스라인 생성)으로 넘어갑니다.
        </p>
      </div>

      {/* 대단계 인디케이터 — 공정 플래닝 / 공정 스케줄링 */}
      <div className="wz-steps">
        <div className={`wz-step big ${step === 1 ? "on" : step > 1 ? "done" : ""}`}>
          <span className="wz-step-badge">{step > 1 ? "✓" : "1"}</span>
          <span style={{ flex: 1 }}>
            <b>공정 플래닝</b>
            <span className="wz-substeps">
              {PLAN_SUBS.map((t, i) => (
                <span key={t} className={`wz-substep ${step >= 1 && i < subs ? "done" : step === 1 && i === subs ? "on" : ""}`}>
                  {step >= 1 && i < subs ? "✓" : `${i + 1}.`}{t}
                </span>
              ))}
            </span>
          </span>
          <span className="wz-step-arrow">›</span>
        </div>
        <div className={`wz-step big ${stage === "done" ? "done" : step === 2 ? "on" : ""}`}>
          <span className="wz-step-badge">{stage === "done" ? "✓" : "2"}</span>
          <span>
            <b>공정 스케줄링</b>
            <small>{stage === "done" ? "베이스라인 확정 완료" : "플래닝 기반 공정표 베이스라인 생성"}</small>
          </span>
        </div>
      </div>

      {err && (
        <div style={{ border: "1px solid #fecaca", background: "#fef2f2", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#b91c1c", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span>{err}</span>
          {stage === "error" && (
            <button className="wz-btn ghost" style={{ flexShrink: 0 }} onClick={() => {
              setPlanId(null); setPlan(null); setActs([]); setErr(null); setDirty(false);
              localStorage.removeItem(PLAN_CKPT);
              router.replace("?");
            }}>새 계획 시작</button>
          )}
        </div>
      )}

      {running && (
        <div className="wz-stream">
          <div className="wz-stream-head">
            <span className="wz-dot" />
            <b>공정 플래닝 진행 중</b>
            <span style={{ color: "#6366f1" }}>{plan?.progress ?? "AI 작업 중…"}</span>
            <button type="button"
              onClick={async () => {
                if (!planId || !confirm("생성을 취소할까요?")) return;
                try { await cancelPlan(planId); } catch { /* 이미 종료된 경우 무시 */ }
              }}
              style={{ marginLeft: "auto", padding: "3px 12px", borderRadius: 7, border: "1px solid #fca5a5",
                       background: "#fef2f2", color: "#b91c1c", fontSize: 12, cursor: "pointer" }}>
              ⏹ 취소
            </button>
          </div>
          <div className="wz-skel-rows">
            {[78, 62, 88, 54, 70].map((w, i) => (
              <div key={i} className="wz-skel-row">
                <div className="wz-skel-label" />
                <div className="wz-skel-bar" style={{ width: `${w}%`, animationDelay: `${i * 0.12}s` }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Step 1: 입력 ── */}
      {step === 0 && (
        <>
          <div className="wz-card">
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
              📦 BIM(IFC) 업로드 — 공종별 멀티 임포트
            </div>
            <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 10px" }}>
              넣은 공종만 공정표에 반영됩니다 (예: 구조만 → 구조 공정표 / 토목+구조 → 합쳐서 1개). 시공 순서대로 자동 연결.
              <span style={{ color: "#2563eb", fontWeight: 600 }}> · 카드에 IFC·내역서를 드래그앤드롭하거나 클릭 업로드.</span>
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {DISCIPLINES.map((d, i) => {
                const filled = slots[d.key];
                if (!d.active) {
                  return (
                    <div key={d.key} title="공정 엔진 준비 중 (Phase D)"
                      style={{ border: "1px dashed #cbd5e1", borderRadius: 8, padding: "10px 12px",
                               background: "#f8fafc", color: "#94a3b8", cursor: "not-allowed", position: "relative" }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>🔒 {d.icon} {d.label}</div>
                      <div style={{ fontSize: 11, marginTop: 2 }}>준비 중 · {d.hint}</div>
                    </div>
                  );
                }
                const pr: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: "#475569", gap: 6 };
                const isStruct = d.key === "구조" || d.key === "종합";  // 종합=구조 자원 공유(골조 지배)
                return (
                  <div key={d.key}
                       onDragOver={(e) => { e.preventDefault(); if (!bimBusy) setDragOver(d.key); }}
                       onDragLeave={() => setDragOver((k) => (k === d.key ? null : k))}
                       onDrop={(e) => {
                         e.preventDefault(); setDragOver(null);
                         if (bimBusy) return;
                         const f = e.dataTransfer.files?.[0];
                         if (!f) return;
                         const n = f.name.toLowerCase();
                         if (n.endsWith(".ifc")) void onBim(f, d.key);
                         else if (n.endsWith(".csv") || n.endsWith(".xlsx") || n.endsWith(".xlsm") || n.endsWith(".xls")) void handleBoqUpload(d.key, f);
                         else setErr("IFC(.ifc) 또는 내역서(.csv/.xlsx/.xls) 파일만 가능합니다");
                       }}
                       style={{ border: `1px ${dragOver === d.key ? "dashed" : "solid"} ${dragOver === d.key ? "#2563eb" : filled ? "#bbf7d0" : "#dbeafe"}`,
                                borderLeft: `4px solid ${filled ? "#16a34a" : "#3b82f6"}`, borderRadius: 10, padding: "14px 16px",
                                background: dragOver === d.key ? "#eff6ff" : "#fff", boxShadow: "0 1px 4px rgba(15,23,42,0.06)", transition: "background .1s" }}>
                    {dragOver === d.key && (
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#2563eb", marginBottom: 4 }}>📥 여기에 놓기 — IFC(.ifc) 또는 내역서(.csv/.xlsx/.xls)</div>
                    )}
                    <label title={`${d.label} IFC 업로드 — ${d.hint}`} style={{ display: "block", cursor: bimBusy ? "wait" : "pointer" }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: filled ? "#15803d" : "#1d4ed8" }}>
                        {filled ? "✓" : `${i + 1}.`} {d.icon} {d.label}
                      </div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {filled ? (filled.count ? `${filled.count.toLocaleString()}부재 → ${filled.wp} WP` : `${filled.name} · 생성 시 분석`) : `업로드 · ${d.hint}`}
                        {filled?.ai ? <span style={{ color: "#7c3aed" }}> · 🤖 AI추정 {filled.ai.toLocaleString()}</span> : null}
                      </div>
                      {filled?.warn && (
                        <div style={{ fontSize: 10, marginTop: 3, lineHeight: 1.3, whiteSpace: "normal", color: filled.warn.startsWith("⚠️") ? "#b91c1c" : "#0369a1" }}>
                          {filled.warn}
                        </div>
                      )}
                      <input type="file" accept=".ifc" style={{ display: "none" }} disabled={bimBusy}
                             onChange={(e) => { const f = e.target.files?.[0]; if (f) void onBim(f, d.key); }} />
                    </label>
                    {/* 공종별 입력(규격 통일) — 공통 6필드 + 공종 전용 파라미터를 한 박스에 */}
                    <div style={{ marginTop: 10, padding: "10px 12px", background: "#f8fafc", border: "1px solid #eef2f7", borderRadius: 8, display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
                      <label style={pr} title="WBS 개수 — 비우면 BIM 자동(구역×층 정밀). 토목=굴착 단계 수 / 구조=상세수준(구역 수보다 작게 넣으면 구역 통합→층 단위로 활동 수↓, 공기 유지)">WBS개수
                        <input type="number" min={1} className="wz-in" style={{ width: 64, padding: "2px 4px" }} placeholder="자동"
                               value={discSet[d.key]?.wbs ?? ""} onChange={(e) => setDS(d.key, { wbs: e.target.value })} /></label>
                      <label style={pr} title="이 공종 착공일">착공일
                        <input type="date" className="wz-in" style={{ width: 142, padding: "2px 4px" }}
                               value={discSet[d.key]?.start ?? ""} onChange={(e) => setDS(d.key, { start: e.target.value })} /></label>
                      <label style={pr} title="이 공종 마감일(목표)">마감일
                        <input type="date" className="wz-in" style={{ width: 142, padding: "2px 4px" }}
                               value={discSet[d.key]?.finish ?? ""} onChange={(e) => setDS(d.key, { finish: e.target.value })} /></label>
                      <label style={pr} title="이 공종 가동률 — 비우면 공종 자동값(CPE 벤치마킹, 기상 연동 시 정밀화)">가동률
                        <select className="wz-in" style={{ width: 96, padding: "2px 4px" }}
                                value={discSet[d.key]?.util ?? ""} onChange={(e) => setDS(d.key, { util: e.target.value })}>
                          <option value="">{weatherStation ? `자동 (기상·${weatherStation})` : "자동 (공정별)"}</option><option value="1">100%</option><option value="0.9">90%</option><option value="0.85">85%</option><option value="0.8">80%</option><option value="0.7">70%</option>
                        </select></label>
                      <label style={pr} title="이 공종 주당 근무일 — 비우면 주6일">근무
                        <select className="wz-in" style={{ width: 78, padding: "2px 4px" }}
                                value={discSet[d.key]?.wdpw ?? ""} onChange={(e) => setDS(d.key, { wdpw: e.target.value })}>
                          <option value="">기본</option><option value="5">주5일</option><option value="6">주6일</option><option value="7">주7일</option>
                        </select></label>
                      <label style={pr} title="이 공종 시공 전략">시공전략
                        <select className="wz-in" style={{ width: 150, padding: "2px 4px" }}
                                value={discSet[d.key]?.strategy ?? ""} onChange={(e) => setDS(d.key, { strategy: e.target.value })}>
                          <option value="">기본</option><option value="bottom_up">순타·일괄</option><option value="bottom_up_phased">순타·단계</option><option value="top_down">역타</option>
                        </select></label>
                      {d.key === "구조" && (<>
                        <label style={pr} title="셀당 목표 사이클(일) — 초과 시 투입조 자동 증가(초대형 층 93일 방지). 비우면 15일">목표사이클
                          <input type="number" min={5} className="wz-in" style={{ width: 58, padding: "2px 4px" }} placeholder="15"
                                 value={discSet["구조"]?.cell_days ?? ""} onChange={(e) => setDS("구조", { cell_days: e.target.value })} /></label>
                        <span style={{ fontSize: 11, color: "#94a3b8" }}>골조 투입조(조·비우면 자동):</span>
                        <label style={pr} title="철근 배근 투입조 (현엔 8조). 비우면 자동 스케일">철근
                          <input type="number" min={1} className="wz-in" style={{ width: 46, padding: "2px 4px" }} placeholder="자동"
                                 value={discSet["구조"]?.crewRb ?? ""} onChange={(e) => setDS("구조", { crewRb: e.target.value })} /></label>
                        <label style={pr} title="거푸집 투입조 (현엔 8조). 비우면 자동 스케일">거푸집
                          <input type="number" min={1} className="wz-in" style={{ width: 46, padding: "2px 4px" }} placeholder="자동"
                                 value={discSet["구조"]?.crewFm ?? ""} onChange={(e) => setDS("구조", { crewFm: e.target.value })} /></label>
                        <label style={pr} title="콘크리트 타설 투입조 (현엔 2조). 비우면 자동 스케일">타설
                          <input type="number" min={1} className="wz-in" style={{ width: 46, padding: "2px 4px" }} placeholder="자동"
                                 value={discSet["구조"]?.crewCn ?? ""} onChange={(e) => setDS("구조", { crewCn: e.target.value })} /></label>
                      </>)}
                      {isStruct && d.key === "종합" && (<>
                        {/* 종합 = OSC(탈현장) 카드 — 거푸집(현장)은 무의미(공장제작)라 제거. OSC 공법 + 조강(공장양생). */}
                        <label style={pr} title="조강콘크리트 — 양생 단축(PC모듈러 공장양생)">조강
                          <input type="checkbox" checked={rapidConcrete} onChange={(e) => setRapidConcrete(e.target.checked)} /></label>
                        <label style={pr} title="OSC 공법 (탈현장 건설 — AI 자동분류, 수정 가능)">OSC공법
                          <select className="wz-in" style={{ width: 132, padding: "2px 4px" }} value={structureType} onChange={(e) => setStructureType(e.target.value)}>
                            <option value="">자동(AI분류)</option>
                            <option value="모듈러-철골">모듈러(철골)</option>
                            <option value="모듈러-PC일체">모듈러(PC·일체/PPVC)</option>
                            <option value="모듈러-PC패널">모듈러(PC·패널조립)</option>
                            <option value="모듈러-목조">모듈러(목조CLT)</option>
                            <option value="하이브리드">하이브리드(모듈+코어)</option>
                            <option value="패널라이즈드">패널라이즈드</option>
                            <option value="PC">PC(하프슬래브/DfMA)</option>
                            <option value="RC">재래식(RC)</option>
                          </select></label>
                      </>)}
                      {isStruct && d.key !== "종합" && (<>
                        {/* 구조 = 재래식(현장타설) 카드 — 거푸집 시스템 + 구조유형(RC/철골/SRC/혼합). OSC(PC·모듈러)는 종합 카드 전용. */}
                        <label style={pr} title="거푸집 시스템(기준층 사이클)">거푸집
                          <select className="wz-in" style={{ width: 88, padding: "2px 4px" }} value={formwork} onChange={(e) => setFormwork(e.target.value)}>
                            <option value="">자동</option><option value="재래식">재래식</option><option value="유로폼">유로폼</option><option value="갱폼">갱폼</option><option value="알폼">알폼</option><option value="시스템폼">시스템폼</option>
                          </select></label>
                        <label style={pr} title="조강콘크리트 — 양생 단축">조강
                          <input type="checkbox" checked={rapidConcrete} onChange={(e) => setRapidConcrete(e.target.checked)} /></label>
                        <label style={pr} title="구조유형(재래식)">구조유형
                          <select className="wz-in" style={{ width: 88, padding: "2px 4px" }} value={structureType} onChange={(e) => setStructureType(e.target.value)}>
                            <option value="">자동</option><option value="RC">RC</option><option value="철골">철골</option><option value="SRC">SRC</option><option value="혼합">혼합</option>
                          </select></label>
                      </>)}
                      {d.key === "가설" && (
                        <span style={{ fontSize: 10.5, color: "#64748b" }}>오버레이 — 공정표 설치·해체 2줄, 4D는 층 따라</span>
                      )}
                    </div>
                    {weatherStation && (() => {
                      const tp = THRESH_PRESET[d.key] ?? ["", "35", "10", "5", "15"];
                      const tf = [
                        { k: "win" as const, lbl: "동절기℃", ph: tp[0] || "비적용" },
                        { k: "heat" as const, lbl: "혹서℃", ph: tp[1] },
                        { k: "rain" as const, lbl: "강우mm", ph: tp[2] },
                        { k: "snow" as const, lbl: "강설cm", ph: tp[3] },
                        { k: "wind" as const, lbl: "풍속㎧", ph: tp[4] },
                      ];
                      return (
                        <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center",
                                      padding: "6px 8px", background: "#f0f9ff", border: "1px solid #e0f2fe", borderRadius: 6 }}
                             title="기상 작업불능 임계 — 비우면 공종 자동(프리셋). 입력하면 그 값으로 가동률 재계산.">
                          <span style={{ fontSize: 10.5, color: "#0369a1", fontWeight: 600 }}>기상 임계(비우면 자동)</span>
                          {tf.map((t) => (
                            <label key={t.k} style={{ fontSize: 10.5, color: "#475569", display: "inline-flex", flexDirection: "column", gap: 1 }}>
                              {t.lbl}
                              <input className="wz-in" type="number" step="0.1" style={{ width: 58, padding: "2px 4px", fontSize: 11 }}
                                     placeholder={t.ph} value={discSet[d.key]?.[t.k] ?? ""}
                                     onChange={(e) => setDS(d.key, { [t.k]: e.target.value })} />
                            </label>
                          ))}
                        </div>
                      );
                    })()}
                    <input className="wz-in" style={{ marginTop: 6, width: "100%", fontSize: 12, padding: "4px 8px" }}
                           title="현장 조건·제약 — 공정표 생성 시 AI가 반영(시퀀스·마일스톤)"
                           placeholder="현장조건·제약 (예: 야간작업 불가 · 도심 장비반입 제한 · 지하수 높음 · 인접 민원 · 작업공간 협소 — 생성 시 반영)"
                           value={discSet[d.key]?.notes ?? ""} onChange={(e) => setDS(d.key, { notes: e.target.value })} />
                    {(() => {
                      const b = discBoq[d.key];
                      const QLBL: Record<string, string> = { concrete_m3: "콘크리트㎥", formwork_m2: "거푸집㎡", rebar_ton: "철근t", excavation_m3: "굴착㎥", backfill_m3: "되메우기㎥" };
                      const qsum = b?.quantities ? Object.entries(b.quantities).filter(([k]) => k !== "total_cost").reduce((s, [, v]) => s + (v || 0), 0) : 0;
                      return (
                        <div style={{ marginTop: 6, padding: "6px 8px", background: "#fafafa", border: "1px dashed #d4d4d8", borderRadius: 6 }}>
                          <label style={{ fontSize: 11, color: "#52525b", fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
                            📄 내역서 업로드 (.csv/.xlsx/.xls) — 물량 보완(IFC 누락 대비)
                            <input type="file" accept=".csv,.xlsx,.xlsm,.xls" style={{ display: "none" }}
                                   onChange={(e) => { void handleBoqUpload(d.key, e.target.files?.[0]); e.currentTarget.value = ""; }} />
                          </label>
                          {b?.loading && <span style={{ fontSize: 11, color: "#6b7280", marginLeft: 6 }}>분석 중…</span>}
                          {b?.error && <div style={{ fontSize: 11, color: "#dc2626", marginTop: 3 }}>⚠️ {b.error}</div>}
                          {b && !b.loading && !b.error && (
                            <div style={{ marginTop: 4, fontSize: 11, color: "#3f3f46" }}>
                              ✓ {b.filename}{b.sheet ? ` (${b.sheet})` : ""} — {b.items_matched ?? 0}개 항목
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 3 }}>
                                {b.quantities && Object.entries(QLBL).filter(([k]) => (b.quantities?.[k] || 0) > 0).map(([k, lbl]) => (
                                  <span key={k} style={{ background: "#e0e7ff", color: "#3730a3", borderRadius: 4, padding: "1px 6px" }}>{lbl} {Math.round(b.quantities![k]).toLocaleString()}</span>
                                ))}
                                {b.has_prices && b.total_cost ? <span style={{ background: "#dcfce7", color: "#166534", borderRadius: 4, padding: "1px 6px" }}>원가 {(b.total_cost / 1e8).toFixed(1)}억</span> : null}
                                {(() => {   // IFC 실측(NetVolume) ↔ 내역서 콘크리트 대조 — 모델·내역 정합 검증(있을 때만)
                                  const ifcVol = workUnits.filter((w) => (w.discipline || "") === d.key).reduce((s, w) => s + (w.volume_m3 || 0), 0);
                                  const boqConc = b.quantities?.concrete_m3 || 0;
                                  if (!ifcVol || !boqConc) return null;
                                  const pct = Math.round(100 * Math.min(ifcVol, boqConc) / Math.max(ifcVol, boqConc));
                                  const ok = pct >= 95;
                                  return (
                                    <span style={{ background: ok ? "#dcfce7" : "#fef3c7", color: ok ? "#166534" : "#92400e", borderRadius: 4, padding: "1px 6px", fontWeight: 600 }}
                                          title={`IFC 실측(NetVolume) ${Math.round(ifcVol).toLocaleString()}㎥ vs 내역서 콘크리트 ${Math.round(boqConc).toLocaleString()}㎥ — 모델·내역 정합 검증`}>
                                      {ok ? "✓" : "⚠"} IFC 실측 {pct}% 일치
                                    </span>
                                  );
                                })()}
                              </div>
                              {discEquip[d.key] && Object.keys(discEquip[d.key]).length > 0 && (
                                <div style={{ marginTop: 5, padding: "6px 8px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6 }}>
                                  <span style={{ fontSize: 10.5, color: "#92400e", fontWeight: 600 }}>🚜 자원 계획 — 작업조·장비 (내역서 자동, 수정 가능)</span>
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                                    {Object.entries(discEquip[d.key]!).filter(([name]) => equipAllowed(d.key, name)).map(([name, cnt]) => (
                                      <label key={name} style={{ fontSize: 11, color: "#78716c", display: "inline-flex", alignItems: "center", gap: 3 }}
                                             title={name === "작업조" ? ((d.key === "구조" || d.key === "종합") ? "동시 시공 구역 수 — 병렬도(공기 지배). 셀당 인력인 '골조 투입조'와 다름" : "이 공종 작업조 수(기간 driver)") : `${name} 대수`}>
                                        {equipLabel(d.key, name)}
                                        <input type="number" min={0} className="wz-in" style={{ width: 46, padding: "2px 4px", fontSize: 11 }}
                                               value={cnt}
                                               onChange={(ev) => setDiscEquip((s) => ({ ...s, [d.key]: { ...s[d.key], [name]: Number(ev.target.value) } }))} />
                                        {name === "작업조" ? ((d.key === "구조" || d.key === "종합") ? "구역" : "조") : "대"}
                                      </label>
                                    ))}
                                  </div>
                                  {d.key === "토목" && (
                                    <label style={{ fontSize: 11, color: "#78716c", display: "flex", alignItems: "center", gap: 4, marginTop: 5 }}>
                                      ⛏️ 굴착 백호 규격
                                      <select className="wz-in" style={{ width: 158, padding: "2px 4px", fontSize: 11 }}
                                              value={excavSize} onChange={(e) => setExcavSize(e.target.value)}
                                              title="굴착 조당 생산성을 장비 규격으로 결정(온톨로지 Equipment). 소형(0.4㎥)일수록 느리고, 대형(2.3㎥)일수록 빠름. 미선택=중형 1.0㎥.">
                                        <option value="">기본 1.0㎥ — 현장 규격 직접 선택 권장</option>
                                        <option value="백호 0.4㎥(04W)">백호 0.4㎥(04W) — 소형 ~250㎥/일</option>
                                        <option value="백호 0.6㎥(06W)">백호 0.6㎥(06W) — ~350㎥/일</option>
                                        <option value="백호 0.8㎥(08W)">백호 0.8㎥(08W) — ~480㎥/일</option>
                                        <option value="백호 1.0㎥">백호 1.0㎥ — 중형 ~600㎥/일</option>
                                        <option value="백호 1.4㎥">백호 1.4㎥ — ~750㎥/일</option>
                                        <option value="백호 2.3㎥">백호 2.3㎥ — 대형 ~900㎥/일</option>
                                      </select>
                                      <span style={{ color: "#a16207" }}>토사 기준 · 암반은 지층 보정 자동</span>
                                    </label>
                                  )}
                                  {(() => {
                                    const labor = laborOf(Object.fromEntries(Object.entries(discEquip[d.key]!).filter(([name]) => equipAllowed(d.key, name))), d.key);
                                    const jobs = Object.keys(labor);
                                    if (!jobs.length) return null;
                                    return (
                                      <div style={{ marginTop: 5, fontSize: 10.5, color: "#78716c", borderTop: "1px dashed #fde68a", paddingTop: 4 }}>
                                        👷 <b>인력(직종별 자동)</b>: {jobs.map((j) => `${j} ${labor[j]}명`).join(" · ")}
                                        <span style={{ color: "#a16207" }}> — 작업조·장비 수 수정 시 자동 반영</span>
                                      </div>
                                    );
                                  })()}
                                </div>
                              )}
                              {qsum === 0 && <div style={{ fontSize: 10.5, color: "#a16207", marginTop: 2 }}>물량 미검출 — 평탄 공/산출내역서(CSV) 권장 (원가집계 문서엔 물량 표 없음)</div>}
                              {qsum > 0 && (
                                <div style={{ marginTop: 4, fontSize: 10.5, color: "#166534" }}
                                     title="내역서 물량으로 해당 공정 기간 자동 보정(factor=내역서물량÷BIM물량). IFC와 같으면 1.0=무변화, 누락 시 보완. 생성 후 BIM 대비 비교 표시.">
                                  ✅ 내역서 물량으로 기간 자동 보정 (IFC 누락 보완 · 생성 후 비교 표시)
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
            {bimBusy && <p style={{ fontSize: 12, color: "#2563eb", margin: "8px 0 0" }}>BIM 분석 중…</p>}
            {(() => {
              // 슬롯 파일들이 다른 프로젝트인지 검출 — 다르면 합치면 안 됨(좌표·층 어긋남, 공정표 엉킴).
              const keys = [...new Set(Object.values(slots).map((s) => projectKey(s.name)).filter(Boolean))];
              if (keys.length <= 1) return null;
              return (
                <p style={{ fontSize: 12, color: "#b91c1c", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "8px 12px", margin: "8px 0 0" }}>
                  ⚠️ <b>다른 프로젝트 파일이 섞인 것 같습니다</b> — {Object.entries(slots).map(([k, v]) => `${k}(${v.name})`).join(" · ")}
                  <br />좌표·층 체계가 달라 공정표·4D가 어긋납니다. <b>같은 프로젝트 파일인지 확인</b>하세요.
                </p>
              );
            })()}
            {Object.keys(slots).length > 1 && (
              <p style={{ fontSize: 12, color: "#15803d", margin: "8px 0 0" }}>
                🔗 복수 공종 병합 — {Object.keys(slots).join(" + ")}을(를) 시공순서로 연결해 1개 공정표로 생성합니다.
              </p>
            )}
            {inferReason && <p style={{ fontSize: 12, color: "#7c3aed", margin: "8px 0 0" }}>🤖 AI 판정: {inferReason}</p>}
            {workUnits.length > 0 && (() => {
              const hasB = storeys.some((s) => /^B|지하|^PT|PIT/i.test(s));
              const rec = recommendForm(structureType, hasB);
              return (
                <div style={{ marginTop: 10, background: "#faf5ff", border: "1px solid #e9d5ff", borderRadius: 10, padding: "10px 14px" }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: "#7c3aed", marginBottom: 6 }}>
                    🔎 분석 결과 — 플래닝 전 검토 (자동 판정값, 아래에서 수정 가능)
                  </div>
                  <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.75 }}>
                    {(slots["구조"] || slots["종합"]) && structureType && (
                      <div>· 🏢 <b>{slots["종합"] ? "OSC" : "구조"}</b> {structureType}
                        {!slots["종합"] && <> · 거푸집 {rec.formwork}</>} · 시공전략 {rec.strategy}
                        <span style={{ color: "#94a3b8" }}> (BIM 판정)</span></div>
                    )}
                    {(slots["토목"] || (civilQty && (civilQty.footprint_m2 || civilQty.depth_m))) && (
                      <div>· 🏗️ <b>토목</b> {civilQty?.footprint_m2 && civilQty?.depth_m
                        ? <>굴착 약 <b>{Math.round(civilQty.footprint_m2 * civilQty.depth_m).toLocaleString()}㎥</b> (흙막이 {civilQty.depth_m}m) · 권장 장비 {excavFleet}세트</>
                        : "흙막이·굴착"} <span style={{ color: "#94a3b8" }}>(지반 시추 저장 시 굴착 물량 지질모델로 자동 정밀화)</span></div>
                    )}
                    {(slots["건축"] || slots["MEP"] || slots["조경"]) && (
                      <div>· 🏛️ <b>{[slots["건축"] && "건축", slots["MEP"] && "MEP", slots["조경"] && "조경"].filter(Boolean).join("·")}</b> <span style={{ color: "#94a3b8" }}>(내역서 있으면 마감·설비 시퀀스 생성)</span></div>
                    )}
                    <div style={{ marginTop: 4 }}>· <b>가동률(공정별 자동 적용)</b> — 공기 = 공수 ÷ 가동률
                      {weatherStation && weatherLoading
                        ? <span style={{ color: "#b45309", fontSize: 11, marginLeft: 4 }}>· {weatherStation} 실측 계산 중…</span>
                        : weatherStation && weatherRates
                        ? <span style={{ color: "#15803d", fontSize: 11, marginLeft: 4 }}>· {weatherStation} 실측(ASOS 최근 5년)</span>
                        : <span style={{ color: "#94a3b8", fontSize: 11, marginLeft: 4 }}>· 프리셋(기상지역 선택 시 실측 재계산)</span>}:</div>
                    {weatherStation && weatherLoading ? (
                      // 실측 계산 중 — 프리셋(68% 등) 노출 금지(오해→플래닝 방지). 값 대신 안내.
                      <div style={{ marginTop: 3, fontSize: 11.5, color: "#b45309", display: "flex", alignItems: "center", gap: 6 }}>
                        <span className="wz-spin" style={{ width: 11, height: 11, border: "2px solid #fcd34d", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
                        {weatherStation} 최근 5년 기상 실측으로 공종별 가동률 계산 중… (잠시 후 표시)
                        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
                      </div>
                    ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 3 }}>
                      {UTIL_PRESET.map((u) => {
                        const v = (weatherStation && weatherRates && weatherRates[u.cat] != null) ? weatherRates[u.cat] : u.val;
                        return (
                          <span key={u.cat} title={u.note}
                                style={{ background: "#fff", border: `1px solid ${weatherStation && weatherRates ? "#a7f3d0" : "#e9d5ff"}`, borderRadius: 6, padding: "2px 8px", fontSize: 11.5,
                                         color: v <= 0.7 ? "#b91c1c" : v >= 0.92 ? "#15803d" : "#475569" }}>
                            {u.cat} <b>{Math.round(v * 100)}%</b>
                          </span>
                        );
                      })}
                    </div>
                    )}
                    <div style={{ marginTop: 5, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      · <b>기상지역</b>
                      <select className="wz-in" style={{ width: 132, padding: "2px 5px", fontSize: 11.5 }} value={weatherStation} onChange={(e) => setWeatherStation(e.target.value)}>
                        <option value="">미선택 (프리셋)</option>
                        {WEATHER_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <span style={{ color: weatherStation ? "#0369a1" : "#94a3b8", fontSize: 11 }}>
                        {weatherStation ? `→ ${weatherStation} 최근 5년 실측 기상으로 가동률 정밀 재산정(생성 시)` : "→ 선택 시 위 프리셋을 실측 기상으로 정밀화"}
                      </span>
                    </div>
                    <div style={{ marginTop: 5, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      · <b>연면적</b>
                      <input className="wz-in" type="number" style={{ width: 130, padding: "2px 5px", fontSize: 11.5 }} value={gfa} onChange={(e) => setGfa(e.target.value)}
                             placeholder="㎡ (선택)" title="연면적 — 건축·MEP 기간 정밀화(부재수 대신 물량 기반)" />
                      <span style={{ color: "#94a3b8", fontSize: 11 }}>건축·MEP 기간 정밀화</span>
                      <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, color: weatherStation ? "#94a3b8" : "#475569", marginLeft: 10, opacity: weatherStation ? 0.6 : 1 }}
                             title={weatherStation
                               ? `${weatherStation} 실측 가동률에 계절 손실이 이미 반영됨 → 중복(이중계산) 방지 위해 자동 비활성화`
                               : "동절기(12·1·2월)·우기(7·8월) 기상 중단일 자동 제외 — 프리셋 가동률에 계절 버퍼 추가"}>
                        <input type="checkbox" checked={weatherStation ? false : seasonal} disabled={!!weatherStation}
                               onChange={(e) => setSeasonal(e.target.checked)} />
                        계절 비작업일(동절기·우기){weatherStation ? " — 실측 가동률에 포함됨(자동)" : ""}
                      </label>
                    </div>
                    <div style={{ marginTop: 5, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      · <b>공사기간 프레임</b>
                      <span style={{ color: "#64748b", fontSize: 11.5 }}>준비기간</span>
                      <input className="wz-in" type="number" style={{ width: 70, padding: "2px 5px", fontSize: 11.5 }} value={prepDays} onChange={(e) => setPrepDays(e.target.value)}
                             placeholder="일" min={0} max={180} title="①준비기간 — 착공 전 가설사무소·측량·인허가(통상 30~60일). 국토부 고시 제2021-1080호: 공사기간=준비+작업+비작업+정리" />
                      <span style={{ color: "#64748b", fontSize: 11.5 }}>정리기간</span>
                      <input className="wz-in" type="number" style={{ width: 70, padding: "2px 5px", fontSize: 11.5 }} value={closeoutDays} onChange={(e) => setCloseoutDays(e.target.value)}
                             placeholder="일" min={0} max={90} title="④정리기간 — 준공 검사·청소·시설물 인계(통상 15~30일)" />
                      <span style={{ color: "#94a3b8", fontSize: 11 }}>국토부 고시 산정기준(준비+본공사+정리) — 비우면 미반영</span>
                    </div>
                    <div style={{ marginTop: 5, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      · <b>WBS 구조</b>
                      <select className="wz-in" style={{ width: 200, padding: "2px 5px", fontSize: 11.5 }} value={wbsStructure}
                              onChange={(e) => { setWbsStructure(e.target.value); setWbsCustomLabel(null); setWbsReason(null); }}>
                        <option value="zone">구역 중심 (구역 &gt; 공종) — 위치별 진도</option>
                        <option value="trade">공종 중심 (공종 &gt; 구역) — 협력업체·기성</option>
                        <option value="sequence">시공순서 중심 (단계 &gt; 차수 &gt; 구역) — CPM</option>
                        <option value="storey">층 중심 (층 &gt; 구역 &gt; 공종) — 층별 진도</option>
                        <option value="trade_detail">공종-구역-층 — 하도급 상세 기성</option>
                        <option value="practical">실무형 (선행·후행동 &gt; 구간 &gt; 공종트랙) — 마스터 공정표 관행</option>
                        {wbsCustomLabel && <option value={wbsStructure}>커스텀: {wbsCustomLabel}</option>}
                      </select>
                      <button onClick={onRecommendWbs} disabled={wbsRecBusy}
                        style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, border: "1px solid #c4b5fd", background: "#f5f3ff", color: "#7c3aed", cursor: wbsRecBusy ? "default" : "pointer" }}
                        title="프로젝트 맥락(구역·층·공종)으로 WBS 구조를 AI 추천">
                        {wbsRecBusy ? "추천 중…" : "🤖 WBS 재추천"}
                      </button>
                      <span style={{ color: "#94a3b8", fontSize: 11 }}>관리 방식만 다름 — 날짜·물량 불변(직교)</span>
                      {/* 자연어 WBS — "공종 중심으로", "층별 다음 공종별로" 등 직접 서술 → 키 순서 변환 */}
                      <div style={{ flexBasis: "100%", display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                        <input className="wz-in" value={wbsText} onChange={(e) => setWbsText(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") onWbsFromText(); }}
                          placeholder='예: "공종 중심으로", "층별 다음 공종별로 묶어줘"'
                          style={{ flex: 1, padding: "3px 8px", fontSize: 11.5 }} />
                        <button onClick={onWbsFromText} disabled={wbsRecBusy || !wbsText.trim()}
                          style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, border: "1px solid #a7f3d0", background: "#ecfdf5", color: "#059669", cursor: (wbsRecBusy || !wbsText.trim()) ? "default" : "pointer" }}>
                          💬 WBS 생성
                        </button>
                      </div>
                      {wbsCustomLabel && <div style={{ flexBasis: "100%", color: "#059669", fontSize: 11, marginTop: 2 }}>🗂 커스텀 WBS: {wbsCustomLabel}</div>}
                      {wbsReason && <div style={{ flexBasis: "100%", color: "#7c3aed", fontSize: 11, marginTop: 2 }}>🤖 {wbsReason}</div>}
                      {wbsPreview.length > 0 && (
                        <div style={{ flexBasis: "100%", marginTop: 4, padding: "6px 10px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 11, maxHeight: 170, overflowY: "auto" }}>
                          <div style={{ color: "#475569", fontWeight: 600, marginBottom: 3 }}>🗂 WBS 미리보기 (선택 구조 — work_units 기준, 날짜 무관)</div>
                          {wbsPreview.map((n, i) => (
                            <div key={i} style={{ paddingLeft: n.depth * 14, color: n.depth === 0 ? "#1e293b" : "#64748b", lineHeight: 1.6 }}>
                              {n.depth > 0 ? "└ " : "📁 "}{n.label}{n.count > 0 ? ` (${n.count})` : ""}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div style={{ marginTop: 5, color: "#94a3b8", fontSize: 11 }}>
                      ↓ 아래 공종 카드에서 가동률·거푸집·시공전략 수정 가능. <b>착공일·마감일</b>만 직접 입력하세요(사업 결정).
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="wz-card" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Field label="① 무엇을 — 건물유형 (비우면 생성 시 AI 자동 추천)">
              <input className="wz-in" value={buildingType} onChange={(e) => setBuildingType(e.target.value)} placeholder="비워두면 AI 가 추천 (예: 모듈러 공동주택)" />
              <input className="wz-in" style={{ marginTop: 6 }} value={scope} onChange={(e) => setScope(e.target.value)} placeholder="범위 (예: 골조까지 / 마감 포함)" />
              <p style={{ fontSize: 11, color: "#64748b", margin: "6px 0 0", lineHeight: 1.5 }}>
                ⓘ 연면적·기상지역·계절은 <b>분석 결과 카드</b>에서, 착공일·목표공기·가동률·근무·시공전략은 각 <b>공종 카드</b>에서 설정 · 공휴일 자동 제외
              </p>
            </Field>
            {slots["토목"] && civilQty && (
              <Field label="④ 토목 물량 (BIM 자동 도출)">
                <p style={{ fontSize: 11, color: "#0369a1", margin: 0 }}>
                  🏗️ 굴착깊이 {civilQty.depth_m}m · footprint {(civilQty.footprint_m2 ?? 0).toLocaleString()}㎡
                  · 굴착체적 ≈ {Math.round((civilQty.footprint_m2 ?? 0) * (civilQty.depth_m ?? 0)).toLocaleString()}㎥
                  · 흙막이 {(civilQty.pile_count ?? 0).toLocaleString()}공/둘레 {civilQty.perimeter_m}m
                  <br />→ 물량 기반 <b>권장 장비 {excavFleet}세트</b>(굴착기+덤프) 기준 ·
                  굴착 ≈ {Math.ceil((civilQty.footprint_m2 ?? 0) * (civilQty.depth_m ?? 0) / (600 * Math.max(1, excavFleet)) / 26)}개월 추정
                  (토목 슬롯에서 장비 세트 조정 가능 — 늘릴수록 단축)
                </p>
              </Field>
            )}
            <Field label="⑤ 외부 마일스톤 — 인허가 게이트·장납기 자재 (프로젝트 공통, 선택)">
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
                {([
                  { name: "착공신고", gates: "전체", kind: "permit" },
                  { name: "굴토심의 통과", gates: "토목", kind: "permit" },
                  { name: "지하안전영향평가", gates: "토목", kind: "permit" },
                  { name: "철골 현장반입", gates: "구조", kind: "material" },
                  { name: "사용승인(준공)", gates: "전체", kind: "permit" },
                ] as const).map((p) => (
                  <button key={p.name} type="button" className="wz-chip"
                          onClick={() => setMilestones((ms) => ms.some((m) => m.name === p.name) ? ms
                            : [...ms, { name: p.name, target_date: "", gates: p.gates, kind: p.kind }])}>
                    + {p.name}
                  </button>
                ))}
              </div>
              {milestones.map((m, i) => (
                <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <select className="wz-in" style={{ width: 92 }} value={m.kind}
                          onChange={(e) => setMilestones((ms) => ms.map((x, j) => j === i ? { ...x, kind: e.target.value } : x))}>
                    <option value="permit">인허가</option><option value="material">자재반입</option><option value="contract">계약</option>
                  </select>
                  <input className="wz-in" style={{ flex: 1, minWidth: 160 }} value={m.name} placeholder="마일스톤명 (예: 수배전반 현장반입)"
                         onChange={(e) => setMilestones((ms) => ms.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                  <input type="date" className="wz-in" style={{ width: 150 }} value={m.target_date}
                         onChange={(e) => setMilestones((ms) => ms.map((x, j) => j === i ? { ...x, target_date: e.target.value } : x))} />
                  <select className="wz-in" style={{ width: 92 }} value={m.gates} title="이 날짜 이후 착수 가능한 대상 공종"
                          onChange={(e) => setMilestones((ms) => ms.map((x, j) => j === i ? { ...x, gates: e.target.value } : x))}>
                    <option value="전체">전체</option><option value="토목">토목</option><option value="구조">구조</option>
                    <option value="건축">건축</option><option value="MEP">MEP</option><option value="조경">조경</option>
                  </select>
                  <button type="button" className="wz-chip" onClick={() => setMilestones((ms) => ms.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
              <button type="button" className="wz-chip"
                      onClick={() => setMilestones((ms) => [...ms, { name: "", target_date: "", gates: "전체", kind: "permit" }])}>
                + 직접 추가
              </button>
              <p style={{ fontSize: 11, color: "#64748b", margin: "6px 0 0" }}>
                ⓘ 게이트 공종은 해당 날짜 이후에만 착수합니다 (예: 굴토심의 통과일 이전엔 토목 굴착 불가). 장납기 자재(수배전반 12~18개월·철골 9~12개월·엘리베이터·커튼월)는 <b>현장반입일</b>로 입력하세요.
              </p>
            </Field>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "flex-end", gap: 10 }}>
              {Object.keys(slots).length > 0 && (
                <span style={{ fontSize: 12, color: "#475569" }}>
                  {workUnits.length > 0
                    ? <>📦 워크패키지 <b>{workUnits.length}</b> · 구역 {zones.length} · 층 {storeys.length}</>
                    : <>📂 {Object.keys(slots).join("+")} 업로드됨 · [분석] 누르세요</>}
                </span>
              )}
              {workUnits.length === 0 ? (
                <button className="wz-btn" disabled={!Object.keys(slots).length || bimBusy} onClick={() => void onAnalyze()}
                        title="업로드한 IFC 를 분석해 공종·구조유형 판정 + 건물유형을 추천합니다">
                  {bimBusy ? "분석 중…" : "📊 분석 — 공종·구조 판정 & 건물유형 추천"}
                </button>
              ) : (
                <button className="wz-btn" disabled={!startDate || busy} onClick={() => void onStart()}>
                  {busy ? "생성 중…" : "P1 스코프 확정 → P2 액티비티 생성"}
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* WBS 요약 (P1 산출) */}
      {scopeWbs && step >= 1 && (
        <details className="wz-card" style={{ background: "#f8fafc" }} open={step === 1 && running}>
          <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#334155" }}>
            P1 스코프 — WBS · 워크패키지 {scopeWbs.package_count} · 구역 {scopeWbs.zones.length}
          </summary>
          <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 6, fontSize: 12, color: "#475569" }}>
            {scopeWbs.wbs.map((z) => (
              <div key={z.zone} style={{ border: "1px solid #f1f5f9", borderRadius: 8, padding: "6px 10px" }}>
                <b style={{ color: "#1e293b" }}>{z.zone}</b>
                <span style={{ color: "#94a3b8" }}> · {z.storeys.length}개 층</span>
                <div style={{ marginTop: 2, color: "#64748b" }}>
                  {z.storeys[0]?.storey} ~ {z.storeys[z.storeys.length - 1]?.storey}
                  {" — "}{[...new Set(z.storeys.flatMap((s) => s.discs))].join(" · ")}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* ── 플래닝 완료 — 검토·수정·컨펌 (회사 노하우: 플래닝 끝 → DB → 사람 수정/컨펌 → 스케줄링) ── */}
      {stage === "logic_ready" && (
        <div className="wz-card">
          <div className="wz-gate-head">
            <div>
              <span className="wz-gate-badge">⏸ 플래닝 완료</span>
              <b style={{ fontSize: 14 }}> 액티비티 {acts.length}개 — 검토 후 스케줄링으로</b>
              {plan?.payload.strategy && (
                <span style={{ marginLeft: 8, fontSize: 11.5, padding: "3px 10px", borderRadius: 12,
                               background: plan.payload.strategy === "top_down" ? "#fce7f3" : "#e0f2fe",
                               color: plan.payload.strategy === "top_down" ? "#be185d" : "#0369a1", fontWeight: 700 }}>
                  {plan.payload.strategy === "top_down" ? "역타 (지하·지상 병행)" : plan.payload.strategy === "bottom_up_phased" ? "순타·단계 (구역별 연속)" : "순타·일괄 (전 구역 지하 먼저)"}
                </span>
              )}
              {dirty && <em style={{ fontSize: 12, color: "#d97706", marginLeft: 8 }}>수정됨 · 미저장</em>}
              <p style={{ fontSize: 12, color: "#64748b", margin: "4px 0 0" }}>
                WBS → 액티비티 정의 → 리스트 → 릴레이션 → 듀레이션까지 완료됐습니다.
                활동명·기간·선행을 직접 수정하거나 삭제한 뒤 <b>컨펌하면 공정표 베이스라인을 생성</b>합니다.
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <button className="wz-btn ghost" disabled={!dirty || busy} onClick={() => void onSaveActs()}>수정 저장</button>
              <button className="wz-btn green" disabled={busy} onClick={() => void onConfirm()}>컨펌 → 공정 스케줄링 (베이스라인)</button>
            </div>
          </div>
          {plan?.payload.rationale && (
            <details className="wz-rat" open>
              <summary>🧠 AI 판단 근거 — 왜 이렇게 계획했는가</summary>
              <div className="wz-rat-body">
                {plan.payload.rationale.define && (
                  <p><b>액티비티 분해</b> — {plan.payload.rationale.define}</p>
                )}
                {plan.payload.rationale.relation && (
                  <p><b>선후행</b> — {plan.payload.rationale.relation}</p>
                )}
                {plan.payload.rationale.duration && (
                  <p><b>기간 산정</b> — {plan.payload.rationale.duration}</p>
                )}
              </div>
            </details>
          )}
          <div className="wz-tablewrap">
            <table className="wz-table">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>활동명</th><th>구역</th><th>층</th><th>공종</th>
                  <th style={{ width: 80 }}>기간(일)</th>
                  <th style={{ width: 56 }} title="필요 타워크레인 (양중작업) — SGS 자원 평준화 입력">🏗️</th>
                  <th style={{ width: 56 }} title="필요 작업조 — SGS 자원 평준화 입력">👷</th>
                  <th style={{ textAlign: "left", width: "22%" }} title="선행 활동 code (쉼표 구분). 아래 배지 = 관계타입 FS/SS/FF/SF + lag(일). 온톨로지 에이전틱 릴레이션이 판정.">선행 · 관계(FS/SS/FF+lag)</th><th />
                </tr>
              </thead>
              <tbody>
                {acts.map((a, i) => (
                  <tr key={a.code}>
                    <td><input className="wz-cell" value={a.name} onChange={(e) => editAct(i, { name: e.target.value })} /></td>
                    <td className="c">{a.fd_zone ?? "—"}</td>
                    <td className="c">{a.fd_storey ?? "—"}</td>
                    <td className="c">{a.fd_op ? OP_KO[a.fd_op] ?? a.fd_op : a.milestone ? "◆MS" : "—"}</td>
                    <td className="c">
                      <input type="number" min={0} className="wz-cell c" style={{ width: 60 }} value={a.duration_days}
                             onChange={(e) => editAct(i, { duration_days: Number(e.target.value) })} disabled={a.milestone} />
                    </td>
                    <td className="c">
                      <input type="number" min={0} max={9} className="wz-cell c" style={{ width: 44 }} value={a.res_crane ?? 0}
                             onChange={(e) => editAct(i, { res_crane: Number(e.target.value) })} disabled={a.milestone} />
                    </td>
                    <td className="c">
                      <input type="number" min={0} max={9} className="wz-cell c" style={{ width: 44 }} value={a.res_crew ?? 0}
                             onChange={(e) => editAct(i, { res_crew: Number(e.target.value) })} disabled={a.milestone} />
                    </td>
                    <td>
                      <input className="wz-cell" value={(a.predecessors ?? []).map((p) => p.code).join(", ")}
                             onChange={(e) => {
                               const codes = e.target.value.split(/[\s,]+/).filter(Boolean);
                               const prev = a.predecessors ?? [];
                               editAct(i, { predecessors: codes.map((c) => prev.find((p) => p.code === c) ?? { code: c, type: "FS", lag_days: 0 }) });
                             }} />
                      {(a.predecessors ?? []).some((p) => p.type !== "FS" || (p.lag_days ?? 0) !== 0) && (
                        <div style={{ fontSize: 10, color: "#64748b", marginTop: 3, lineHeight: 1.4 }}>
                          {(a.predecessors ?? []).map((p) => (
                            <span key={p.code} style={{ marginRight: 6 }}>
                              <b style={{ color: p.type === "FS" ? "#94a3b8" : p.type === "SS" ? "#2563eb" : p.type === "FF" ? "#7c3aed" : "#0891b2" }}>{p.type}</b>
                              {(p.lag_days ?? 0) !== 0 ? `+${p.lag_days}` : ""}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="c"><button className="wz-del" onClick={() => removeAct(i)}>삭제</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Step 4: Gate C ── */}
      {(stage === "scheduled" || stage === "done") && (
        <div className="wz-card">
          <div className="wz-gate-head">
            <div>
              <span className="wz-gate-badge" style={stage === "done" ? { background: "#dcfce7", color: "#15803d" } : undefined}>
                {stage === "done" ? "✅ 베이스라인 확정" : "⏸ 공정 스케줄링"}
              </span>
              <b style={{ fontSize: 14 }}> {stage === "done" ? "공정표 베이스라인이 확정되었습니다" : "공정표 베이스라인 — 최종 검토"}</b>
              <p style={{ fontSize: 12, color: "#64748b", margin: "4px 0 0" }}>
                플래닝 기반으로 CPM 날짜를 계산한 베이스라인입니다. {stage === "scheduled" ? "간트를 검토하고 확정하세요." : "P6 XML 을 다운로드해 Primavera 에서 사용하세요."}
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              {stage === "scheduled" && (
                <button className="wz-btn green" disabled={busy} onClick={() => void onConfirm()}>베이스라인 확정</button>
              )}
              {planId && (
                <a className="wz-btn ghost" style={{ textDecoration: "none" }} href={planP6XmlDownloadUrl(planId)}>P6 XML 다운로드</a>
              )}
              {planId && (
                <a className="wz-btn ghost" style={{ textDecoration: "none" }} href={planXerUrl(planId)}>P6 XER 다운로드</a>
              )}
              {planId && (
                <button className="wz-btn ghost" disabled={basisBusy}
                  title="물량÷생산성÷투입조÷가동율 = Calendar Day 산정근거 표"
                  onClick={() => { setBasisBusy(true); void getBasis(planId).then(setBasis).finally(() => setBasisBusy(false)); }}>
                  {basisBusy ? "산정근거 불러오는 중…" : "📋 공정계획서(산정근거)"}
                </button>
              )}
              {planId && (
                <a className="wz-btn" style={{ textDecoration: "none" }} href={`/fourd?plan=${planId}`}
                   title="업로드한 IFC(공종 태그째) + 이 공정표로 통합 4D 시뮬레이션">🧊 4D로 보기</a>
              )}
              {stage === "done" && (
                <button className="wz-btn" onClick={() => {
                  setPlanId(null); setPlan(null); setActs([]); setErr(null); setDirty(false);
                  localStorage.removeItem(PLAN_CKPT);
                  router.replace("?");
                }}>새 계획 시작</button>
              )}
            </div>
          </div>
          {plan?.payload.schedule && (
            <div className="wz-rat-body" style={{ marginBottom: 10 }}>
              <p><b>베이스라인 근거</b> — PM이 컨펌한 플래닝(활동·선후행·기간)을 입력으로,
                시스템이 CPM + SGS 자원 평준화(크레인·작업조 한도 내 배치)로 날짜를 결정론 계산했습니다.
                활동 {String((plan.payload.schedule as Record<string, unknown>).activity_count ?? ganttTasks.length)}개
                · 준공 {String((plan.payload.schedule as Record<string, unknown>).end_date ?? "-")}.
                {Array.isArray((plan.payload.schedule as Record<string, unknown>).warnings) &&
                  ((plan.payload.schedule as Record<string, unknown>).warnings as string[]).length > 0 && (
                  <span className="wz-rat-stat"> ⚠ 보정 {((plan.payload.schedule as Record<string, unknown>).warnings as string[]).length}건 (순환·기간상한 등)</span>
                )}
              </p>
            </div>
          )}
          {/* ── 고성능 AI 공정 검토 — 시공순서 모순 탐지(검토만) → 사람이 수정 버튼 ── */}
          {plan?.payload.schedule && (
            <div style={{ border: "1px solid #c7d2fe", background: "#eef2ff", borderRadius: 10, padding: "10px 14px", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <b style={{ fontSize: 13, color: "#4338ca" }}>🧠 AI 공정 검토</b>
                <span style={{ fontSize: 11.5, color: "#6366f1" }}>고성능 AI가 시공순서 모순(되메·단계역전·양생전타설 등)을 검토합니다 — 자동수정 X, 검토 후 사람이 결정</span>
                <button className="wz-btn" disabled={auditBusy || auditLoopBusy} style={{ fontSize: 12, marginLeft: "auto" }}
                  onClick={() => { setAuditBusy(true); setAuditFixMsg(null); setAuditLoopMsg(null); void planAudit(planId!).then((r) => setAudit(r.findings || [])).finally(() => setAuditBusy(false)); }}>
                  {auditBusy ? "검토 중…" : "🔍 AI 검토 실행"}
                </button>
                <button className="wz-btn" disabled={auditBusy || auditLoopBusy} style={{ fontSize: 12, background: "#4338ca", color: "#fff" }}
                  title="검토→수정을 모순이 사라질 때까지(최대 3회) 자동 반복하고 재스케줄합니다. 날짜는 결정론 CPM."
                  onClick={() => {
                    if (!confirm("AI가 시공순서 모순을 자동으로 해소합니다(검토→수정 최대 3회 반복 + 재스케줄). 진행할까요?")) return;
                    setAuditLoopBusy(true); setAudit(null); setAuditFixMsg(null);
                    void planAuditLoop(planId!, 3).then((r) => {
                      const rem = r.remaining?.length ? ` · 잔존 ${r.remaining.length}건: ${r.remaining.map((x) => x.title).join(" / ")}` : "";
                      setAuditLoopMsg(`${r.converged ? "✅ 모순 해소 완료" : "⚠️ 일부 잔존"} — ${r.iterations}회 반복·${r.fixed}건 수정${rem}`);
                      void getPlan(planId!).then(setPlan);   // 갱신 베이스라인 반영
                    }).finally(() => setAuditLoopBusy(false));
                  }}>
                  {auditLoopBusy ? "자동해소 중…(검토→수정 반복)" : "♻️ 모순 자동해소"}
                </button>
              </div>
              {auditLoopMsg && <div style={{ marginTop: 6, color: "#4338ca", fontSize: 12, fontWeight: 500 }}>{auditLoopMsg}</div>}
              {audit && audit.length === 0 && <div style={{ marginTop: 6, color: "#059669", fontSize: 12 }}>✅ 시공순서 모순이 발견되지 않았습니다.</div>}
              {audit && audit.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ color: "#991b1b", fontWeight: 600, fontSize: 12.5, marginBottom: 4 }}>⚠️ 모순 {audit.length}건 발견 — 수정할까요? (근거 확인 후 결정)</div>
                  {audit.map((f, i) => (
                    <div key={i} style={{ background: "#fff", border: "1px solid #e0e7ff", borderRadius: 8, padding: "7px 10px", marginBottom: 5, fontSize: 12 }}>
                      <div><b style={{ color: f.severity === "high" ? "#991b1b" : "#92400e" }}>{f.severity === "high" ? "🔴" : "🟡"} {f.title}</b></div>
                      {f.names && f.names.length > 0 && <div style={{ color: "#64748b", fontSize: 11, marginTop: 1 }}>관련: {f.names.join(" · ")}</div>}
                      <div style={{ marginTop: 2 }}><b>근거:</b> {f.reason}</div>
                      <div style={{ color: "#475569", marginTop: 1 }}><b>수정 방향:</b> {f.fix}</div>
                    </div>
                  ))}
                  <button className="wz-btn" disabled={auditFixBusy} style={{ fontSize: 12.5, background: "#4338ca", color: "#fff", marginTop: 2 }}
                    onClick={() => {
                      if (!confirm(`AI가 ${audit.length}건의 모순을 수정하고 재스케줄합니다. 진행할까요?`)) return;
                      setAuditFixBusy(true);
                      void planAuditFix(planId!).then((r) => {
                        setAuditFixMsg(r.fixed ? `✅ ${r.fixed}건 수정·재스케줄 완료. ${r.summary || ""}` : (r.summary || "수정할 모순이 없습니다."));
                        setAudit(null);
                        void getPlan(planId!).then(setPlan);   // 갱신된 베이스라인 반영
                      }).finally(() => setAuditFixBusy(false));
                    }}>
                    {auditFixBusy ? "AI 수정·재스케줄 중…" : `✏️ AI로 ${audit.length}건 수정 + 재스케줄`}
                  </button>
                </div>
              )}
              {auditFixMsg && <div style={{ marginTop: 6, color: "#4338ca", fontSize: 12 }}>{auditFixMsg}</div>}
            </div>
          )}
          {(() => {
            const lod = (plan?.payload.schedule as Record<string, unknown> | undefined)?.lod as
              | { level: string; label: string; zones: number; storeys: number; note: string } | undefined;
            if (!lod) return null;
            const c = lod.level === "zone" ? { bg: "#dcfce7", bd: "#86efac", fg: "#15803d", icon: "🎯" }
              : lod.level === "floor" ? { bg: "#fffbeb", bd: "#fde68a", fg: "#92400e", icon: "📐" }
              : { bg: "#fef2f2", bd: "#fecaca", fg: "#991b1b", icon: "⚠️" };
            return (
              <div style={{ border: `1px solid ${c.bd}`, background: c.bg, borderRadius: 10, padding: "8px 14px", fontSize: 12.5, color: c.fg, marginBottom: 10 }}>
                {c.icon} <b>상세수준: {lod.label}</b>
                {lod.zones > 0 && <span> · 구역 {lod.zones}</span>}
                {lod.storeys > 0 && <span> · 층 {lod.storeys}</span>}
                <br /><span style={{ color: "#78716c" }}>{lod.note}</span>
              </div>
            );
          })()}
          {(() => {
            // ── 공기 검증 — PM 이 알아야 할 것만: 등급+조치 · 인력/장비 · (문제일 때만) 경고 1줄. ──
            //    내부 검증 출처(쿠팡·과거P6·CPE)·적산 원단위·방법 설명은 노이즈라 비표시.
            const sched = plan?.payload.schedule as Record<string, unknown> | undefined;
            const conf = sched?.confidence as
              | { grade?: string; note?: string; crew?: Record<string, { peak: number }>; equipment?: Record<string, { peak: number }> } | undefined;
            const prod = sched?.productivity_check as { heavy_crew?: string[] } | undefined;
            const cpe = sched?.cpe_check as { items?: { method?: string; verdict: string; ratio?: number }[] } | undefined;
            const pert = sched?.pert as
              | { planned_days: number; opt_days: number; pess_days: number; p50_days: number; p80_days: number;
                  p50_date?: string; p80_date?: string; buffer_to_p80?: number; verdict?: string; note?: string } | undefined;
            const adq = sched?.adequacy as { summary?: string; over?: string[] } | undefined;
            if (!conf?.crew && !pert) return null;
            const c = conf?.grade === "적정" ? { bg: "#ecfdf5", bd: "#a7f3d0", fg: "#059669", icon: "✅" }
              : conf?.grade === "과소" ? { bg: "#fef2f2", bd: "#fecaca", fg: "#991b1b", icon: "⚠️" }
              : conf?.grade === "과다" ? { bg: "#fffbeb", bd: "#fde68a", fg: "#92400e", icon: "📉" }
              : { bg: "#f8fafc", bd: "#e2e8f0", fg: "#475569", icon: "📊" };
            const chip = (txt: string, tone: "labor" | "equip") => (
              <span key={txt} style={{ display: "inline-block", padding: "1px 7px", borderRadius: 6, marginRight: 4, marginBottom: 3,
                fontSize: 11.5, background: tone === "labor" ? "#eef2ff" : "#fff7ed", color: tone === "labor" ? "#4338ca" : "#9a3412" }}>{txt}</span>
            );
            // 표준 대비 어긋난 공법 — 구체 근거(공법·배수) 표시. 출처명(쿠팡/CPE)·중복은 제거.
            const _seen = new Set<string>();
            const offenders = (cpe?.items || []).filter((it) => !it.verdict.includes("적정"))
              .filter((it) => { const k = it.method || ""; if (_seen.has(k)) return false; _seen.add(k); return true; })
              .slice(0, 2);
            // PERT 신뢰 밴드 — 낙관~비관 축 위에 P50/P80/계획 위치 시각화
            const pertBand = pert && pert.pess_days > pert.opt_days ? (() => {
              const span = pert.pess_days - pert.opt_days;
              const pos = (d: number) => Math.max(0, Math.min(100, ((d - pert.opt_days) / span) * 100));
              const vc = pert.verdict === "공격적" ? "#dc2626" : pert.verdict === "여유" ? "#d97706" : "#059669";
              return (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed #e2e8f0" }}>
                  <div style={{ fontSize: 12 }}>
                    <b style={{ color: "#334155" }}>📈 공기 신뢰도 (삼점추정 P50/P80)</b>
                    <span style={{ marginLeft: 6, padding: "1px 7px", borderRadius: 6, fontSize: 11, background: `${vc}18`, color: vc, fontWeight: 600 }}>{pert.verdict}</span>
                    {pert.note && <span style={{ color: "#64748b", marginLeft: 6, fontSize: 11.5 }}>{pert.note}</span>}
                  </div>
                  <div style={{ position: "relative", height: 26, margin: "10px 2px 2px" }}>
                    <div style={{ position: "absolute", top: 11, left: 0, right: 0, height: 5, borderRadius: 3,
                      background: "linear-gradient(90deg,#a7f3d0 0%,#fde68a 60%,#fecaca 100%)" }} />
                    {([["P50", pert.p50_days, "#0369a1"], ["P80", pert.p80_days, "#7c3aed"]] as [string, number, string][]).map(([lb, d, col]) => (
                      <div key={lb} style={{ position: "absolute", left: `${pos(d)}%`, top: 0, transform: "translateX(-50%)", textAlign: "center" }}>
                        <div style={{ fontSize: 9.5, color: col, fontWeight: 700, whiteSpace: "nowrap" }}>{lb} {d}일</div>
                        <div style={{ width: 2, height: 12, background: col, margin: "0 auto" }} />
                      </div>
                    ))}
                    <div style={{ position: "absolute", left: `${pos(pert.planned_days)}%`, top: 4, transform: "translateX(-50%)", textAlign: "center" }}>
                      <div style={{ width: 0, height: 0, borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: `7px solid ${vc}`, margin: "0 auto" }} />
                      <div style={{ fontSize: 9.5, color: vc, fontWeight: 700, whiteSpace: "nowrap" }}>계획 {pert.planned_days}일</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#94a3b8", margin: "0 2px" }}>
                    <span>낙관 {pert.opt_days}일</span><span>비관 {pert.pess_days}일</span>
                  </div>
                  <div style={{ marginTop: 5, fontSize: 11.5, color: "#475569" }}>
                    P80 준공 <b>{pert.p80_date}</b>{(pert.buffer_to_p80 ?? 0) > 0 && <> · 80% 달성엔 버퍼 <b style={{ color: "#7c3aed" }}>+{pert.buffer_to_p80}일</b> 권장</>}
                  </div>
                  {adq?.summary && <div style={{ marginTop: 4, fontSize: 11, color: (adq.over?.length ?? 0) > 0 ? "#b45309" : "#64748b" }}>🗂 {adq.summary}
                    {(adq.over ?? []).includes("FM") && !["알폼", "시스템폼", "갱폼"].includes(formwork) && (
                      <button type="button" disabled={busy}
                        onClick={async () => {
                          if (!planId || !confirm("거푸집을 알폼으로 바꿔 재계산할까요? (사이클 ×0.5 — 실적 과다 해소 시뮬)")) return;
                          setBusy(true); setErr(null);
                          try { setFormwork("알폼"); await confirmPlan(planId, { formwork_system: "알폼" }); await refresh(planId); }
                          catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
                          finally { setBusy(false); }
                        }}
                        style={{ marginLeft: 8, padding: "1px 9px", borderRadius: 6, border: "1px solid #c4b5fd",
                                 background: "#f5f3ff", color: "#6d28d9", fontSize: 10.5, cursor: "pointer" }}>
                        ⚡ 알폼 적용 + 재계산
                      </button>
                    )}
                  </div>}
                </div>
              );
            })() : null;
            return (
              <div style={{ border: `1px solid ${c.bd}`, background: c.bg, borderRadius: 10, padding: "11px 14px", fontSize: 12.5, marginBottom: 10 }}>
                <div><b style={{ color: c.fg, fontSize: 13.5 }}>{c.icon} 공기 검증{conf?.grade ? ` · ${conf.grade}` : ""}</b>
                  {conf?.note && <span style={{ color: "#475569" }}> — {conf.note}</span>}</div>
                {conf?.crew && (
                <div style={{ marginTop: 7 }}>
                  <span style={{ color: "#94a3b8", fontSize: 11, marginRight: 4 }}>인력</span>
                  {Object.entries(conf.crew).map(([j, v]) => chip(`${j} ${v.peak}`, "labor"))}
                  {conf.equipment && Object.keys(conf.equipment).length > 0 && (
                    <><span style={{ color: "#94a3b8", fontSize: 11, margin: "0 4px 0 8px" }}>장비</span>
                      {Object.entries(conf.equipment).map(([e, v]) => chip(`${e} ${v.peak}`, "equip"))}</>
                  )}
                </div>
                )}
                {offenders.length > 0 && (
                  <div style={{ marginTop: 6, color: "#b45309", fontSize: 11.5 }}>
                    ⚠️ {offenders.map((it) => `${it.method} 표준 대비 ${it.verdict}${it.ratio ? ` ${it.ratio}배` : ""}`).join(" · ")} — 투입 장비·작업조 가정 확인 권장
                  </div>
                )}
                {pertBand}
              </div>
            );
          })()}
          {(() => {
            const risks = (plan?.payload.schedule as Record<string, unknown> | undefined)?.risks as ScheduleRisk[] | undefined;
            if (!risks || !risks.length) return null;
            const col = (s: string) => s === "high" ? { fg: "#991b1b", icon: "🔴" } : s === "medium" ? { fg: "#92400e", icon: "🟡" } : { fg: "#475569", icon: "⚪" };
            return (
              <div style={{ border: "1px solid #fecaca", background: "#fff7f7", borderRadius: 10, padding: "10px 14px", marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <b style={{ fontSize: 13, color: "#991b1b" }}>⚠️ 리스크 분석 — {risks.length}건</b>
                  <button className="wz-btn" disabled={briefBusy} style={{ fontSize: 12 }}
                          onClick={() => { setBriefBusy(true); void riskBrief(planId!).then((r) => setBrief(r.brief)).finally(() => setBriefBusy(false)); }}>
                    {briefBusy ? "분석 중…" : "🤖 AI 브리핑"}
                  </button>
                </div>
                {risks.map((r, i) => (
                  <div key={i} style={{ fontSize: 12, padding: "3px 0", borderTop: i ? "1px solid #fde0e0" : undefined, color: col(r.severity).fg }}>
                    {col(r.severity).icon} <b>{r.title}</b> <span style={{ color: "#78716c" }}>— {r.detail}</span>
                    <br /><span style={{ color: "#0369a1" }}>→ {r.mitigation}</span>
                  </div>
                ))}
                {brief && (
                  <div style={{ marginTop: 8, padding: "8px 10px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, fontSize: 12, color: "#1e3a8a", whiteSpace: "pre-wrap" }}>
                    🤖 {brief}
                  </div>
                )}
              </div>
            );
          })()}
          {(() => {
            const cov = (plan?.payload.schedule as Record<string, unknown> | undefined)?.boq_coverage as
              Record<string, { total: number; covered: number; uncovered: string[] }> | undefined;
            const entries = cov ? Object.entries(cov).filter(([, c]) => c.total > 0) : [];
            if (!entries.length) return null;
            const totUnc = entries.reduce((s, [, c]) => s + (c.uncovered?.length || 0), 0);
            return (
              <div style={{ border: "1px solid #ddd6fe", background: "#f5f3ff", borderRadius: 10, padding: "10px 14px", marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <b style={{ fontSize: 13, color: "#5b21b6" }}>📋 내역서 대조 — {totUnc ? `${totUnc}개 항목 공정표 누락` : "전 항목 반영 ✓"}</b>
                  {totUnc > 0 && (
                    <button className="wz-btn" disabled={boqBriefBusy} style={{ fontSize: 12 }}
                            onClick={() => { setBoqBriefBusy(true); void boqBrief(planId!).then((r) => setBoqBriefTxt(r.brief)).finally(() => setBoqBriefBusy(false)); }}>
                      {boqBriefBusy ? "분석 중…" : "🤖 AI 브리핑"}
                    </button>
                  )}
                </div>
                {entries.map(([disc, c]) => (
                  <div key={disc} style={{ fontSize: 12, padding: "3px 0", color: "#4c1d95" }}>
                    <b>{disc}</b> — 내역서 {c.total}항목 중 <b>{c.covered}</b> 반영
                    {c.uncovered?.length ? <span style={{ color: "#b45309" }}> · 누락: {c.uncovered.join(", ")}</span> : <span style={{ color: "#15803d" }}> · 누락 없음</span>}
                  </div>
                ))}
                {boqBriefTxt && (
                  <div style={{ marginTop: 8, padding: "8px 10px", background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: 8, fontSize: 12, color: "#3730a3", whiteSpace: "pre-wrap" }}>
                    🤖 {boqBriefTxt}
                  </div>
                )}
              </div>
            );
          })()}
          {(() => {
            const tgt = (plan?.payload.schedule as Record<string, unknown> | undefined)?.target as
              | { target_days: number; achieved_days?: number; met?: boolean; advice?: string;
                  suggestion?: { crane: number; crew: number; days: number } | null } | undefined;
            if (!tgt || stage === "done") return null;
            const m = (d?: number) => (d ? `${Math.round(d / 30.4)}개월` : "-");
            return tgt.met ? (
              <div style={{ border: "1px solid #bbf7d0", background: "#f0fdf4", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#15803d", marginBottom: 10 }}>
                ✅ 목표공기 달성 — 목표 {m(tgt.target_days)} / 산출 {m(tgt.achieved_days)}
              </div>
            ) : (
              <div style={{ border: "1px solid #fde68a", background: "#fffbeb", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#92400e", marginBottom: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ flex: 1 }}>
                  ⚠ 목표공기 초과 — 목표 <b>{m(tgt.target_days)}</b> vs 산출 <b>{m(tgt.achieved_days)}</b>.
                  {tgt.suggestion
                    ? <> 크레인 <b>{tgt.suggestion.crane}대</b>·작업조 <b>{tgt.suggestion.crew}조</b>면 <b>{m(tgt.suggestion.days)}</b> 달성 가능.</>
                    : <> 자원 증설로는 불가 — 선후행·기간이 지배(공법·플래닝 재검토 필요).</>}
                </span>
                {tgt.suggestion && (
                  <button className="wz-btn" disabled={busy} onClick={() => {
                    setBusy(true);
                    void confirmPlan(planId!, { crane: tgt.suggestion!.crane, crew: tgt.suggestion!.crew })
                      .then(() => refresh(planId!)).finally(() => setBusy(false));
                  }}>이 자원으로 재스케줄</button>
                )}
              </div>
            );
          })()}
          {stage === "scheduled" && civilQty && (
            <div style={{ border: "1px solid #bae6fd", background: "#f0f9ff", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#0369a1", marginBottom: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ flex: 1 }}>
                🏗️ 토목이 길면 <b>굴착 장비 세트(백호·덤프·CIP 대수)</b>를 늘리세요 — 굴착 {(discBoq["토목"]?.quantities?.excavation_m3 || Math.round((civilQty?.footprint_m2 ?? 0) * (civilQty?.depth_m ?? 0))).toLocaleString()}㎥ ÷ (표준품셈 생산성 × 장비 세트). 늘릴수록 토목 기간 단축.
              </span>
              <label style={{ display: "flex", alignItems: "center", gap: 4 }}>굴착 장비(백호) 세트
                <input type="number" min={1} className="wz-in" style={{ width: 72 }} value={excavFleet} onChange={(e) => setExcavFleet(Number(e.target.value))} />
              </label>
              <button className="wz-btn" disabled={busy} onClick={() => {
                setBusy(true);
                void confirmPlan(planId!, { civil_equipment: excavFleet }).then(() => refresh(planId!)).finally(() => setBusy(false));
              }}>토목 기간 재계산</button>
            </div>
          )}
          {ganttReady && ganttTasks.length > 0 ? (
            <GanttChart tasks={ganttTasks} height={520} viewMode="Week" fillWidth />
          ) : (
            <div style={{ fontSize: 13, color: "#94a3b8", padding: 20 }}>간트 렌더링 준비 중… (활동 {ganttTasks.length}개)</div>
          )}
        </div>
      )}

      <style jsx>{`
        .wz-steps { display: flex; gap: 0; align-items: stretch; }
        .wz-step { flex: 1; display: flex; align-items: center; gap: 9px; padding: 10px 14px; border: 1px solid #e2e8f0;
                   background: #fff; color: #94a3b8; position: relative; }
        .wz-step:first-child { border-radius: 10px 0 0 10px; }
        .wz-step:last-child { border-radius: 0 10px 10px 0; }
        .wz-step + .wz-step { border-left: none; }
        .wz-step b { display: block; font-size: 12px; line-height: 1.2; }
        .wz-step small { display: block; font-size: 11px; }
        .wz-step.on { background: #eff6ff; border-color: #bfdbfe; color: #1d4ed8; }
        .wz-step.done { background: #f0fdf4; color: #15803d; }
        .wz-step-badge { width: 22px; height: 22px; border-radius: 50%; background: #e2e8f0; color: #64748b;
                         display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0; }
        .wz-step.on .wz-step-badge { background: #2563eb; color: #fff; }
        .wz-step.done .wz-step-badge { background: #22c55e; color: #fff; }
        .wz-step.big { padding: 12px 16px; }
        .wz-substeps { display: flex; gap: 5px; margin-top: 5px; flex-wrap: wrap; }
        .wz-substep { font-size: 10.5px; padding: 2px 8px; border-radius: 10px; background: #f1f5f9; color: #94a3b8; }
        .wz-substep.on { background: #dbeafe; color: #1d4ed8; font-weight: 700; }
        .wz-substep.done { background: #dcfce7; color: #15803d; }
        .wz-step-arrow { position: absolute; right: -6px; top: 50%; transform: translateY(-50%); color: #cbd5e1; font-size: 16px; z-index: 1; }
        .wz-card { border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; background: #fff; }
        .wz-in { width: 100%; padding: 7px 9px; border: 1px solid #cbd5e1; border-radius: 7px; font-size: 13px; box-sizing: border-box; background: #fff; }
        .wz-sub { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: #64748b; flex: 1; }
        .wz-chip { padding: 3px 10px; border: 1px solid #cbd5e1; border-radius: 13px; font-size: 11.5px;
                   background: #fff; color: #475569; cursor: pointer; }
        .wz-chip:hover { border-color: #2563eb; color: #2563eb; }
        .wz-bim { display: inline-block; padding: 9px 14px; border: 1px dashed #94a3b8; border-radius: 8px; font-size: 12.5px;
                  cursor: pointer; color: #475569; background: #f8fafc; }
        .wz-bim:hover { border-color: #2563eb; color: #2563eb; }
        .wz-btn { padding: 8px 16px; background: #2563eb; color: #fff; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; }
        .wz-btn:disabled { background: #cbd5e1; cursor: not-allowed; }
        .wz-btn.green { background: #16a34a; }
        .wz-btn.green:disabled { background: #cbd5e1; }
        .wz-btn.ghost { background: #fff; color: #334155; border: 1px solid #cbd5e1; }
        .wz-btn.ghost:disabled { color: #cbd5e1; }
        .wz-gate-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
        .wz-gate-badge { display: inline-block; padding: 3px 10px; border-radius: 13px; background: #fef3c7; color: #b45309;
                         font-size: 12px; font-weight: 700; margin-right: 6px; }
        .wz-tablewrap { max-height: 480px; overflow: auto; border: 1px solid #e2e8f0; border-radius: 8px; }
        .wz-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .wz-table thead th { position: sticky; top: 0; background: #f1f5f9; color: #475569; font-size: 11px;
                             padding: 8px; border-bottom: 1px solid #e2e8f0; z-index: 1; }
        .wz-table td { padding: 4px 6px; border-bottom: 1px solid #f1f5f9; color: #475569; }
        .wz-table td.c { text-align: center; }
        .wz-table tbody tr:hover { background: #f8fafc; }
        .wz-cell { width: 100%; padding: 4px 7px; border: 1px solid transparent; border-radius: 5px; font-size: 12px;
                   background: transparent; box-sizing: border-box; }
        .wz-cell.c { text-align: center; }
        .wz-cell:hover { border-color: #cbd5e1; background: #fff; }
        .wz-cell:focus { border-color: #2563eb; background: #fff; outline: none; }
        .wz-del { background: none; border: none; color: #ef4444; font-size: 11px; cursor: pointer; }
        .wz-del:hover { text-decoration: underline; }
        .wz-rat { border: 1px solid #e9d5ff; background: #faf5ff; border-radius: 10px; padding: 10px 14px; margin-bottom: 12px; }
        .wz-rat summary { cursor: pointer; font-size: 12.5px; font-weight: 700; color: #7c3aed; }
        .wz-rat-body { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
        .wz-rat-body p { margin: 0; font-size: 12.5px; color: #475569; line-height: 1.65; }
        .wz-rat-body b { color: #1e293b; }
        .wz-rat-stat { color: #7c3aed; font-size: 11.5px; }
        .wz-stream { border: 1px solid #e0e7ff; background: #f5f7ff; border-radius: 10px; padding: 14px; }
        .wz-stream-head { display: flex; align-items: center; gap: 8px; font-size: 13px; margin-bottom: 12px; }
        .wz-dot { width: 9px; height: 9px; border-radius: 50%; background: #6366f1; animation: wz-pulse 1s ease-in-out infinite; }
        @keyframes wz-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .4; transform: scale(.7); } }
        .wz-skel-rows { display: flex; flex-direction: column; gap: 9px; }
        .wz-skel-row { display: flex; align-items: center; gap: 10px; }
        .wz-skel-label { width: 130px; height: 13px; border-radius: 4px; background: linear-gradient(90deg,#e2e8f0 25%,#eef2f7 50%,#e2e8f0 75%); background-size: 200% 100%; animation: wz-shim 1.4s linear infinite; flex-shrink: 0; }
        .wz-skel-bar { height: 16px; border-radius: 4px; background: linear-gradient(90deg,#c7d2fe 25%,#e0e7ff 50%,#c7d2fe 75%); background-size: 200% 100%; animation: wz-shim 1.4s linear infinite; }
        @keyframes wz-shim { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
      `}</style>
      {basis && (() => {
        const fmt = (v: number | null) => (v == null ? "" : Number.isInteger(v) ? String(v) : String(v));
        const exportCsv = () => {
          const head = ["공정", "공종", "활동", "구역", "층", "단위", "물량", "생산성", "투입조", "생산량/일", "작업기간(WD)", "가동율", "CalendarDay"];
          const lines = [head.join(",")];
          for (const g of basis.groups) for (const r of g.rows)
            lines.push([g.phase, r.discipline, `"${(r.name || "").replace(/"/g, "''")}"`, r.zone || "", r.storey || "",
              r.unit || "", fmt(r.qty), fmt(r.productivity), fmt(r.crew), fmt(r.daily), r.wd, r.util, r.cd].join(","));
          lines.push(["", "", "총계", "", "", "", "", "", "", "", "", "", basis.total_cd].join(","));
          const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
          const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
          a.download = `공정계획서_산정근거_${basis.project_name}.csv`; a.click(); URL.revokeObjectURL(a.href);
        };
        return (
          <div onClick={() => setBasis(null)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, maxWidth: 1280, width: "100%", maxHeight: "90vh", overflow: "auto", padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, position: "sticky", top: 0, background: "#fff", paddingBottom: 8, borderBottom: "1px solid #e2e8f0" }}>
                <div><b style={{ fontSize: 15 }}>📋 공정계획서 — 산정근거</b>
                  <span style={{ color: "#64748b", fontSize: 12.5, marginLeft: 8 }}>물량 ÷ (생산성 × 투입조) ÷ 가동율 = Calendar Day</span>
                  <div style={{ fontSize: 12.5, color: "#0f172a", marginTop: 3 }}>적정공기 <b>{basis.total_cd.toLocaleString()}일 = {basis.total_months}개월</b>
                    {Object.keys(basis.util).length > 0 && <span style={{ color: "#64748b", marginLeft: 10 }}>가동율: {Object.entries(basis.util).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(" · ")}</span>}</div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="wz-btn ghost" onClick={exportCsv}>⬇ Excel(CSV)</button>
                  <button className="wz-btn ghost" onClick={() => setBasis(null)}>닫기</button>
                </div>
              </div>
              {basis.groups.map((g) => (
                <div key={g.phase} style={{ marginBottom: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#1d4ed8", background: "#eff6ff", padding: "5px 10px", borderRadius: 6 }}>
                    {g.phase} <span style={{ color: "#64748b", fontWeight: 400 }}>— {g.cd.toLocaleString()}일 ({g.months}개월)</span></div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5, marginTop: 4 }}>
                    <thead><tr style={{ color: "#64748b", textAlign: "right" }}>
                      {["공종", "활동", "단위", "물량", "생산성", "투입조", "생산량/일", "WD", "가동율", "CD"].map((h, i) => (
                        <th key={h} style={{ padding: "3px 6px", textAlign: i < 2 ? "left" : "right", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" }}>{h}</th>))}
                    </tr></thead>
                    <tbody>
                      {g.rows.map((r, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "3px 6px", color: "#475569" }}>{r.discipline}</td>
                          <td style={{ padding: "3px 6px" }}>{r.name}{r.inferred && <span style={{ color: "#a78bfa", marginLeft: 4 }} title="온톨로지 미수록 추정">🤖</span>}</td>
                          <td style={{ padding: "3px 6px", textAlign: "right", color: "#94a3b8" }}>{r.unit}</td>
                          <td style={{ padding: "3px 6px", textAlign: "right" }}>{r.qty?.toLocaleString()}</td>
                          <td style={{ padding: "3px 6px", textAlign: "right" }}>{r.productivity ?? "—"}</td>
                          <td style={{ padding: "3px 6px", textAlign: "right" }}>{r.crew ?? "—"}</td>
                          <td style={{ padding: "3px 6px", textAlign: "right", color: "#64748b" }}>{r.daily?.toLocaleString()}</td>
                          <td style={{ padding: "3px 6px", textAlign: "right" }}>{r.wd}</td>
                          <td style={{ padding: "3px 6px", textAlign: "right", color: "#94a3b8" }}>{Math.round(r.util * 100)}%</td>
                          <td style={{ padding: "3px 6px", textAlign: "right", fontWeight: 600 }}>{r.cd}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>{label}</label>
      {children}
    </div>
  );
}
