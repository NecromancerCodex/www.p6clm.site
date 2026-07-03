"use client";

/**
 * 4D 시뮬레이션 PoC — 공정표(XER/PMXML) + BIM(IFC) 드래그앤드롭 → 매칭 → 타임라인 4D.
 *
 * 파이프라인:
 *  1. 공정표 → CLM /schedule/upload (기존 재사용) → tasks (activity_code = 4D 코드)
 *  2. IFC   → 브라우저 web-ifc 파싱 → 요소(GlobalId/층/타입/지오메트리)
 *  3. 매칭  → buildScheduleIndex + matchAll (pmisx auto_allocate 이식)
 *  4. 4D    → three.js 타임라인 색칠
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { FourDViewer } from "../../../components/fourd/FourDViewer";
import { loadBoreholes } from "../../../lib/api/earthwork";
import type { Borehole } from "../../../lib/earthwork/model";
import { DashboardSchedule } from "../../../components/fourd/DashboardSchedule";
import { ScheduleFormView } from "../../../components/documents/DocumentFormViews";
import { analyzeSchedule, uploadSchedule, planP6XmlUrl, type ScheduleReportDoc,
         uploadIfcToS3, savePlanIfcsServer, getPlanIfcsServer, deletePlanIfcServer, type PlanIfcMeta } from "../../../lib/api/schedule";
import { getUnitProgress, saveUnitProgress, type UnitStatus } from "../../../lib/api/fourdProgress";
import {
  buildCandidates,
  buildCodeIndex,
  buildScheduleIndex,
  canonStorey,
  classifyDisc,
  classifyIfcType,
  decodeActId,
  expandModularUnits,
  matchAll,
  matchAllHybrid,
  normStorey,
  type Candidate,
  type CodeIndex,
  type MatchResult,
  type MatchSummary,
  type ScheduleTask,
} from "../../../lib/fourd/match";
import { policyMatch, type UnmatchedGroup } from "../../../lib/fourd/policy";
import { saveFourdFiles, loadFourdFiles, clearFourdFiles, loadPlanIfcs, savePlanIfcs, saveParsedCache, loadParsedCache, type CachedFourd } from "../../../lib/fourd/fileCache";
import { DEFAULT_HIDDEN_TRADES } from "../../../lib/fourd/layers";
import { buildSchedOpStorey, classifyUnmatched, CAUSE_ORDER, classifyNoBim, NOBIM_ORDER, type Cause } from "../../../lib/fourd/diagnose";
import { deriveWorkPackages } from "../../../lib/fourd/workpackage";
import type { ParsedElement, ParsedIfc } from "../../../lib/fourd/ifc";

interface Ready {
  parsed: ParsedIfc;
  ranges: Map<string, MatchResult>;
  minDate: number;
  maxDate: number;
  summary: MatchSummary;
  taskCount: number; // 공정표 총 활동 수
  codeCount: number; // 그 중 4D 코드 디코드 성공 수
  mode: "code" | "storey"; // 매칭 방식 (REV 공정PSet vs 층근사)
  codeIndex: CodeIndex | null; // 정책매칭 적용 시 활동키→날짜 조회용
  candidates: Candidate[]; // 정책매칭 후보 활동
  policyCount: number; // 정책(AI)으로 추가 매칭된 부재 수
  policyResolved?: PolicyResolvedItem[]; // 정책(AI)이 연결한 그룹→활동 상세 (보고서 별도 섹션용)
  tasks: ScheduleTask[]; // 워크패키지 재도출용 (정책매칭 후 갱신)
  sessionId: string; // 분석 run id (Neon 저장 키)
  diag: {
    procCount: number; // 공정 PSet 보유 요소 수
    topVia: string; // byVia 상위 요약
  };
}

/** 정책(AI) 매칭이 연결한 미매칭 그룹 → 공정활동 1건. 보고서 'AI 해결' 섹션용. */
interface PolicyResolvedItem {
  group_label: string;   // 미매칭 BIM 그룹 라벨 (예: "ABC 기초(PT) 슬래브·보·모듈")
  activity_key: string;  // 연결된 활동 키
  activity_name: string; // 활동 한글명
  count: number;         // 연결된 부재 수
  reason: string;        // AI 근거 (시공순서/구역매핑 등)
  confidence: number;    // 0~1
}

const DAY_MS = 86400000;

/** 공사일보 작성 플랜 — 해당일 작업 목록 + 완료 체크 (생성 전 단계). */
interface DailyPlan {
  dateMs: number;
  iso: string;
  base: Record<string, UnitStatus>; // 기존 저장된 실적 상태 (code→status)
  items: { code: string; name: string; period: string; done: boolean }[];
  delayReason: string; // "" | weather | material | equipment | labor | inspection | other
}

interface ReportData {
  total: number;
  matched: number;
  unmatched: number;
  activityTotal: number;
  // 🤖 정책(AI) 매칭으로 해결된 연결 — 문제 목록과 분리해 별도 표시
  aiResolved: PolicyResolvedItem[];
  // 공정 활동 있는데 BIM 부재 없음 — 원인(A 재연결가능 / B 모델누락 / C 보류)별 그룹
  noBim: {
    cause: string;
    title: string;
    color: string;
    explain: string;
    recommend: string;
    total: number;
    items: string[];
  }[];
  // BIM 부재 있는데 공정 없음 — 원인(C1~C4)별 그룹 + 설명·추천
  noSchedule: {
    cause: string;
    title: string;
    color: string;
    explain: string;
    recommend: string;
    total: number;
    items: { label: string; count: number }[];
  }[];
  seqViolations: string[]; // 타임라인 순서 위반 (아래층>위층, 공종순서 등)
  clashes4d: string[]; // 4D Clash — 같은 공간(zone·층)에서 작업 기간 중첩
  // 구역별 층 커버리지 갭 — 타워 구역이 중간층을 건너뜀(전이층/보이드 또는 BIM 모델 누락). 결정론 경고.
  zoneGaps: { zone: string; present: number[]; gaps: number[]; floorMin: number; floorMax: number }[];
}

// 파일명 → 공종(disc) 추측 — 4D 직접 업로드용(플랜 모드는 슬롯 공종이 우선). STRU→구조·ARCH→건축 등.
// disc 가 있어야 건축/MEP/조경 마감(IfcSlab/Wall)이 공종 window 에 매칭됨.
const _DISC_KW: [RegExp, string][] = [
  [/토목|civil/i, "토목"], [/구조|stru/i, "구조"], [/건축|arch/i, "건축"],
  [/mep|기계|전기|소방|통신|배관|덕트/i, "MEP"], [/조경|landscape/i, "조경"], [/가설|scaffold|temp\b/i, "가설"],
];
function discFromName(name: string): string | undefined {
  for (const [re, d] of _DISC_KW) if (re.test(name)) return d;
  return undefined;
}

function Dropzone({
  label,
  accept,
  file,
  files,
  onFile,
  onFiles,
  multiple,
}: {
  label: string;
  accept: string;
  file?: File | null;
  files?: File[];          // 멀티 모드 — 누적된 파일 목록
  onFile?: (f: File) => void;
  onFiles?: (fs: File[]) => void;  // 멀티 모드 — 드롭/선택한 파일들(append 는 호출측)
  multiple?: boolean;
}) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const has = multiple ? !!files?.length : !!file;
  const take = (fl: FileList | null) => {
    if (!fl?.length) return;
    if (multiple) onFiles?.(Array.from(fl));
    else onFile?.(fl[0]);
  };
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}
      onClick={() => inputRef.current?.click()}
      style={{
        flex: 1,
        minHeight: 120,
        border: `2px dashed ${over ? "#60a5fa" : has ? "#10b981" : "#cbd5e1"}`,
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        cursor: "pointer",
        background: over ? "#eff6ff" : has ? "#f0fdf4" : "#f8fafc",
        padding: 16,
        textAlign: "center",
      }}
    >
      <strong>{label}</strong>
      <span style={{ fontSize: 13, color: "#64748b" }}>
        {multiple
          ? (files?.length ? `✓ ${files.map((f) => f.name).join(", ")} (${files.length}개)` : "토목·구조 등 여러 IFC 드래그앤드롭/선택")
          : (file ? `✓ ${file.name}` : "드래그앤드롭 또는 클릭")}
      </span>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        hidden
        multiple={multiple}
        onChange={(e) => take(e.target.files)}
      />
    </div>
  );
}

export default function FourDPage() {
  const [scheduleFile, setScheduleFile] = useState<File | null>(null);
  const [ifcFiles, setIfcFiles] = useState<File[]>([]); // 멀티 디시플린 IFC(토목+구조…) — 통합 4D
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ p: number; msg: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState<Ready | null>(null);
  // 이전 방문에서 IndexedDB에 기억된 파일 (있으면 '이어서 열기' 배너 노출)
  const [cached, setCached] = useState<CachedFourd | null>(null);
  // 4D 슬라이더 현재 날짜(epoch ms) — 하단 공정표 세로선 동기
  const [viewerDateMs, setViewerDateMs] = useState<number | undefined>(undefined);
  // 지반 이식용 시추공 (DB 저장된 토공 데이터) — 있으면 뷰어에 '지반' 토글 노출
  const [geoBoreholes, setGeoBoreholes] = useState<Borehole[]>([]);
  useEffect(() => {
    void loadBoreholes().then((b) => { if (b.length >= 2) setGeoBoreholes(b); });
  }, []);

  /** mount 시 캐시된 파일 확인 (1회) */
  useEffect(() => {
    void loadFourdFiles().then(setCached);
  }, []);
  const planLoadedRef = useRef(false);
  // 플랜 연결 IFC(S3) — 삭제 UI 용 메타(object_key 포함)
  const [serverIfcs, setServerIfcs] = useState<PlanIfcMeta[]>([]);
  const ifcPersistedRef = useRef(false);   // 서버 복원/저장 완료 시 true → 재업로드 방지

  // C-2: 무거운 숨김 레이어(가설 등) 기하는 기본 미로드(브라우저 메모리 절약). 사용자가 '로드'하면 추가.
  const loadExtraRef = useRef<Set<string>>(new Set());
  // 파일명 → 공종(disc). 위저드 플랜 모드에서 슬롯 공종을 전달(파일명 추측 X) → 부재 disc 태그 → 토목 매칭.
  const ifcDiscRef = useRef<Record<string, string>>({});

  const run = useCallback(async (sFile?: File, iFilesArg?: File[]) => {
    // 명시 인자(복원 시) 우선, 없으면 state. setState 는 비동기라 복원 직후 호출에 인자 전달.
    const sf = sFile ?? scheduleFile;
    const infs = iFilesArg ?? ifcFiles;
    if (!sf || !infs.length) return;
    setBusy(true);
    setError(null);
    setReady(null);
    setPromoted(false);
    try {
      // 1) 공정표 → tasks
      //    .xer 는 브라우저에서 직접 파싱(백엔드가 4D 코드/target 날짜를 안 돌려줌).
      //    .xml(PMXML) 은 기존 백엔드 업로드 경로 유지.
      setProgress({ p: 0.05, msg: "공정표 파싱 중…" });
      let tasks: ScheduleTask[];
      if (/\.xer$/i.test(sf.name)) {
        const { parseXerTasks } = await import("../../../lib/fourd/xer");
        // XER 는 CP949(EUC-KR) — UTF-8 로 읽으면 한글 활동명이 깨진다(정책매칭 LLM 신호 손상).
        // 코드·날짜는 ASCII 라 EUC-KR 디코드해도 안전.
        const bytes = await sf.arrayBuffer();
        let text: string;
        try {
          text = new TextDecoder("euc-kr").decode(bytes);
        } catch {
          text = new TextDecoder().decode(bytes);
        }
        tasks = parseXerTasks(text);
      } else {
        const snap = await uploadSchedule(sf);
        const rawTasks = (snap.tasks ?? []) as unknown as Array<Record<string, unknown>>;
        tasks = rawTasks.map((t) => ({
          code: String(t.activity_code ?? t.code ?? t.id ?? ""),
          name: t.name as string | undefined,
          start: (t.start ?? t.baseline_start_date ?? null) as string | null,
          end: (t.end ?? t.baseline_finish_date ?? null) as string | null,
          progress: t.progress as number | undefined,
        }));
      }
      const codeCount = tasks.filter((t) => decodeActId(t.code)).length;
      // 토목 공정표는 4D 코드가 없음(부재 단위 X) — 활동명(굴착·흙막이)으로 earthworkWindow 매칭.
      // 따라서 codeIndex 를 먼저 만들어 토목 가능성 확인 후, 4D코드도 토목활동도 없을 때만 에러.
      const codeIndex0 = buildCodeIndex(tasks);
      if (codeCount === 0 && !codeIndex0.earthworkWindow) {
        throw new Error(
          `공정표 ${tasks.length}건에서 4D 코드(502HG…)도 토목 활동(굴착·흙막이)도 못 찾았습니다. ` +
            `구조는 4D 코드가 있는 XER, 토목은 활동명에 굴착/흙막이가 있어야 4D 매칭됩니다.`,
        );
      }

      // 2) IFC 파싱 (브라우저 web-ifc, 동적 import — SSR 회피)
      // C-2: 무거운 숨김 레이어(가설 TW·MEP)는 기하 미로드 → 브라우저 메모리 절약(토목 ~80%↓).
      //      사용자가 '로드'한 레이어(loadExtraRef)는 스킵 대상에서 제외.
      const skipTrades = new Set([...DEFAULT_HIDDEN_TRADES].filter((t) => !loadExtraRef.current.has(t)));
      const { mergeParsed, serializeParsed } = await import("../../../lib/fourd/ifc");
      const { parseIfcInWorker } = await import("../../../lib/fourd/ifcWorkerClient");
      // 멀티 디시플린 통합 — 각 IFC(토목·구조…) 파싱 후 한 씬으로 병합(좌표계 동일 가정).
      const parsedList: ParsedIfc[] = [];
      for (let fi = 0; fi < infs.length; fi++) {
        const buf = await infs[fi].arrayBuffer();
        const tag = infs.length > 1 ? `[${fi + 1}/${infs.length}] ${infs[fi].name} — ` : "";
        const p = await parseIfcInWorker(buf, (pr, msg) => setProgress({ p: pr, msg: tag + msg }), skipTrades);  // Worker 파싱 — 메인스레드 응답성(응답없음 대화상자 근본 해소)
        // 공종 태그 — 파일 슬롯(플랜) 또는 파일명 추측이 '기본', 단 섞인 파일 분리: 건축 IFC의 조경 포장→조경,
        //   구조 IFC의 흙막이 pile→토목 등 확실한 타 공종은 classifyDisc 가 override(이름·타입). 애매한 건 슬롯.
        const fileDisc = ifcDiscRef.current[infs[fi].name] ?? discFromName(infs[fi].name);
        for (const el of p.elements) { const d = classifyDisc(el, fileDisc); if (d) el.disc = d; }
        parsedList.push(p);
      }
      const parsed = mergeParsed(parsedList);

      // 3) 매칭 — 공정 PSet(REV) 있으면 코드매칭(zone 정확), 없으면 층근사 폴백
      setProgress({ p: 1, msg: "매칭 중…" });
      const procCount = parsed.elements.filter((e) => e.trade).length;
      const useCode = procCount > 0; // 공정 PSet 있으면 hybrid(zone정확 + 층폴백)
      let ranges: Map<string, MatchResult>;
      let summary: MatchSummary;
      let minDate: number;
      let maxDate: number;
      const sidx = buildScheduleIndex(tasks);
      // 공정PSet 있으면 hybrid(zone정확). 없어도 공정표에 4D 코드(codeCount>0, 생성 공정표 등)가
      // 있으면 codeIndex 를 만들어 둔다 — AI 매칭·보고서·워크패키지 버튼/기능 활성화용.
      // codeIndex0(위에서 이름 기반 생성) 재사용 — 토목 earthworkWindow + 버튼/AI 활성화용(4D코드 0건이어도).
      let codeIndex: CodeIndex | null = codeIndex0;
      // PC·모듈러 호 단위 4D 순차 전개 (Stage 2) — 셀 윈도우 안에서 모듈을 호별로 분배.
      // 타워는 el.unit(호 PSet) 없어 무동작. 매칭 전에 codeIndex.byUnit 을 채운다.
      if (codeIndex) expandModularUnits(parsed.elements, codeIndex);
      if (useCode && codeIndex) {
        // 규칙은 "확정 매칭"만 — 실제 활동에 연결되는 것(유닛/단계/구역/층).
        // 활동이 없는 하드케이스(ZA/ZC 유닛불일치·PT구조·주차장)는 미매칭으로 두고
        // 온톨로지 grounding AI(정책 버튼)가 판단한다. (규칙이 추정으로 때우지 않음)
        ({ ranges, summary } = matchAllHybrid(parsed.elements, codeIndex, sidx));
        minDate = Math.min(codeIndex.minDate, sidx.minDate);
        maxDate = Math.max(codeIndex.maxDate, sidx.maxDate);
      } else {
        // 층 근사 매칭 (PSet 없음). codeIndex 는 공종 window(건축/MEP/조경 disc 단축경로)에 사용.
        ({ ranges, summary } = matchAll(parsed.elements, sidx, codeIndex));
        minDate = codeIndex ? Math.min(codeIndex.minDate, sidx.minDate) : sidx.minDate;
        maxDate = codeIndex ? Math.max(codeIndex.maxDate, sidx.maxDate) : sidx.maxDate;
      }
      // 토목 단계 굴착 — 토목 부재(disc/CV/TW)를 earthworkWindow 안에서 층(canonStorey)별로 순차 배치.
      // (earthworkWindow 한 칸에 다 넣으면 "한번에 완성" — 층별로 나눠 굴착 순서 복원). 굴착 top-down:
      // 얕은 지하(B1) 먼저 → 깊은 지하(B5) 나중. 부재 없는 기간은 비고, 형상은 층 순서대로 등장.
      if (codeIndex?.earthworkWindow) {
        const ew = codeIndex.earthworkWindow;
        const bnum = (s: string) => { const m = /B\s*0*(\d+)/i.exec(s); return m ? parseInt(m[1], 10) : 0; };
        const civilEls = parsed.elements.filter((e) => e.disc === "토목" || e.trade === "CV" || e.trade === "TW");
        // ① 지하 B레벨 기반 — 잘 태깅된 흙막이(B1→B5 top-down). 2개 이상 B레벨이 있을 때만.
        const bLevels = [...new Set(civilEls.map((e) => canonStorey(e.storey4d ?? e.storeyName ?? "") || "")
          .filter((s) => bnum(s) > 0))].sort((a, b) => bnum(a) - bnum(b));
        if (bLevels.length > 1 && ew.end > ew.start) {
          const span = (ew.end - ew.start) / bLevels.length;
          const ord = new Map(bLevels.map((s, i) => [s, i]));
          for (const e of civilEls) {
            const i = ord.get(canonStorey(e.storey4d ?? e.storeyName ?? "") || "");
            if (i != null) ranges.set(e.globalId, { range: { start: ew.start + i * span, end: ew.start + (i + 1) * span }, via: `earthwork:B${bnum(bLevels[i])}` });
          }
        } else if (ew.end > ew.start) {
          // ② Z(표고) 깊이 밴드 폴백 — 층 미태깅 토목(흙막이 말뚝 등). 부재 배치 Y(cy)로 top-down 굴착
          //    순서 복원(PSet·층 배정 불요). 토목은 본질이 깊이 단위라 표고 staging 이 자연스러움.
          const ys = civilEls.map((e) => e.cy).filter((v) => Number.isFinite(v)) as number[];
          if (ys.length) {
            const top = Math.max(...ys), bot = Math.min(...ys);
            const N = top > bot ? 6 : 1;                  // 굴착 ~6단(lift). 평평하면 1단.
            const band = top > bot ? (top - bot) / N : 1;
            const span = (ew.end - ew.start) / N;
            for (const e of civilEls) {
              const y = Number.isFinite(e.cy) ? (e.cy as number) : top;
              const i = top > bot ? Math.min(N - 1, Math.max(0, Math.floor((top - y) / band))) : 0;  // 얕은 곳(top) 먼저
              ranges.set(e.globalId, { range: { start: ew.start + i * span, end: ew.start + (i + 1) * span }, via: `earthwork:D${i + 1}` });
            }
          }
        }
      }
      // ── 건축 부재 Z(표고) 층 판정 — finishWindow(전체 창) 일괄완성 방지, 층별 LoB 활동 연동. ──
      //    층 태깅된 부재(구조 등)의 층별 cy 중심을 학습 → 층 없는 건축 부재를 최근접 층에 배정 →
      //    그 층 마감 window("B6 조적~바닥", archByStorey)로 교체. 토목 깊이 밴드와 동일 원리(기하=근거).
      if (codeIndex && codeIndex.archByStorey.size >= 2) {
        const stCy = new Map<string, number[]>();
        for (const e of parsed.elements) {
          const cs = canonStorey(e.storey4d ?? e.storeyName ?? "");
          if (cs && Number.isFinite(e.cy)) {
            if (!stCy.has(cs)) stCy.set(cs, []);
            stCy.get(cs)!.push(e.cy as number);
          }
        }
        const centers: { cs: string; y: number }[] = [];
        for (const [cs, ys2] of stCy) {
          if (ys2.length < 3 || !codeIndex.archByStorey.has(cs)) continue;   // 그 층 마감활동 있는 층만
          ys2.sort((a, b) => a - b);
          centers.push({ cs, y: ys2[Math.floor(ys2.length / 2)] });          // 중앙값(이상치 방어)
        }
        if (centers.length >= 2) {
          let placed = 0;
          for (const e of parsed.elements) {
            const r = ranges.get(e.globalId);
            if (!r?.via?.startsWith("finish") || !Number.isFinite(e.cy)) continue;   // 개략 매칭된 건축만
            let best: { cs: string; y: number } | null = null;
            for (const c of centers)
              if (!best || Math.abs(c.y - (e.cy as number)) < Math.abs(best.y - (e.cy as number))) best = c;
            const w = best ? codeIndex.archByStorey.get(best.cs) : null;
            if (best && w) {
              ranges.set(e.globalId, { range: w, via: `finish_storey:${best.cs}` });
              placed++;
            }
          }
          if (placed) summary.byVia["건축(층Z)"] = placed;
        }
      }
      // 4D 타임라인 = 전체 공정표 범위(모든 task). 코드/키워드 인덱스에 안 잡히는 활동(지반개량 등)도
      // 포함 → 슬라이더가 진짜 착공일(첫 활동)부터 시작. (안 그러면 흙막이부터 시작해 6~7월 공백)
      {
        const tt = tasks.flatMap((t) => [t.start, t.end]).filter(Boolean)
          .map((d) => Date.parse(String(d))).filter(Number.isFinite);
        if (tt.length) { minDate = Math.min(minDate, ...tt); maxDate = Math.max(maxDate, ...tt); }
      }

      const topVia = Object.entries(summary.byVia)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([k, v]) => `${k}:${v}`)
        .join("  ");

      const readyObj: Ready = {
        parsed,
        ranges,
        minDate,
        maxDate,
        summary,
        taskCount: tasks.length,
        codeCount,
        mode: useCode ? "code" : "storey",
        codeIndex,
        candidates: codeIndex ? buildCandidates(tasks) : [],
        policyCount: 0,
        tasks,
        sessionId:
          typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `run-${tasks.length}`,
        diag: { procCount, topVia },
      };
      setReady(readyObj);
      // 분석 성공 → 원본 파일을 IndexedDB에 기억(다음 방문 시 재업로드 불필요).
      void saveFourdFiles(sf, infs);
      const pid = new URLSearchParams(window.location.search).get("plan");
      // 파싱 결과 캐싱 — 다음 방문 시 341MB 재파싱 스킵(즉시 4D). parsed(three)만 직렬화, 나머지(ranges Map 등) 그대로.
      if (pid) {
        const { parsed: _omit, ...rest } = readyObj;
        void _omit;
        void saveParsedCache(pid, serializeParsed(parsed), rest as unknown as Record<string, unknown>);
      }
      // plan 이 있고 아직 영속화 안 됐으면 IFC 원본을 S3 에 저장(plan 연결) → 다른 기기/재방문 재업로드 제거.
      if (pid && !ifcPersistedRef.current) {
        ifcPersistedRef.current = true;
        void (async () => {
          try {
            const metas: PlanIfcMeta[] = [];
            for (const f of infs) {
              const key = await uploadIfcToS3(f);
              metas.push({ object_key: key, filename: f.name,
                           size_mb: Math.round((f.size / 1024 / 1024) * 10) / 10,
                           discipline: ifcDiscRef.current[f.name] || "" });
            }
            await savePlanIfcsServer(pid, metas);
            setServerIfcs(metas);
          } catch { /* 영속화 실패는 무시 — IndexedDB 캐시는 있음 */ }
        })();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [scheduleFile, ifcFiles]);

  /** 스킵된 레이어(가설 등) 로드 요청 — 해당 trade 를 추가하고 재파싱(기하 포함). */
  const onLoadLayer = useCallback((trade: string) => {
    loadExtraRef.current = new Set([...loadExtraRef.current, trade]);
    void run();
  }, [run]);

  /** 위저드 → 4D 핸드오프: ?plan=X 면 그 플랜의 P6 공정표 + 슬롯 IFC(공종 태그)를 자동 로드·분석. */
  useEffect(() => {
    if (planLoadedRef.current) return;
    const planId = new URLSearchParams(window.location.search).get("plan");
    if (!planId) return;
    planLoadedRef.current = true;
    void (async () => {
      setBusy(true); setError(null); setProgress({ p: 0.02, msg: "플랜 IFC·공정표 로드 중…" });
      try {
        // 캐시된 분석 결과 있으면 파싱 전부 스킵 → 즉시 4D(341MB 재파싱 X)
        const cache = await loadParsedCache(planId);
        if (cache) {
          setProgress({ p: 0.5, msg: "캐시에서 즉시 복원 중…" });
          const { deserializeParsed } = await import("../../../lib/fourd/ifc");
          setReady({ ...(cache.ready as unknown as Ready), parsed: deserializeParsed(cache.parsed) });
          const serverList = await getPlanIfcsServer(planId);   // 삭제 UI 메타 + S3 저장 여부
          setServerIfcs(serverList);
          ifcPersistedRef.current = serverList.length > 0;
          setBusy(false); setProgress(null);
          return;
        }
        let planIfcs = await loadPlanIfcs(planId);
        const serverList = await getPlanIfcsServer(planId);
        setServerIfcs(serverList);
        // ★ ifcPersistedRef 는 S3 저장 여부 기준(IndexedDB 아님). 마법사 경유 plan 은 IndexedDB 만
        //   있고 S3 엔 없으므로 false → 분석 후 run 이 S3 업로드(다른 기기 복원 가능).
        ifcPersistedRef.current = serverList.length > 0;
        if (!planIfcs.length) {
          // IndexedDB 없음(다른 기기) → 서버 S3 에서 원본 복원(재업로드 불필요)
          setProgress({ p: 0.05, msg: "서버에서 IFC 복원 중…" });
          const dl: { file: File; discipline: string }[] = [];
          for (const m of serverList) {
            if (!m.download_url) continue;
            const r = await fetch(m.download_url);
            if (!r.ok) continue;
            const blob = await r.blob();
            dl.push({ file: new File([blob], m.filename || m.object_key, { type: "application/octet-stream" }), discipline: m.discipline || "" });
          }
          if (dl.length) {
            planIfcs = dl;
            ifcPersistedRef.current = true;     // 서버에서 받은 것 → 재업로드 금지
            void savePlanIfcs(planId, dl);      // IndexedDB 재캐시(다음엔 빠르게)
          }
        }
        if (!planIfcs.length) {
          setError("이 플랜에 연결된 IFC 가 없습니다 — 아래에서 직접 드롭해 분석하면 이후 자동 저장됩니다.");
          setBusy(false); setProgress(null); return;
        }
        const res = await fetch(planP6XmlUrl(planId), { credentials: "include" });
        if (!res.ok) throw new Error(`공정표 로드 실패 (${res.status})`);
        const xml = await res.text();
        const schedFile = new File([xml], `plan-${planId}.xml`, { type: "application/xml" });
        ifcDiscRef.current = Object.fromEntries(planIfcs.map((x) => [x.file.name, x.discipline])); // 파일명→공종
        const files = planIfcs.map((x) => x.file);
        setScheduleFile(schedFile); setIfcFiles(files);
        void run(schedFile, files); // 공종 태그(ifcDiscRef) 적용 → 토목 부재는 토공 window 매칭
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e)); setBusy(false); setProgress(null);
      }
    })();
  }, [run]);

  /** 캐시된 파일로 이어서 분석 — state 세팅 + 명시 인자로 즉시 run. */
  const restoreCached = useCallback(() => {
    if (!cached) return;
    const ifcs = cached.ifcs?.length ? cached.ifcs : [cached.ifc]; // 구버전 캐시(ifc 단일) 호환
    setScheduleFile(cached.schedule);
    setIfcFiles(ifcs);
    setCached(null);
    void run(cached.schedule, ifcs);
  }, [cached, run]);

  /** 기억된 파일 삭제 + 배너 숨김. */
  const clearCached = useCallback(() => {
    void clearFourdFiles();
    setCached(null);
  }, []);

  // ── 정책기반 AI 매칭 — 규칙 미매칭 그룹을 gpt-5-mini 로 후보활동에 연결 ──
  const [policyBusy, setPolicyBusy] = useState(false);
  const [policyProg, setPolicyProg] = useState("");
  const [promoted, setPromoted] = useState(false);   // 정책(AI) 제안을 공정표에 편입(확정)했는가
  const runPolicy = useCallback(async () => {
    if (!ready || !ready.codeIndex) return;
    setPolicyBusy(true);
    setError(null);
    try {
      const KO_CAT: Record<string, string> = { CORE: "벽·기둥", FOOT: "기초", MOD: "슬래브·보·모듈" };
      const koStorey = (s: string | null) =>
        !s ? "층미상" : s === "PT" ? "기초(PT)" : s === "RF" ? "지붕(RF)" : Number.isFinite(Number(s)) ? `${Number(s)}층` : s;

      // 1) 미매칭 요소 그룹핑 (zone|storey|category|reason)
      const groups = new Map<
        string,
        { els: ParsedElement[]; types: Set<string>; names: Set<string>; storey: string | null; zone: string | null; cat: string; reason: string }
      >();
      for (const el of ready.parsed.elements) {
        if (ready.ranges.get(el.globalId)?.range) continue; // 이미 매칭됨
        const storey = el.storey4d ?? normStorey(el.storeyName);
        const cat = classifyIfcType(el.ifcType, el.name);
        const zone = el.zone ?? null;
        const reason = (ready.ranges.get(el.globalId)?.via ?? "").split(/[:@]/)[0];
        const gkey = `${reason}|${zone ?? "-"}|${storey ?? "-"}|${cat}`;
        let g = groups.get(gkey);
        if (!g) {
          g = { els: [], types: new Set(), names: new Set(), storey, zone, cat, reason };
          groups.set(gkey, g);
        }
        g.els.push(el);
        g.types.add(el.ifcType);
        // 대표 부재명(Revit) 수집 — AI가 별도/부속 구조를 추론하는 신호 (storeyName도 합침)
        if (g.names.size < 4) {
          const nm = el.name || el.storeyName;
          if (nm) g.names.add(nm);
        }
      }
      if (groups.size === 0) {
        setPolicyBusy(false);
        return;
      }

      const unmatched: UnmatchedGroup[] = [...groups.entries()].map(([key, g]) => ({
        key,
        label: `${g.zone ? g.zone + " " : ""}${koStorey(g.storey)} ${KO_CAT[g.cat] ?? g.cat}`,
        count: g.els.length,
        ifc_types: [...g.types],
        names: [...g.names],
        storey: g.storey,
        zone: g.zone,
        reason: g.reason,
      }));

      // 2) LLM 정책매칭 — 그룹을 배치(루프)로 쪼개 호출 (응답 잘림 방지)
      const BATCH = 12;
      const assignments: Awaited<ReturnType<typeof policyMatch>> = [];
      const total = Math.ceil(unmatched.length / BATCH);
      for (let i = 0; i < unmatched.length; i += BATCH) {
        setPolicyProg(`${Math.floor(i / BATCH) + 1}/${total} 배치`);
        const slice = unmatched.slice(i, i + BATCH);
        const part = await policyMatch(slice, ready.candidates);
        assignments.push(...part);
      }
      setPolicyProg("");

      // 3) 적용 — activity_key 있고 confidence≥0.6 인 것만 (없으면 회색 유지)
      const newRanges = new Map(ready.ranges);
      const resolved: PolicyResolvedItem[] = [];
      let applied = 0;
      for (const a of assignments) {
        if (!a.activity_key || a.confidence < 0.6) continue;
        const range = ready.codeIndex.byKey.get(a.activity_key);
        const g = groups.get(a.group_key);
        if (!range || !g) continue;
        for (const el of g.els) {
          newRanges.set(el.globalId, { range, via: `policy|${a.activity_key}` });
          applied++;
        }
        resolved.push({
          group_label: `${g.zone ? g.zone + " " : ""}${koStorey(g.storey)} ${KO_CAT[g.cat] ?? g.cat}`,
          activity_key: a.activity_key,
          activity_name: ready.candidates.find((c) => c.key === a.activity_key)?.name ?? a.activity_key,
          count: g.els.length,
          reason: a.reason,
          confidence: a.confidence,
        });
      }

      const byVia = { ...ready.summary.byVia, "정책(AI)": applied };
      setReady({
        ...ready,
        ranges: newRanges,
        summary: { ...ready.summary, matched: ready.summary.matched + applied, byVia },
        policyCount: applied,
        policyResolved: resolved,
      });
      setPromoted(false);   // 새 제안 — 사람 컨펌(편입) 대기 상태
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPolicyBusy(false);
      setPolicyProg("");
    }
  }, [ready]);

  // ── 시뮬레이션 보고서 — 공정표↔BIM 양방향 정합성 진단 ──
  const [report, setReport] = useState<ReportData | null>(null);

  // ── 워크패키지 — BIM 메타(호·타입·부재종류)로 세분, Neon 영속화 ──
  const [wpSaving, setWpSaving] = useState<"idle" | "saving" | "done" | "error">("idle");
  // 원클릭 저장 — 4D 분석 결과(패키지 1:N 유닛)를 Neon 영속(진도율 보드·PMIS-X 연동 소스).
  // 물량 확인=/schedule/resource, 활동 목록=공정표, 연결 진단=진단 보고서로 일원화 → 모달 제거.
  const saveWorkPackages = async () => {
    if (!ready) return;
    setWpSaving("saving");
    try {
      const packages = deriveWorkPackages(ready.tasks, ready.parsed.elements, ready.ranges);
      const res = await fetch("/api/clm/fourd/work-packages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: ready.sessionId, packages }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        console.error("[워크패키지 저장]", res.status, txt.slice(0, 300));
        alert(`저장 실패 (HTTP ${res.status})${res.status === 413 ? " — 페이로드가 서버 한도 초과(nginx client_max_body_size 증설 필요)" : ""}`);
      }
      setWpSaving(res.ok ? "done" : "error");
    } catch (e) {
      console.error("[워크패키지 저장]", e);
      setWpSaving("error");
    }
  };

  // ── 공사일보 — 타임라인 슬라이더 '해당일' 기준, 기존 schedule/analyze 재사용 ──
  const [dailyBusy, setDailyBusy] = useState(false);
  const [dailyDoc, setDailyDoc] = useState<ScheduleReportDoc | null>(null);
  const [dailyErr, setDailyErr] = useState<string | null>(null);
  // 공사일보 작성 플랜 — 해당일 작업 목록 + 완료 체크 (생성 전 단계)
  const [dailyPlan, setDailyPlan] = useState<DailyPlan | null>(null);

  const isoOf = (dateMs: number) => {
    const d = new Date(dateMs);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  // "이 날짜 공사일보" 클릭 → 즉시 생성 X → 해당일 작업 목록 + 완료 체크 모달 오픈
  const openDaily = useCallback(
    async (dateMs: number) => {
      if (!ready || !scheduleFile) return;
      setDailyBusy(true);
      setDailyErr(null);
      try {
        // 해당일 진행 작업 = 계획 구간이 그날을 포함하는 활동
        const items = ready.tasks
          .filter((t) => {
            if (!t.start || !t.end) return false;
            const s = new Date(String(t.start).slice(0, 10)).getTime();
            const e = new Date(String(t.end).slice(0, 10)).getTime();
            return s <= dateMs && dateMs <= e + DAY_MS;
          })
          .map((t) => ({ code: t.code, name: t.name ?? t.code, period: `${String(t.start).slice(0, 10)} ~ ${String(t.end).slice(0, 10)}` }));
        // 기존 실적 상태 로드 (재방문/이전 입력 반영)
        let base: Record<string, UnitStatus> = {};
        try {
          const units = await getUnitProgress();
          base = Object.fromEntries(units.filter((u) => u.activity_code).map((u) => [u.activity_code as string, u.status]));
        } catch {
          /* 보드 비어있으면 무시 */
        }
        setDailyPlan({
          dateMs,
          iso: isoOf(dateMs),
          base,
          items: items.map((it) => ({ ...it, done: base[it.code] === "done" })),
          delayReason: "",
        });
      } catch (e) {
        setDailyErr(e instanceof Error ? e.message : "작업 목록 로드 실패");
      } finally {
        setDailyBusy(false);
      }
    },
    [ready, scheduleFile],
  );

  const toggleDailyItem = useCallback((code: string) => {
    setDailyPlan((p) => (p ? { ...p, items: p.items.map((it) => (it.code === code ? { ...it, done: !it.done } : it)) } : p));
  }, []);
  const setDailyDelayReason = useCallback((reason: string) => {
    setDailyPlan((p) => (p ? { ...p, delayReason: reason } : p));
  }, []);

  // 모달의 완료 선택 → 실적 저장 + 실적 기반 공사일보 생성
  const generateDaily = useCallback(async () => {
    if (!scheduleFile || !dailyPlan) return;
    setDailyBusy(true);
    setDailyErr(null);
    try {
      // 그날 항목: 완료=done, 그 외(진행 중)=active. 보드에 저장(activity_code 키).
      const changes = dailyPlan.items.map((it) => ({ activity_code: it.code, status: (it.done ? "done" : "active") as UnitStatus }));
      try {
        await saveUnitProgress(changes);
      } catch {
        /* 저장 실패해도 보고서는 생성 (아래 map 으로) */
      }
      // 전체 상태맵 = 기존 + 오늘 변경 → 보고서가 누적 실적 반영
      const fullMap: Record<string, string> = { ...dailyPlan.base };
      for (const c of changes) fullMap[c.activity_code] = c.status;
      const res = await analyzeSchedule(scheduleFile, "proc_daily", undefined, dailyPlan.iso, fullMap, dailyPlan.delayReason || undefined);
      if (!res.document) throw new Error("보고서 본문이 비어 있습니다.");
      setDailyPlan(null);
      setDailyDoc(res.document);
    } catch (e) {
      setDailyErr(e instanceof Error ? e.message : "공사일보 생성 실패");
    } finally {
      setDailyBusy(false);
    }
  }, [scheduleFile, dailyPlan]);
  const buildReport = useCallback(() => {
    if (!ready) return;
    const { ranges, parsed, candidates } = ready;
    // 정책(AI) 매칭을 이미 돌린 뒤면 C3/A 권장문구를 '미해결'로 전환(이미 시도→또 권하는 모순 방지)
    const aiAttempted = ready.policyCount > 0 || (ready.policyResolved?.length ?? 0) > 0;
    const KO_CAT: Record<string, string> = { CORE: "벽·기둥", FOOT: "기초", MOD: "슬래브·보·모듈" };
    const koStorey = (s: string | null) =>
      !s ? "층미상" : s === "PT" ? "기초(PT)" : s === "RF" ? "지붕(RF)" : Number.isFinite(Number(s)) ? `${Number(s)}층` : s;

    // via → 대표 활동키 (유닛/단계/정책 → coarse 후보키)
    const viaToActivity = (via: string | undefined): string | null => {
      if (!via) return null;
      if (via.startsWith("policy|")) return via.slice(7);
      const p = via.split("|");
      if (p[0] === "MO" && p.length >= 3) return `MO|${p[1]}|${p[2]}|MD`;
      if (p[0] === "ST" && p.length >= 4) return `ST|${p[1]}|${p[2]}|${p[3]}`;
      return null; // 층 폴백(MO@04) 등 — 특정 활동 아님
    };

    // ① BIM 있는데 공정 없음 (미매칭 부재) → 원인 규칙분류(C1~C4)로 그룹핑 + 설명·추천
    const schedOpStorey = buildSchedOpStorey(candidates.map((c) => c.key));
    const noSched = new Map<string, { label: string; count: number; sample: string; via?: string; zone?: string }>();
    let unmatched = 0;
    for (const el of parsed.elements) {
      if (ranges.get(el.globalId)?.range) continue;
      unmatched++;
      const s = el.storey4d ?? normStorey(el.storeyName);
      const cat = classifyIfcType(el.ifcType, el.name);
      const k = `${el.zone ?? "-"}|${s ?? "-"}|${cat}`;
      const g = noSched.get(k);
      if (g) g.count++;
      else
        noSched.set(k, {
          label: `${el.zone ? el.zone + " " : ""}${koStorey(s)} ${KO_CAT[cat] ?? cat}`,
          count: 1,
          sample: el.storeyName ?? "",
          via: ranges.get(el.globalId)?.via,
          zone: el.zone,
        });
    }
    // 원인별 묶기 (대표 via/zone 으로 규칙 분류)
    const causeMap = new Map<Cause, { title: string; color: string; explain: string; recommend: string; total: number; items: { label: string; count: number }[] }>();
    for (const g of noSched.values()) {
      const meta = classifyUnmatched(g.via, g.zone, schedOpStorey, aiAttempted);
      let cg = causeMap.get(meta.cause);
      if (!cg) {
        cg = { title: meta.title, color: meta.color, explain: meta.explain, recommend: meta.recommend, total: 0, items: [] };
        causeMap.set(meta.cause, cg);
      }
      cg.total += g.count;
      cg.items.push({ label: `${g.label}${g.sample ? ` (예: ${g.sample})` : ""}`, count: g.count });
    }
    const noSchedule = CAUSE_ORDER.filter((c) => causeMap.has(c)).map((c) => {
      const cg = causeMap.get(c)!;
      return { cause: c, ...cg, items: cg.items.sort((a, b) => b.count - a.count) };
    });

    // ② 공정 활동 있는데 BIM 없음 (매칭된 부재가 0인 후보 활동) → 원인 A/B/C 분류
    const covered = new Set<string>();
    for (const el of parsed.elements) {
      const k = viaToActivity(ranges.get(el.globalId)?.via);
      if (k) covered.add(k);
    }
    // BIM 부재의 (공종|층) 존재 인덱스 — A(구역만 불일치) vs B(아예 없음) 판별용
    const OP_OF_CAT: Record<string, string> = { CORE: "CR", MOD: "MD", FOOT: "FT" };
    const bimPresence = new Set<string>();
    const bimZonesAt = new Map<string, Set<string>>();
    for (const el of parsed.elements) {
      const op = OP_OF_CAT[classifyIfcType(el.ifcType, el.name)];
      const st = el.storey4d ?? normStorey(el.storeyName);
      if (!op || !st) continue;
      const bk = `${op}|${st}`;
      bimPresence.add(bk);
      if (el.zone) {
        let s = bimZonesAt.get(bk);
        if (!s) {
          s = new Set();
          bimZonesAt.set(bk, s);
        }
        s.add(el.zone);
      }
    }
    const noBimMap = new Map<string, { title: string; color: string; explain: string; recommend: string; total: number; items: string[] }>();
    for (const c of candidates) {
      if (covered.has(c.key)) continue;
      const meta = classifyNoBim(c.key, bimPresence, bimZonesAt, aiAttempted);
      let cg = noBimMap.get(meta.cause);
      if (!cg) {
        cg = { title: meta.title, color: meta.color, explain: meta.explain, recommend: meta.recommend, total: 0, items: [] };
        noBimMap.set(meta.cause, cg);
      }
      cg.total++;
      cg.items.push(`${c.name} [${c.key}]`);
    }
    const noBim = NOBIM_ORDER.filter((c) => noBimMap.has(c)).map((c) => ({ cause: c, ...noBimMap.get(c)! }));

    // ③ 타임라인 순서 검토 + ④ 4D Clash — codeIndex 날짜로 검증
    // 층 랭크 — 백엔드 _storey_rank 와 동일: 지하=음수(깊을수록 작게), PT 최하, RF/PH/PHR 최상.
    // (이전: parseInt("B4")=NaN→0 으로 지하·옥탑이 전부 0 → 가짜 '순서 역전' 15건 오보)
    const FR = (s: string) => {
      const u = (s || "").toUpperCase();
      if (u === "PT" || u.includes("PIT")) return -100;
      if (u.includes("PHR")) return 10001;
      if (u.startsWith("PH")) return 10000;
      if (u === "RF" || u.includes("지붕")) return 9999;
      const b = /B\s*0*(\d+)/.exec(u);
      if (b) return -parseInt(b[1], 10);
      const m = /\d+/.exec(u);
      return m ? parseInt(m[0], 10) : 500;
    };
    const OPN: Record<string, string> = { FT: "기초", CR: "골조", MD: "모듈", PR: "파라펫" };
    const seqViolations: string[] = [];
    const clashes4d: string[] = [];
    const idx = ready.codeIndex;
    if (idx) {
      // 키 파싱: ST|zone|storey|wt, MO|zone|storey|MD → {zone,floor,op,start,end}
      const acts: { zone: string; floor: string; op: string; start: number; end: number }[] = [];
      for (const [k, r] of idx.byKey) {
        const p = k.split("|");
        acts.push({ zone: p[1], floor: p[2], op: p[0] === "MO" ? "MD" : p[3], start: r.start, end: r.end });
      }
      // 순서: (zone,op)별 층 오름차순 시작일 단조 검증
      const byZoneOp = new Map<string, typeof acts>();
      for (const a of acts) (byZoneOp.get(`${a.zone}|${a.op}`) ?? byZoneOp.set(`${a.zone}|${a.op}`, []).get(`${a.zone}|${a.op}`)!).push(a);
      for (const [zo, list] of byZoneOp) {
        const [zone, op] = zo.split("|");
        list.sort((a, b) => FR(a.floor) - FR(b.floor));
        for (let i = 1; i < list.length; i++) {
          if (list[i].start < list[i - 1].start - 86400000) {
            seqViolations.push(`${zone} ${OPN[op] ?? op}: ${list[i].floor}층이 ${list[i - 1].floor}층보다 먼저 시작 (순서 역전)`);
          }
        }
      }
      // 4D Clash: (zone,floor)에서 서로 다른 공종 작업기간 중첩
      const byZF = new Map<string, typeof acts>();
      for (const a of acts) (byZF.get(`${a.zone}|${a.floor}`) ?? byZF.set(`${a.zone}|${a.floor}`, []).get(`${a.zone}|${a.floor}`)!).push(a);
      for (const [zf, list] of byZF) {
        const [zone, floor] = zf.split("|");
        for (let i = 0; i < list.length; i++)
          for (let j = i + 1; j < list.length; j++) {
            const a = list[i], b = list[j];
            if (a.op !== b.op && a.start < b.end && b.start < a.end) {
              clashes4d.push(`${zone} ${floor}층: ${OPN[a.op] ?? a.op} ↔ ${OPN[b.op] ?? b.op} 작업기간 중첩`);
            }
          }
      }
    }

    // ⑤ 구역별 층 커버리지 갭 — 타워 구역이 중간 지상층을 건너뛰는지(전이층/보이드 vs 모델 누락). 결정론.
    //   세부구역(A-1) → 메인구역(A) 집계 후 지상층만 보고 연속성 검사. 지하·옥탑(B/PT/RF/PH)은 제외.
    const _mz = (z: string) => (z || "").replace(/[-_ .]?\d+$/, "") || z;
    const _floorNum = (s: string): number | null => {
      const u = (s || "").toUpperCase();
      if (!u || u.startsWith("B") || u.includes("PIT") || u === "PT") return null; // 지하 제외
      if (u === "RF" || u.startsWith("PH") || u.includes("지붕")) return null; // 옥탑 제외
      const m = /(\d+)/.exec(u);
      return m ? parseInt(m[1], 10) : null;
    };
    const zoneFloorSet = new Map<string, Set<number>>();
    for (const el of parsed.elements) {
      if (!el.zone) continue;
      const f = _floorNum(el.storey4d ?? normStorey(el.storeyName) ?? "");
      if (f == null) continue;
      const mz = _mz(el.zone);
      let s = zoneFloorSet.get(mz);
      if (!s) zoneFloorSet.set(mz, (s = new Set()));
      s.add(f);
    }
    const zoneGaps: ReportData["zoneGaps"] = [];
    for (const [zone, fset] of zoneFloorSet) {
      const fs = [...fset].sort((a, b) => a - b);
      if (fs.length < 3) continue; // 포디움(1~2F만)은 타워 아님 — 갭 판정 제외
      const gaps: number[] = [];
      for (let f = fs[0]; f <= fs[fs.length - 1]; f++) if (!fset.has(f)) gaps.push(f);
      if (gaps.length) zoneGaps.push({ zone, present: fs, gaps, floorMin: fs[0], floorMax: fs[fs.length - 1] });
    }
    zoneGaps.sort((a, b) => b.gaps.length - a.gaps.length);

    setReport({
      total: parsed.elements.length,
      matched: parsed.elements.length - unmatched,
      unmatched,
      activityTotal: candidates.length,
      aiResolved: ready.policyResolved ?? [],
      noBim,
      noSchedule,
      seqViolations: seqViolations.slice(0, 30),
      clashes4d: [...new Set(clashes4d)].slice(0, 30),
      zoneGaps,
    });
  }, [ready]);

  return (
    <div style={{ padding: 20, height: "100%", overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 20 }}>대시보드</h1>
        <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 13 }}>
          공정표(P6)와 BIM(IFC)을 올리면 공정 진행 상황을 시각화하고, 해당일 공사일보를 생성합니다.
        </p>
      </div>

      {!ready && (
        <>
          {cached && !busy && (
            <div
              style={{
                display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                padding: "12px 16px", borderRadius: 10, border: "1px solid #bfdbfe", background: "#eff6ff",
              }}
            >
              <span style={{ fontSize: 20 }}>🗂️</span>
              <div style={{ flex: 1, minWidth: 200, fontSize: 13, color: "#1e3a8a" }}>
                <strong>최근 파일이 기억되어 있습니다</strong>
                <div style={{ color: "#475569", marginTop: 2 }}>
                  {cached.schedule.name} · {(cached.ifcs?.length ? cached.ifcs : [cached.ifc]).map((f) => f.name).join(", ")}
                </div>
                <div style={{ color: "#94a3b8", fontSize: 11, marginTop: 1 }}>
                  {new Date(cached.savedAt).toLocaleString("ko-KR")} 저장 · 이 브라우저에만
                </div>
              </div>
              <button
                onClick={restoreCached}
                style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#2563eb", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
              >
                이어서 열기
              </button>
              <button
                onClick={clearCached}
                style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff", color: "#64748b", fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}
              >
                지우기
              </button>
            </div>
          )}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <Dropzone label="① 공정표 (.xer / .xml)" accept=".xer,.xml" file={scheduleFile} onFile={setScheduleFile} />
            <Dropzone label="② BIM (.ifc) — 토목·구조 등 여러 개" accept=".ifc" files={ifcFiles} multiple
                      onFiles={(fs) => setIfcFiles((prev) => {
                        const names = new Set(prev.map((f) => f.name));
                        return [...prev, ...fs.filter((f) => !names.has(f.name))]; // 중복 파일명 제외하고 누적
                      })} />
          </div>
          {serverIfcs.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 12, alignItems: "center" }}>
              <span style={{ color: "#0369a1", fontWeight: 600 }}>☁ 플랜 저장 IFC:</span>
              {serverIfcs.map((m) => (
                <span key={m.object_key} style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6, padding: "2px 8px", color: "#1d4ed8" }}>
                  {m.filename}{m.discipline ? ` · ${m.discipline}` : ""}
                  <button
                    onClick={async () => {
                      const pid = new URLSearchParams(window.location.search).get("plan");
                      if (!pid) return;
                      if (!confirm(`${m.filename} 연결을 삭제할까요? (S3 원본도 함께 삭제)`)) return;
                      try {
                        await deletePlanIfcServer(pid, m.object_key);
                        setServerIfcs((p) => p.filter((x) => x.object_key !== m.object_key));
                      } catch (e) { alert("삭제 실패: " + (e instanceof Error ? e.message : String(e))); }
                    }}
                    style={{ marginLeft: 6, border: "none", background: "none", color: "#dc2626", cursor: "pointer", fontWeight: 700 }}>×</button>
                </span>
              ))}
            </div>
          )}
          {ifcFiles.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 12 }}>
              {ifcFiles.map((f) => (
                <span key={f.name} style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, padding: "2px 8px", color: "#15803d" }}>
                  {f.name} ({Math.round(f.size / 1024 / 1024)}MB)
                  <button onClick={() => setIfcFiles((prev) => prev.filter((x) => x.name !== f.name))}
                          style={{ marginLeft: 6, border: "none", background: "none", color: "#dc2626", cursor: "pointer", fontWeight: 700 }}>×</button>
                </span>
              ))}
            </div>
          )}
          <button
            onClick={() => run()}
            disabled={!scheduleFile || !ifcFiles.length || busy}
            style={{
              padding: "12px 20px",
              borderRadius: 8,
              border: "none",
              background: !scheduleFile || !ifcFiles.length || busy ? "#cbd5e1" : "#2563eb",
              color: "#fff",
              fontSize: 15,
              fontWeight: 600,
              cursor: !scheduleFile || !ifcFiles.length || busy ? "default" : "pointer",
            }}
          >
            {busy ? "분석 중…" : "분석 & 4D 생성"}
          </button>
          {ifcFiles.reduce((s, f) => s + f.size, 0) > 40 * 1024 * 1024 && (
            <p style={{ color: "#d97706", fontSize: 13, margin: 0 }}>
              ⚠ IFC 합계 {Math.round(ifcFiles.reduce((s, f) => s + f.size, 0) / 1024 / 1024)}MB — 브라우저 파싱·공정속성 분석에 시간·메모리 소요. (REV 파일이 zone 정확 매칭됩니다)
            </p>
          )}
          {progress && (
            <div>
              <div style={{ height: 8, background: "#e2e8f0", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ width: `${Math.round(progress.p * 100)}%`, height: "100%", background: "#2563eb", transition: "width .3s" }} />
              </div>
              <p style={{ fontSize: 13, color: "#64748b", margin: "6px 0 0" }}>{progress.msg}</p>
            </div>
          )}
          {error && <p style={{ color: "#dc2626", fontSize: 13 }}>오류: {error}</p>}
        </>
      )}

      {ready && (
        <>
          <div style={{ fontSize: 13, color: "#475569" }}>
            {ready.mode === "code" ? "구역 정확 매칭(공정PSet)" : "층 근사 매칭"} ·{" "}
            공정 {ready.taskCount.toLocaleString()}건 ·{" "}
            요소 {ready.summary.total.toLocaleString()}개 중{" "}
            <strong style={{ color: "#10b981" }}>{ready.summary.matched.toLocaleString()}개 매칭</strong>{" "}
            ({Math.round((ready.summary.matched / Math.max(ready.summary.total, 1)) * 100)}%)
            <button
              onClick={() => {
                setReady(null);
                setScheduleFile(null);
                setIfcFiles([]);
              }}
              style={{ marginLeft: 12, fontSize: 12, padding: "4px 10px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}
            >
              새로 분석
            </button>
          </div>
          {serverIfcs.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 12, alignItems: "center" }}>
              <span style={{ color: "#0369a1", fontWeight: 600 }}>☁ 플랜 저장 IFC:</span>
              {serverIfcs.map((m) => (
                <span key={m.object_key} style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6, padding: "2px 8px", color: "#1d4ed8" }}>
                  {m.filename}{m.discipline ? ` · ${m.discipline}` : ""}
                  <button
                    onClick={async () => {
                      const pid = new URLSearchParams(window.location.search).get("plan");
                      if (!pid) return;
                      if (!confirm(`${m.filename} 연결을 삭제할까요? (S3 원본 + 캐시도 함께 삭제)`)) return;
                      try {
                        await deletePlanIfcServer(pid, m.object_key);
                        setServerIfcs((p) => p.filter((x) => x.object_key !== m.object_key));
                      } catch (e) { alert("삭제 실패: " + (e instanceof Error ? e.message : String(e))); }
                    }}
                    style={{ marginLeft: 6, border: "none", background: "none", color: "#dc2626", cursor: "pointer", fontWeight: 700 }}>×</button>
                </span>
              ))}
            </div>
          )}
          {ready.codeIndex && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
              <button
                onClick={runPolicy}
                disabled={policyBusy}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: "none",
                  background: policyBusy ? "#cbd5e1" : "#7c3aed",
                  color: "#fff",
                  fontWeight: 600,
                  cursor: policyBusy ? "default" : "pointer",
                }}
              >
                {policyBusy ? `AI 분석 중… ${policyProg}` : "🤖 정책기반 AI 매칭 (미매칭 채우기)"}
              </button>
              {ready.policyCount > 0 && (
                <span style={{ color: promoted ? "#16a34a" : "#7c3aed" }}>
                  +{ready.policyCount.toLocaleString()}개 {promoted ? "공정표 편입(확정)" : "정책 매칭(추정) — 검토 후 편입"}
                </span>
              )}
              {ready.policyCount > 0 && !promoted && (
                <button
                  onClick={() => {
                    // 사람 컨펌 — 정책(AI) 추정을 공정표에 편입(확정): via 의 'policy|' 접두 제거 → 초록 승격.
                    // 부재가 해당 워크유닛 셀에 흡수(기존 날짜 공유) — 새 활동/날짜 없음 → CP·흩어짐 무영향.
                    const newRanges = new Map(ready.ranges);
                    let n = 0;
                    for (const [gid, mr] of newRanges) {
                      if (mr.via?.startsWith("policy|")) {
                        newRanges.set(gid, { range: mr.range, via: mr.via.slice(7) });
                        n++;
                      }
                    }
                    setReady({ ...ready, ranges: newRanges });
                    setPromoted(true);
                  }}
                  style={{
                    padding: "8px 14px", borderRadius: 8, border: "1px solid #16a34a",
                    background: "#16a34a", color: "#fff", fontWeight: 600, cursor: "pointer",
                  }}
                  title="AI가 추정한 워크유닛 배정을 검토 후 공정표에 정식 편입 — 보라(추정) → 초록(확정)"
                >
                  ✅ 공정표에 편입 (확정 {ready.policyCount.toLocaleString()}개)
                </button>
              )}
              <button
                onClick={buildReport}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: "1px solid #0ea5e9",
                  background: "#0ea5e9",
                  color: "#fff",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                📋 시뮬레이션 보고서
              </button>
              <button
                onClick={saveWorkPackages}
                disabled={wpSaving === "saving"}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: "1px solid #7c3aed",
                  background: wpSaving === "done" ? "#059669" : "#7c3aed",
                  color: "#fff",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {wpSaving === "saving" ? "💾 저장 중…" : wpSaving === "done" ? "✓ 진도율·PMIS-X 저장됨" : wpSaving === "error" ? "⚠ 저장 실패 — 재시도" : "💾 진도율·PMIS-X 저장"}
              </button>
            </div>
          )}
          <details style={{ fontSize: 12, color: "#64748b" }}>
            <summary style={{ cursor: "pointer" }}>진단</summary>
            <div style={{ marginTop: 6, lineHeight: 1.7, fontFamily: "monospace" }}>
              <div>공정 PSet 보유 요소: {ready.diag.procCount.toLocaleString()} / {ready.summary.total.toLocaleString()}</div>
              <div>byVia: {ready.diag.topVia}</div>
            </div>
          </details>
          {/* 4D 뷰어 — 고정 높이(자식). 페이지를 내리면 위로 스크롤되며 공정표(부모)가 커짐 */}
          <div style={{ height: 600, flexShrink: 0 }}>
            <FourDViewer
              parsed={ready.parsed}
              ranges={ready.ranges}
              minDate={ready.minDate}
              maxDate={ready.maxDate}
              codeToName={new Map(ready.tasks.map((t) => [t.code, t.name ?? t.code]))}
              onGenerateDaily={scheduleFile ? openDaily : undefined}
              dailyBusy={dailyBusy}
              onDateChange={setViewerDateMs}
              geoBoreholes={geoBoreholes}
              skippedTrades={ready.parsed.skippedTrades ?? []}
              onLoadLayer={onLoadLayer}
              activities={
                ready.codeIndex
                  ? [...ready.codeIndex.byKey.entries()].map(([k, r]) => ({
                      name: ready.candidates.find((c) => c.key === k)?.name || k,
                      start: r.start,
                      end: r.end,
                    }))
                  : []
              }
            />
          </div>
          {/* 하단 공정표 — 이전 공정표 조회와 동일한 frappe-gantt 스타일 + 슬라이더 날짜 세로선 */}
          <DashboardSchedule tasks={ready.tasks} markerDate={viewerDateMs} />
        </>
      )}

      {dailyErr && (
        <div
          style={{ position: "fixed", bottom: 16, right: 16, zIndex: 3000, background: "#fee2e2", color: "#991b1b", padding: "10px 14px", borderRadius: 8, fontSize: 13, boxShadow: "0 4px 12px rgba(0,0,0,.15)" }}
          onClick={() => setDailyErr(null)}
        >
          ⚠ 공사일보 생성 실패: {dailyErr} (클릭하여 닫기)
        </div>
      )}
      {dailyPlan && (
        <DailyPlanModal
          plan={dailyPlan}
          busy={dailyBusy}
          onToggle={toggleDailyItem}
          onDelayReason={setDailyDelayReason}
          onGenerate={generateDaily}
          onClose={() => setDailyPlan(null)}
        />
      )}
      {dailyDoc && <DailyReportModal doc={dailyDoc} onClose={() => setDailyDoc(null)} />}
      {report && <ReportModal report={report} onClose={() => setReport(null)} />}

    </div>
  );
}

/** 공사일보 작성 전 — 해당일 작업 목록에서 완료한 업무를 체크박스로 선택. */
const DELAY_OPTIONS: { v: string; label: string }[] = [
  { v: "", label: "지연 없음" },
  { v: "weather", label: "기상(우천 등)" },
  { v: "material", label: "자재 반입 지연" },
  { v: "equipment", label: "장비" },
  { v: "labor", label: "인력 부족" },
  { v: "inspection", label: "검측 지연" },
  { v: "other", label: "기타" },
];

function DailyPlanModal({
  plan,
  busy,
  onToggle,
  onDelayReason,
  onGenerate,
  onClose,
}: {
  plan: DailyPlan;
  busy: boolean;
  onToggle: (code: string) => void;
  onDelayReason: (reason: string) => void;
  onGenerate: () => void;
  onClose: () => void;
}) {
  const doneCount = plan.items.filter((i) => i.done).length;
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: 12, padding: 20, maxWidth: 640, width: "100%", maxHeight: "85vh", overflow: "auto", boxShadow: "0 10px 40px rgba(0,0,0,0.3)" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>📄 공사일보 작성 — {plan.iso}</h2>
          <button onClick={onClose} style={{ border: "none", background: "#f1f5f9", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>닫기</button>
        </div>
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "#64748b" }}>
          해당일 작업 목록입니다. <strong>완료한 업무에 체크</strong>하세요. 체크 안 한 항목은 진행중으로 기록됩니다.
          (선택은 공정 진도율에도 반영)
        </p>

        {plan.items.length === 0 ? (
          <div style={{ padding: 16, background: "#f8fafc", borderRadius: 8, color: "#475569", fontSize: 14 }}>
            이 날짜에 계획상 진행되는 공정이 없습니다.
          </div>
        ) : (
          <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
            {plan.items.map((it) => (
              <label
                key={it.code}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderTop: "1px solid #f1f5f9", cursor: "pointer", background: it.done ? "#f0fdf4" : "#fff" }}
              >
                <input type="checkbox" checked={it.done} onChange={() => onToggle(it.code)} style={{ width: 17, height: 17, accentColor: "#10b981" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: "#1e293b" }}>{it.name}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>{it.code} · {it.period}</div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: it.done ? "#10b981" : "#0891b2" }}>
                  {it.done ? "완료" : "진행중"}
                </span>
              </label>
            ))}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
          <span style={{ fontSize: 13, color: "#475569" }}>지연사유</span>
          <select
            value={plan.delayReason}
            onChange={(e) => onDelayReason(e.target.value)}
            style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13 }}
          >
            {DELAY_OPTIONS.map((o) => (
              <option key={o.v} value={o.v}>{o.label}</option>
            ))}
          </select>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>(주간·월간 보고서 지연원인 집계에 사용)</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
          <span style={{ fontSize: 13, color: "#475569" }}>완료 {doneCount} / 전체 {plan.items.length}</span>
          <button
            onClick={onGenerate}
            disabled={busy}
            style={{ padding: "10px 18px", borderRadius: 8, border: "none", background: busy ? "#94a3b8" : "#2563eb", color: "#fff", fontSize: 14, fontWeight: 600, cursor: busy ? "default" : "pointer" }}
          >
            {busy ? "생성 중…" : "공사일보 생성"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 타임라인 '해당일' 공사일보 — 기존 ScheduleFormView 그대로 렌더 (수치표 결정적 + AI 서술). */
function DailyReportModal({ doc, onClose }: { doc: ScheduleReportDoc; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 3000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 24, overflow: "auto" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: 12, padding: 20, maxWidth: 880, width: "100%", boxShadow: "0 10px 40px rgba(0,0,0,0.3)" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>
            📄 공사일보 — {doc.reference_date}
          </h2>
          <button onClick={onClose} style={{ border: "none", background: "#f1f5f9", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>
            닫기
          </button>
        </div>
        <ScheduleFormView doc={doc} showPipeline={false} />
      </div>
    </div>
  );
}

function ReportModal({ report, onClose }: { report: ReportData; onClose: () => void }) {
  const rate = Math.round((report.matched / Math.max(report.total, 1)) * 100);
  const Section = ({ title, color, items, empty }: { title: string; color: string; items: string[]; empty: string }) => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontWeight: 700, color, marginBottom: 4 }}>
        {title} ({items.length})
      </div>
      {items.length === 0 ? (
        <div style={{ color: "#10b981", fontSize: 13 }}>✓ {empty}</div>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6, maxHeight: 160, overflow: "auto" }}>
          {items.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      )}
    </div>
  );
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: 12, padding: 24, maxWidth: 720, width: "100%", maxHeight: "85vh", overflow: "auto", boxShadow: "0 10px 40px rgba(0,0,0,0.3)" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>📋 4D 시뮬레이션 진단 보고서</h2>
          <button onClick={onClose} style={{ border: "none", background: "#f1f5f9", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>
            닫기
          </button>
        </div>
        <div style={{ fontSize: 13, color: "#475569", marginBottom: 10, padding: "8px 12px", background: "#f8fafc", borderRadius: 8 }}>
          요소 {report.total.toLocaleString()}개 중 <strong style={{ color: "#10b981" }}>{report.matched.toLocaleString()}개 매칭 ({rate}%)</strong> · 공정활동 {report.activityTotal}종 · 미매칭 {report.unmatched.toLocaleString()}개
          {report.aiResolved.length > 0 && (
            <> · <strong style={{ color: "#7c3aed" }}>AI 해결 {report.aiResolved.reduce((s, r) => s + r.count, 0).toLocaleString()}개</strong></>
          )}
        </div>

        {/* 종합 판정 — 한눈 건강도 칩 (매칭·층연속·순서·Clash) */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          {[
            { ok: report.unmatched === 0, g: `매칭 ${rate}%`, b: `미매칭 ${report.unmatched.toLocaleString()}` },
            { ok: report.zoneGaps.length === 0, g: "구역 층 연속", b: `층갭 ${report.zoneGaps.length}구역` },
            { ok: report.noBim.reduce((s, x) => s + x.total, 0) === 0, g: "공정↔BIM 일치", b: `BIM없음 ${report.noBim.reduce((s, x) => s + x.total, 0)}` },
            { ok: report.seqViolations.length === 0, g: "순서 정상", b: `순서위반 ${report.seqViolations.length}` },
            { ok: report.clashes4d.length === 0, g: "Clash 없음", b: `Clash ${report.clashes4d.length}` },
          ].map((c, i) => (
            <span key={i} style={{ fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 999, background: c.ok ? "#ecfdf5" : "#fff7ed", color: c.ok ? "#059669" : "#c2410c", border: `1px solid ${c.ok ? "#a7f3d0" : "#fed7aa"}` }}>
              {c.ok ? "✅ " : "⚠️ "}{c.ok ? c.g : c.b}
            </span>
          ))}
        </div>

        {/* 구역별 층 커버리지 갭 — BIM 특성 경고 (전이층/보이드 vs 모델 누락) */}
        {report.zoneGaps.length > 0 && (
          <div style={{ marginBottom: 16, padding: "10px 12px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8 }}>
            <div style={{ fontWeight: 700, color: "#b45309", marginBottom: 6 }}>
              ⚠️ 구역별 층 커버리지 — 중간층 누락 감지 ({report.zoneGaps.length}구역)
            </div>
            <div style={{ fontSize: 12, color: "#92400e", marginBottom: 8 }}>
              타워 구역이 중간 지상층을 건너뜁니다. <strong>BIM 모델의 의도된 형상</strong>(타워-포디움 전이층·보이드 등)이거나 <strong>모델 누락</strong>(부재 미작성)입니다.
              스케줄은 BIM 그대로 반영하므로 <strong>버그가 아닙니다</strong> — 의도된 형상인지 BIM에서 확인하세요.
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
              {report.zoneGaps.map((g, i) => (
                <li key={i}>
                  <strong>{g.zone}구역</strong>: {g.floorMin}~{g.floorMax}F 중 <strong style={{ color: "#b45309" }}>{g.gaps.join("·")}F 없음</strong>{" "}
                  <span style={{ color: "#a16207" }}>(전이층/보이드 또는 모델 누락 — 확인 요망)</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {report.aiResolved.length > 0 && (
          <div style={{ marginBottom: 16, padding: "10px 12px", background: "#faf5ff", border: "1px solid #e9d5ff", borderRadius: 8 }}>
            <div style={{ fontWeight: 700, color: "#7c3aed", marginBottom: 6 }}>
              🤖 AI 매칭으로 해결됨 ({report.aiResolved.reduce((s, r) => s + r.count, 0).toLocaleString()}개 · {report.aiResolved.length}건)
            </div>
            <div style={{ fontSize: 12, color: "#6b21a8", marginBottom: 8 }}>
              아래는 규칙으로 못 잡았지만 정책(AI) 매칭이 공정활동에 연결한 부재입니다. (아래 ①②는 이를 제외한 <strong>미해결</strong>만 표시)
            </div>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, lineHeight: 1.7, color: "#475569", maxHeight: 160, overflow: "auto" }}>
              {report.aiResolved.map((r, i) => (
                <li key={i}>
                  <strong>{r.group_label}</strong> → {r.activity_name}{" "}
                  <span style={{ color: "#7c3aed" }}>({r.count.toLocaleString()}개, 확신 {Math.round(r.confidence * 100)}%)</span>
                  {r.reason ? <div style={{ color: "#94a3b8" }}>· {r.reason}</div> : null}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, color: "#dc2626", marginBottom: 6 }}>
            ① BIM 있는데 공정 없음 — <span style={{ color: "#dc2626" }}>미해결</span> 원인별 분석 ({report.unmatched.toLocaleString()})
          </div>
          {report.noSchedule.length === 0 ? (
            <div style={{ color: "#10b981", fontSize: 13 }}>✓ 모든 부재가 공정에 연결됨</div>
          ) : (
            report.noSchedule.map((cg) => (
              <div key={cg.cause} style={{ borderLeft: `3px solid ${cg.color}`, paddingLeft: 10, marginBottom: 10 }}>
                <div style={{ fontWeight: 600, color: cg.color, fontSize: 13 }}>
                  [{cg.cause}] {cg.title} — {cg.total.toLocaleString()}개
                </div>
                <div style={{ fontSize: 12, color: "#475569", margin: "2px 0" }}>· 왜: {cg.explain}</div>
                <div style={{ fontSize: 12, color: "#0f766e", margin: "2px 0" }}>· 권장: {cg.recommend}</div>
                <ul style={{ margin: "4px 0 0", paddingLeft: 16, fontSize: 12, lineHeight: 1.5, color: "#64748b", maxHeight: 90, overflow: "auto" }}>
                  {cg.items.map((it, i) => (
                    <li key={i}>
                      {it.label} — {it.count.toLocaleString()}개
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, color: "#ea580c", marginBottom: 6 }}>
            ② 공정 있는데 BIM 없음 — <span style={{ color: "#ea580c" }}>미해결</span> 원인별 분석 ({report.noBim.reduce((s, g) => s + g.total, 0).toLocaleString()})
          </div>
          {report.noBim.length === 0 ? (
            <div style={{ color: "#10b981", fontSize: 13 }}>✓ 모든 공정활동에 BIM 부재 연결됨</div>
          ) : (
            report.noBim.map((cg) => (
              <div key={cg.cause} style={{ borderLeft: `3px solid ${cg.color}`, paddingLeft: 10, marginBottom: 10 }}>
                <div style={{ fontWeight: 600, color: cg.color, fontSize: 13 }}>
                  [{cg.cause}] {cg.title} — {cg.total.toLocaleString()}건
                </div>
                <div style={{ fontSize: 12, color: "#475569", margin: "2px 0" }}>· 왜: {cg.explain}</div>
                <div style={{ fontSize: 12, color: "#0f766e", margin: "2px 0" }}>· 권장: {cg.recommend}</div>
                <ul style={{ margin: "4px 0 0", paddingLeft: 16, fontSize: 12, lineHeight: 1.5, color: "#64748b", maxHeight: 90, overflow: "auto" }}>
                  {cg.items.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>

        <Section title="③ 타임라인 순서 위반 (아래→위, 공종 순서)" color="#d97706"
          empty="공정 순서 정합 — 층·공종 순서 정상"
          items={report.seqViolations} />
        {report.seqViolations.length > 0 && (
          <div style={{ fontSize: 11, color: "#94a3b8", margin: "-8px 0 16px" }}>
            · 왜: 같은 구역·공종에서 위층이 아래층보다 먼저 시작하면 통상 시공순서(아래→위)에 어긋납니다.<br />
            · 권장: 병렬시공/조닝 의도면 정상입니다. 아니라면 선후행(TASKPRED) 연결을 재검토하세요.
          </div>
        )}

        <Section title="④ 4D Clash (같은 공간·동시 작업 중첩)" color="#7c3aed"
          empty="동일 공간 작업기간 중첩 없음"
          items={report.clashes4d} />

        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 8, borderTop: "1px solid #e2e8f0", paddingTop: 8 }}>
          ※ 3D Clash(형상 겹침)는 형상 간섭 계산이 필요해 별도 — 추후 추가. 본 보고서는 공정표↔BIM 정합·시간축 기준.
        </div>
      </div>
    </div>
  );
}

