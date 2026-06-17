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
  confirmPlan, extractIfcWorkUnitsViaS3, getPlan, ifcDiff, inferScheduleContext, planP6XmlUrl, type IfcWorkUnitsResult,
  savePlanActivities, startPlan, ScheduleApiError,
  type GanttTask, type GenMilestone, type GenWorkUnit, type IfcDiffResult, type PlanActivity, type PlanScopeWbs, type PlanStage, type PlanState,
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
  { key: "가설", label: "가설", icon: "🚧", active: false, hint: "비계·거푸집(오버레이)" },
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
  const schedTotal = SCHEDULABLE.reduce((s, k) => s + (m[k] || 0), 0);
  const temp = m["가설"] || 0;
  if (schedTotal === 0) return `⚠️ ${slot} 공정 부재가 없습니다 (가설/미상 위주) — 슬롯이 맞나요?`;
  const slotN = m[slot] || 0;
  const share = slotN / schedTotal;
  if (share >= 0.5) {
    return temp > schedTotal
      ? `ℹ️ ${slot} ${slotN.toLocaleString()}개 + 가설 ${temp.toLocaleString()}개(오버레이)`
      : null; // 슬롯 공종 우세 — 정상
  }
  let dom = slot, domN = slotN;
  for (const k of SCHEDULABLE) if ((m[k] || 0) > domN) { dom = k; domN = m[k] || 0; }
  return `⚠️ 이 파일은 ${dom} 위주입니다 (${slot} ${Math.round(share * 100)}%) — 슬롯이 맞나요?`;
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
const PH_KO: Record<string, string> = { RB: "철근", FM: "거푸집", CN: "콘크리트", IN: "설치" };

export default function SchedulePlanWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // ── 1단계: 입력 폼 ──
  const [buildingType, setBuildingType] = useState("");
  const [scope, setScope] = useState("");
  const [structureType, setStructureType] = useState("");
  const [discipline, setDiscipline] = useState(""); // 공종(토목/구조/건축/MEP/조경) — 자동채움+사람수정(휴먼인더루프)
  const [slots, setSlots] = useState<Record<string, { name: string; count?: number; wp?: number; warn?: string | null }>>({}); // 공종별 업로드 현황(count/wp 는 생성 시 분석 후)
  const slotFilesRef = useRef<Record<string, File>>({}); // 공종별 원본 IFC(File) — 4D 전달용(공종 태그 보존)
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10)); // 오늘 기본 — 업로드+버튼 원클릭(필요시 수정)
  const [durationMonths, setDurationMonths] = useState("");
  const [wdpw, setWdpw] = useState(6);
  const [towerCranes, setTowerCranes] = useState(2);
  const [workCrews, setWorkCrews] = useState(3);
  const [civilEquip, setCivilEquip] = useState(5); // 토목 투입조(굴착기·CIP장비) — 토목 기간 산정
  const [util, setUtil] = useState(0.85); // 가동률(0<u≤1) — 공기 현실화(공수÷가동률). 공휴일은 서버가 항상 자동 제외
  const [formwork, setFormwork] = useState(""); // 거푸집 시스템(골조 기준층 사이클) — 비우면 LLM 기준(재래식급)
  const [rapidConcrete, setRapidConcrete] = useState(false); // 조강콘크리트 — 양생 단축
  const [seasonal, setSeasonal] = useState(false); // 계절 비작업일(동절기·우기) — 가동률과 별개 축
  const [civilQty, setCivilQty] = useState<{ depth_m?: number; footprint_m2?: number; perimeter_m?: number; pile_count?: number } | null>(null);
  const [constraints, setConstraints] = useState("");
  const [milestones, setMilestones] = useState<GenMilestone[]>([]); // 외부 마일스톤(인허가/자재반입/계약) — BIM에 없는 게이트
  const [diff, setDiff] = useState<IfcDiffResult | null>(null); // 설계변경 영향분석 결과
  const [diffBusy, setDiffBusy] = useState(false);
  const [strategy, setStrategy] = useState("bottom_up");
  const [workUnits, setWorkUnits] = useState<GenWorkUnit[]>([]);
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

  // ── 설계변경 영향분석 — 새 IFC 버전 업로드 → work_unit 추출(분석 재사용) → 옛 버전과 diff. ──
  const onDiffFile = async (file: File) => {
    if (!planId) return;
    setDiffBusy(true); setErr(null);
    try {
      const r = await analyzeSlotFile(file);
      const res = await ifcDiff(planId, r.work_units as unknown[]);
      setDiff(res);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "설계변경 분석 실패");
    } finally {
      setDiffBusy(false);
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
      for (const [disc, file] of entries) {
        setInferReason(`분석 중 — ${disc} (${file.name})…`);
        const r = await analyzeSlotFile(file);
        // 슬롯이 진실: 종합 슬롯만 분류기로 전 공종 분리(PSet Trade+IFC타입), 나머지(토목/구조/건축)는
        // 슬롯 공종으로 강제 → "토목은 토목만, 구조는 구조만, 건축은 건축만". 혼합 파일은 종합 슬롯 사용.
        const comprehensive = disc === "종합";
        allWu.push(...(comprehensive
          ? (r.work_units as GenWorkUnit[])
          : (r.work_units as GenWorkUnit[]).map((w) => ({ ...w, discipline: disc }))));
        r.zones.forEach((z) => zoneSet.add(z)); r.storeys.forEach((s) => storeySet.add(s));
        if (r.civil_quantities) cq = r.civil_quantities;
        setSlots((s) => ({ ...s, [disc]: { name: file.name, count: r.element_count, wp: r.work_units.length, warn: validateSlot(disc, r.discipline_summary) } }));
        if (disc === "구조" || !inferSrc) inferSrc = r; // 구조유형 추론은 구조 파일 우선
      }
      setWorkUnits(allWu); setZones([...zoneSet]); setStoreys([...storeySet]); setCivilQty(cq);
      // 공종·구조·건물유형 추천 → 빈 칸 채움(사람이 검토·수정 후 생성)
      if (inferSrc) {
        const ctx = await inferScheduleContext({
          storeys: [...storeySet], zones: [...zoneSet], element_summary: inferSrc.element_summary,
          trade_summary: inferSrc.trade_summary, discipline_summary: inferSrc.discipline_summary, total_count: inferSrc.element_count,
        });
        if (ctx.building_type && !buildingType.trim()) setBuildingType(ctx.building_type);
        if (ctx.scope && !scope.trim()) setScope(ctx.scope);
        if (ctx.structure_type && !structureType.trim()) setStructureType(ctx.structure_type);
        setInferReason(ctx.reason || null);
      } else { setInferReason(null); }
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBimBusy(false); }
  };

  // ── [버튼 2] 생성 — 분석된 work_unit + (검토한) 건물유형·공종·구조유형으로 공정표 생성. ──
  const onStart = async () => {
    if (!workUnits.length) { setErr("먼저 '분석 & 추천'을 실행하세요"); return; }
    if (!startDate) { setErr("착공일을 입력하세요"); return; }
    setBusy(true); setErr(null);
    try {
      const r = await startPlan({
        building_type: buildingType.trim() || "건물", scope: scope.trim() || undefined,
        structure_type: structureType.trim() || undefined, discipline: discipline.trim() || undefined,
        zones, storeys, work_units: workUnits, methods: [],
        start_date: startDate, duration_months: durationMonths ? Number(durationMonths) : undefined,
        work_days_per_week: wdpw, tower_cranes: towerCranes, work_crews: workCrews,
        civil_equipment: civilEquip, civil_quantities: civilQty ?? undefined,
        utilization_rate: util, formwork_system: formwork || undefined, rapid_concrete: rapidConcrete,
        seasonal_weather: seasonal,
        milestones: milestones.filter((m) => m.name.trim() && m.target_date),
        constraints: constraints.trim() || undefined, strategy,
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
    })) as GanttTask[];
  }, [plan]);

  const editAct = (i: number, patch: Partial<PlanActivity>) => {
    setActs((prev) => prev.map((a, j) => (j === i ? { ...a, ...patch } : a)));
    setDirty(true);
  };
  const removeAct = (i: number) => { setActs((prev) => prev.filter((_, j) => j !== i)); setDirty(true); };

  // ── 멀티파싱 파라미터 가시성 — 단일 discipline 이 아니라 '채워진 슬롯' 기준 ──
  // (토목+구조 동시 업로드 시 구조유형이 'discipline=토목'에 가려지던 버그 수정)
  const filledDiscs = Object.keys(slots);
  const multiDisc = filledDiscs.length >= 2;
  const noSlots = filledDiscs.length === 0;
  const hasStruct = !!slots["구조"] || (noSlots && (discipline === "" || discipline === "구조"));
  const hasCivil = !!slots["토목"];

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
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
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
                return (
                  <label key={d.key} title={`${d.label} IFC 업로드 — ${d.hint}`}
                    style={{ border: `1px solid ${filled ? "#16a34a" : "#3b82f6"}`, borderRadius: 8, padding: "10px 12px",
                             background: filled ? "#f0fdf4" : "#eff6ff", cursor: bimBusy ? "wait" : "pointer", display: "block" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: filled ? "#15803d" : "#1d4ed8" }}>
                      {filled ? "✓" : `${i + 1}.`} {d.icon} {d.label}
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {filled ? (filled.count ? `${filled.count.toLocaleString()}부재 → ${filled.wp} WP` : `${filled.name} · 생성 시 분석`) : `업로드 · ${d.hint}`}
                    </div>
                    {filled?.warn && (
                      <div style={{ fontSize: 10, marginTop: 3, lineHeight: 1.3, whiteSpace: "normal",
                                    color: filled.warn.startsWith("⚠️") ? "#b91c1c" : "#0369a1" }}>
                        {filled.warn}
                      </div>
                    )}
                    <input type="file" accept=".ifc" style={{ display: "none" }} disabled={bimBusy}
                           onChange={(e) => { const f = e.target.files?.[0]; if (f) void onBim(f, d.key); }} />
                  </label>
                );
              })}
            </div>
            {bimBusy && <p style={{ fontSize: 12, color: "#2563eb", margin: "8px 0 0" }}>BIM 분석 중…</p>}
            {Object.keys(slots).length > 1 && (
              <p style={{ fontSize: 12, color: "#15803d", margin: "8px 0 0" }}>
                🔗 복수 공종 병합 — {Object.keys(slots).join(" + ")}을(를) 시공순서로 연결해 1개 공정표로 생성합니다.
              </p>
            )}
            {inferReason && <p style={{ fontSize: 12, color: "#7c3aed", margin: "8px 0 0" }}>🤖 AI 판정: {inferReason}</p>}
          </div>

          <div className="wz-card" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Field label="① 무엇을 — 건물유형 (비우면 생성 시 AI 자동 추천)">
              <input className="wz-in" value={buildingType} onChange={(e) => setBuildingType(e.target.value)} placeholder="비워두면 AI 가 추천 (예: 모듈러 공동주택)" />
              <input className="wz-in" style={{ marginTop: 6 }} value={scope} onChange={(e) => setScope(e.target.value)} placeholder="범위 (예: 골조까지 / 마감 포함)" />
            </Field>
            <Field label={multiDisc ? "② 공종별 파라미터 — 복수 공종 병합" : "② 공종 / 구조유형 / 시공 전략 — 자동 판정 후 직접 수정 가능"}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {/* 복수 공종이면 슬롯이 공종을 정함 → 단일 드롭다운 숨김(혼동 방지). 단일/레거시면 드롭다운. */}
                {multiDisc ? (
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#15803d", padding: "6px 0" }}>
                    🔗 {filledDiscs.join(" + ")} — 공종별로 따로 생성 후 병합
                  </span>
                ) : (
                  <select className="wz-in" value={discipline} onChange={(e) => setDiscipline(e.target.value)}
                          title="BIM 공종 자동 판정 — 틀리면 직접 선택">
                    <option value="">공종: 자동 판정</option>
                    <option value="토목">토목</option>
                    <option value="구조">구조</option>
                    <option value="건축">건축</option>
                    <option value="MEP">MEP (기계·소방·전기·통신)</option>
                    <option value="조경">조경</option>
                  </select>
                )}
                {/* 구조유형 — 구조 슬롯이 있으면(또는 단일 구조/자동) 표시. 토목 last 라도 안 가려짐. */}
                {hasStruct && (
                  <label className="wz-sub" style={{ display: "flex", flexDirection: "column", fontSize: 11, color: "#475569" }}>
                    {multiDisc ? "구조유형" : ""}
                    <select className="wz-in" value={structureType} onChange={(e) => setStructureType(e.target.value)}>
                      <option value="">구조: 자동 판정</option>
                      <option value="RC">RC (철근콘크리트)</option>
                      <option value="철골">철골</option>
                      <option value="SRC">SRC</option>
                      <option value="PC·모듈러">PC·모듈러</option>
                      <option value="혼합">혼합 (RC코어 + 철골)</option>
                    </select>
                  </label>
                )}
                <label className="wz-sub" style={{ display: "flex", flexDirection: "column", fontSize: 11, color: "#475569" }}>
                  {multiDisc ? "시공 전략(굴착·골조)" : ""}
                  <select className="wz-in" value={strategy} onChange={(e) => setStrategy(e.target.value)}
                          title="굴착·골조 전략 — 발주·부지 조건(AI 추정 불가)">
                    <option value="bottom_up">순타·일괄 (전 구역 지하 → 지상)</option>
                    <option value="bottom_up_phased">순타·단계 (구역별 지하→지상 연속)</option>
                    <option value="top_down">역타 (지하·지상 병행)</option>
                  </select>
                </label>
              </div>
              {multiDisc && (
                <p style={{ fontSize: 11, color: "#64748b", margin: "6px 0 0" }}>
                  착공일·목표공기·주N일·현장조건은 공통, 구조유형은 구조에만·투입조는 각 공종에 적용됩니다.
                </p>
              )}
            </Field>
            <Field label="③ 언제 — 착공일 * / 목표공기">
              <div style={{ display: "flex", gap: 8 }}>
                <input type="date" className="wz-in" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                <input type="number" className="wz-in" style={{ width: 110 }} value={durationMonths}
                       onChange={(e) => setDurationMonths(e.target.value)} placeholder="개월" />
                <select className="wz-in" style={{ width: 100 }} value={wdpw} onChange={(e) => setWdpw(Number(e.target.value))}>
                  <option value={5}>주5일</option><option value={6}>주6일</option><option value={7}>주7일</option>
                </select>
                <label className="wz-sub" title="가동률 — 실작업 효율(장비고장·경미우천·재작업 손실). 공기=공수÷가동률. 공휴일(설·추석 등)은 자동 제외">가동률
                  <select className="wz-in" style={{ width: 92 }} value={util} onChange={(e) => setUtil(Number(e.target.value))}>
                    <option value={1.0}>100%</option><option value={0.9}>90%</option>
                    <option value={0.85}>85%</option><option value={0.8}>80%</option><option value={0.7}>70%</option>
                  </select></label>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#475569", margin: "6px 0 0" }}
                     title="동절기(12·1·2월 폭설·혹한)·우기(7·8월 장마) 기상 중단일을 달력에서 자동 제외. 가동률(장비·재작업 손실)과 별개 축이라 중복계산 없음">
                <input type="checkbox" checked={seasonal} onChange={(e) => setSeasonal(e.target.checked)} />
                계절 비작업일 자동 반영 (동절기·우기 기상 중단)
              </label>
              <p style={{ fontSize: 11, color: "#64748b", margin: "4px 0 0" }}>
                ⓘ 공휴일(설·추석·법정공휴일)은 자동 제외 · 가동률로 장비·재작업 손실, 계절옵션으로 동절기·우기 반영 → 현실 준공일
              </p>
            </Field>
            <Field label="④ 자원 — 공종별 투입">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {(hasStruct || noSlots) && (
                  <>
                    <label className="wz-sub" title="구조 양중(모듈/PC설치) 동시 한계">{multiDisc ? "구조 크레인(대)" : "크레인(대)"}
                      <input type="number" min={0} className="wz-in" value={towerCranes} onChange={(e) => setTowerCranes(Number(e.target.value))} /></label>
                    <label className="wz-sub" title="구조 동시 동일공종 작업조">{multiDisc ? "구조 작업조(조)" : "작업조(조)"}
                      <input type="number" min={1} className="wz-in" value={workCrews} onChange={(e) => setWorkCrews(Number(e.target.value))} /></label>
                    <label className="wz-sub" title="거푸집 시스템 — 골조 기준층 사이클 결정. 재래식 10~12일/층 ↔ 알폼·시스템폼 4~7일/층. 비우면 LLM 기준(재래식급)">거푸집 시스템
                      <select className="wz-in" style={{ width: 116 }} value={formwork} onChange={(e) => setFormwork(e.target.value)}>
                        <option value="">자동(기준)</option><option value="재래식">재래식</option><option value="유로폼">유로폼</option>
                        <option value="갱폼">갱폼</option><option value="알폼">알폼</option><option value="시스템폼">시스템폼</option>
                      </select></label>
                    <label className="wz-sub" title="조강(조강시멘트) 콘크리트 — 양생기간 약 57% 단축(×3/7). 동절기·급속 사이클에 사용" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <input type="checkbox" checked={rapidConcrete} onChange={(e) => setRapidConcrete(e.target.checked)} />조강콘크리트</label>
                  </>
                )}
                {hasCivil && (
                  <label className="wz-sub" title="굴착기·CIP장비 등 토목 투입 장비조 수 — 토목 기간 = 물량 ÷ (표준품셈 생산성 × 투입조)">토목 투입조(대)
                    <input type="number" min={1} className="wz-in" value={civilEquip} onChange={(e) => setCivilEquip(Number(e.target.value))} /></label>
                )}
              </div>
              {(hasStruct || noSlots) && formwork && (
                <p style={{ fontSize: 11, color: "#0369a1", margin: "6px 0 0" }}>
                  🏗️ 거푸집 <b>{formwork}</b>{rapidConcrete ? " + 조강콘크리트" : ""} → 골조 기준층 사이클 자동 반영
                  {formwork === "알폼" || formwork === "시스템폼" ? " (재래식 대비 사이클 약 절반)" : ""}
                </p>
              )}
              {slots["토목"] && civilQty && (
                <p style={{ fontSize: 11, color: "#0369a1", margin: "6px 0 0" }}>
                  🏗️ 토목 물량(BIM 도출): 굴착깊이 {civilQty.depth_m}m · footprint {(civilQty.footprint_m2 ?? 0).toLocaleString()}㎡
                  · 굴착체적 ≈ {Math.round((civilQty.footprint_m2 ?? 0) * (civilQty.depth_m ?? 0)).toLocaleString()}㎥
                  · 흙막이 {(civilQty.pile_count ?? 0).toLocaleString()}공/둘레 {civilQty.perimeter_m}m
                  <br />→ 투입조 {civilEquip}대 기준으로 토목 기간 자동 산정 (생성 후 활동별 수정 가능)
                </p>
              )}
            </Field>
            <Field label="⑤ 현장 조건·제약 — BIM에 없는 정보를 알려주세요 (AI가 공정에 반영)">
              <input className="wz-in" value={constraints} onChange={(e) => setConstraints(e.target.value)} placeholder="예: 야간작업 불가, 동절기 타설 제한, 암반 굴착, 도심 반입 제한" />
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 6 }}>
                {["야간작업 불가", "동절기 타설 제한", "암반 굴착(발파)", "연약지반", "도심 자재반입 제한", "인접 민원 주의", "우기 집중 지역"].map((c) => (
                  <button key={c} type="button" className="wz-chip"
                          onClick={() => setConstraints((p) => (p.includes(c) ? p : (p ? p + ", " : "") + c))}>
                    + {c}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="⑥ 외부 마일스톤 — BIM에 없는 인허가 게이트·장납기 자재·계약일 (선택)">
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
                  <p><b>선후행</b> — {plan.payload.rationale.relation}
                    {plan.payload.stats?.relation && (
                      <span className="wz-rat-stat"> (AI 판단 {plan.payload.stats.relation.llm ?? 0}활동 + 물리 백스톱 {plan.payload.stats.relation.backstop ?? 0}건)</span>
                    )}</p>
                )}
                {plan.payload.rationale.duration && (
                  <p><b>기간 산정</b> — {plan.payload.rationale.duration}
                    {plan.payload.stats?.duration && (
                      <span className="wz-rat-stat"> ({plan.payload.stats.duration.applied ?? 0}/{plan.payload.stats.duration.total ?? 0} 활동 산정)</span>
                    )}</p>
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
                  <th style={{ textAlign: "left", width: "22%" }}>선행 (code, 쉼표)</th><th />
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
                             onChange={(e) => editAct(i, { predecessors: e.target.value.split(/[\s,]+/).filter(Boolean).map((c) => ({ code: c, type: "FS", lag_days: 0 })) })} />
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
                <a className="wz-btn ghost" style={{ textDecoration: "none" }} href={planP6XmlUrl(planId)}>P6 XML 다운로드</a>
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
                🏗️ 토목이 길면 <b>투입조(굴착기·CIP 대수)</b>를 늘리세요 — 굴착 {Math.round((civilQty.footprint_m2 ?? 0) * (civilQty.depth_m ?? 0)).toLocaleString()}㎥ ÷ (표준품셈 생산성 × 투입조). 늘릴수록 토목 기간 단축.
              </span>
              <label style={{ display: "flex", alignItems: "center", gap: 4 }}>토목 투입조
                <input type="number" min={1} className="wz-in" style={{ width: 72 }} value={civilEquip} onChange={(e) => setCivilEquip(Number(e.target.value))} />
              </label>
              <button className="wz-btn" disabled={busy} onClick={() => {
                setBusy(true);
                void confirmPlan(planId!, { civil_equipment: civilEquip }).then(() => refresh(planId!)).finally(() => setBusy(false));
              }}>토목 기간 재계산</button>
            </div>
          )}
          {stage === "scheduled" && (
            <div style={{ border: "1px solid #e2e8f0", background: "#f8fafc", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#475569", marginBottom: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ flex: 1 }}>
                📅 공기가 비현실적이면 <b>가동률·거푸집 시스템</b>을 조정하세요 — 공기=공수÷가동률(우천·장비손실), 골조는 거푸집 사이클이 좌우. 공휴일 항상 자동 제외.
              </span>
              <label style={{ display: "flex", alignItems: "center", gap: 4 }}>가동률
                <select className="wz-in" style={{ width: 88 }} value={util} onChange={(e) => setUtil(Number(e.target.value))}>
                  <option value={1.0}>100%</option><option value={0.9}>90%</option>
                  <option value={0.85}>85%</option><option value={0.8}>80%</option><option value={0.7}>70%</option>
                </select>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 4 }}>거푸집
                <select className="wz-in" style={{ width: 104 }} value={formwork} onChange={(e) => setFormwork(e.target.value)}>
                  <option value="">자동</option><option value="재래식">재래식</option><option value="유로폼">유로폼</option>
                  <option value="갱폼">갱폼</option><option value="알폼">알폼</option><option value="시스템폼">시스템폼</option>
                </select>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <input type="checkbox" checked={rapidConcrete} onChange={(e) => setRapidConcrete(e.target.checked)} />조강
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 4 }} title="동절기·우기 기상 중단일 자동 반영">
                <input type="checkbox" checked={seasonal} onChange={(e) => setSeasonal(e.target.checked)} />계절
              </label>
              <button className="wz-btn" disabled={busy} onClick={() => {
                setBusy(true);
                void confirmPlan(planId!, { utilization_rate: util, formwork_system: formwork || undefined, rapid_concrete: rapidConcrete,
                                            seasonal_weather: seasonal, milestones: milestones.filter((m) => m.name.trim() && m.target_date) })
                  .then(() => refresh(planId!)).finally(() => setBusy(false));
              }}>공기 재계산</button>
            </div>
          )}
          {stage === "scheduled" && (
            <div style={{ border: "1px solid #fde68a", background: "#fffbeb", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#92400e", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ flex: 1 }}>
                  🔄 <b>설계변경 영향분석</b> — 수정된 IFC(새 버전)를 올리면 옛 버전과 비교해 추가·삭제·물량변경 부재와 <b>영향받는 Activity</b>를 찾아냅니다.
                </span>
                <label className="wz-btn" style={{ cursor: diffBusy ? "wait" : "pointer", opacity: diffBusy ? 0.6 : 1 }}>
                  {diffBusy ? "분석 중…" : "📂 새 IFC 비교"}
                  <input type="file" accept=".ifc" style={{ display: "none" }} disabled={diffBusy}
                         onChange={(e) => { const f = e.target.files?.[0]; if (f) void onDiffFile(f); e.target.value = ""; }} />
                </label>
              </div>
              {diff && (
                <div style={{ marginTop: 8, fontSize: 12 }}>
                  {!diff.summary.has_change ? (
                    <p style={{ color: "#15803d", margin: 0 }}>✅ 설계변경 없음 — 옛 버전과 동일(공정표 재산정 불필요).</p>
                  ) : (
                    <>
                      <p style={{ margin: "0 0 6px", fontWeight: 600 }}>
                        변경 {diff.summary.changed_buckets} · 추가 {diff.summary.added_buckets} · 삭제 {diff.summary.deleted_buckets} → 영향 Activity <b>{diff.summary.affected_activities}개</b> (재산정 권장)
                      </p>
                      {diff.changed.map((c, i) => (
                        <div key={`c${i}`} style={{ padding: "3px 0", borderTop: "1px solid #fde68a" }}>
                          <span style={{ color: (c.delta ?? 0) > 0 ? "#b91c1c" : "#1d4ed8", fontWeight: 600 }}>
                            ✏️ {c.discipline} {c.zone !== "-" ? `${c.zone} ` : ""}{c.storey !== "-" ? `${c.storey}F ` : ""}{c.element_type} {c.old_count}→{c.new_count} ({(c.pct ?? 0) > 0 ? "+" : ""}{c.pct}%)
                          </span>
                          {c.affected_activities.length > 0 && <span style={{ color: "#78716c" }}> → {c.affected_activities.map((a) => a.name).slice(0, 4).join(", ")}{c.affected_activities.length > 4 ? ` 외 ${c.affected_activities.length - 4}` : ""}</span>}
                        </div>
                      ))}
                      {diff.added.map((a, i) => (
                        <div key={`a${i}`} style={{ padding: "3px 0", borderTop: "1px solid #fde68a", color: "#047857" }}>
                          ➕ 신규: {a.discipline} {a.zone !== "-" ? `${a.zone} ` : ""}{a.storey !== "-" ? `${a.storey}F ` : ""}{a.element_type} {a.count}개 (신규 공정 검토)
                        </div>
                      ))}
                      {diff.deleted.map((d, i) => (
                        <div key={`d${i}`} style={{ padding: "3px 0", borderTop: "1px solid #fde68a", color: "#9f1239" }}>
                          ➖ 삭제: {d.discipline} {d.zone !== "-" ? `${d.zone} ` : ""}{d.storey !== "-" ? `${d.storey}F ` : ""}{d.element_type} {d.count}개
                          {d.affected_activities.length > 0 && <span style={{ color: "#78716c" }}> → {d.affected_activities.map((a) => a.name).slice(0, 4).join(", ")} 삭제 검토</span>}
                        </div>
                      ))}
                      <p style={{ margin: "6px 0 0", color: "#78716c" }}>ⓘ 물량변경은 기간 ∝ 물량 → 영향 Activity 기간 재산정 권장. 자동 변경 아님(PM 검토).</p>
                    </>
                  )}
                </div>
              )}
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
