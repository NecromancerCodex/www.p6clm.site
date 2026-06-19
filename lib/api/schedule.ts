/**
 * 공정관리(Schedule) API 클라이언트.
 *
 * Backend: CLM FastAPI  POST /api/v1/schedule/analyze
 * Frontend base: /api/clm  (next.config.ts rewrite → CLM /api/v1)
 *
 * Primavera P6 XML(PMXML) 업로드 → 공정 보고서(공정계획/현황/지연) 1건 생성.
 */

const API_BASE = "/api/clm";

export type ScheduleDocType =
  | "proc_daily"
  | "proc_weekly"
  | "proc_monthly"
  | "proc_supervision";

export const SCHEDULE_DOC_LABELS: Record<ScheduleDocType, string> = {
  proc_daily: "공사일보",
  proc_weekly: "주간 공정현황 보고",
  proc_monthly: "월간 공정현황 보고",
  proc_supervision: "감리 보고서",
};

export interface ScheduleMetrics {
  project_name?: string;
  data_date?: string;
  overall_percent?: number;
  planned_percent?: number;
  schedule_variance?: number;
  activity_count?: number;
  critical_count?: number;
  delayed_count?: number;
}

/** 지연·임계 공정 1행 (양식 테이블용). */
export interface ScheduleDocDelayedRow {
  code: string;
  name: string;
  wbs_path: string;
  reason: string;
  delay_days: number;
  percent_complete: number;
  is_critical: boolean;
  planned_finish: string;
}

/** 백엔드가 내려주는 구조화 공정 보고서 (ScheduleFormView 가 그대로 렌더). */
export interface ScheduleReportDoc {
  doc_type: ScheduleDocType;
  title: string;
  document_number: string;
  construction_name: string;
  data_date: string;
  reference_date: string;
  report_date: string;
  status_level: "지연" | "정상";
  project_start: string;
  project_finish: string;
  total_duration_days: number;
  overall_percent: number;
  planned_percent: number | null;   // 베이스라인 미설정 시 null (N/A)
  schedule_variance: number | null; // 베이스라인 미설정 시 null (N/A)
  baseline_valid?: boolean;
  simulated?: boolean;              // 4D 시뮬레이션 — 진행현황이 계획 날짜 기준(실적 아님)
  actual_based?: boolean;           // 실적 기반 — 워크유닛 수동 상태(완료/진행/대기)
  critical_unscheduled?: boolean;   // 전 활동 임계=CPM 미실행 → 임계공정 '미산정'
  activity_count: number;
  milestone_count: number;
  completed_count: number;
  in_progress_count: number;
  not_started_count: number;
  critical_count: number;
  delayed_count: number;
  delayed: ScheduleDocDelayedRow[];
  milestones: { name: string; date: string }[];
  upcoming_critical: {
    code: string;
    name: string;
    wbs_path: string;
    planned_start: string;
    days_until: number;
    is_critical: boolean;
  }[];
  delay_impacts: {
    name: string;
    delay_days: number;
    is_critical: boolean;
    downstream_count: number;
    affected_milestones: string[];
  }[];
  integrity_warnings: string[];
  doc_recommendations: {
    activity_name: string;
    wbs_path: string;
    work_type: string;
    when: string;
    is_critical: boolean;
    doc_types: { type: string; label: string }[];
  }[];
  doc_rec_summary: { type: string; label: string; count: number }[];
  active_today: {
    code: string;
    name: string;
    wbs_path: string;
    planned_start: string;
    planned_finish: string;
    percent_complete: number;
    is_critical: boolean;
    status?: string | null; // 실적 모드: pending|active|done (완료 포함 금일 작업 표시)
  }[];
  narrative: string;
  grounding: string;
}

export interface ScheduleAnalyzeResult {
  success: boolean;
  job_id: string;
  doc_type: ScheduleDocType;
  doc_label: string;
  project_name: string | null;
  report_markdown: string | null;
  metrics: ScheduleMetrics | null;
  document: ScheduleReportDoc | null;
  alert_required: boolean;
  steps_taken: string[];
}

export class ScheduleApiError extends Error {
  constructor(public status: number, public detail: string) {
    super(detail);
    this.name = "ScheduleApiError";
  }
}

export interface GanttTask {
  id: string;
  activity_code: string;
  name: string;
  wbs_code: string;
  start?: string;
  end?: string;
  date?: string;
  is_milestone?: boolean;
  progress: number;
  is_cp: boolean;
  total_float_hr_cnt: number | null;
  status: string;
  dependencies: string[];
  baseline_start_date?: string | null;
  baseline_finish_date?: string | null;
  custom_class?: string;
  data_date?: string | null;
}

export interface DelayedRow {
  code: string;
  name: string;
  wbs_path: string;
  planned_finish: string | null;
  forecast_finish: string | null;
  delay_days: number;
  percent_complete: number;
  is_critical: boolean;
  reason: string;
}

export interface ScheduleSummary {
  project_name: string;
  data_date: string | null;
  project_start: string | null;
  project_finish: string | null;
  total_duration_days: number;
  overall_percent: number;
  planned_percent: number | null;   // 베이스라인 미설정 시 null (N/A)
  schedule_variance: number | null; // 베이스라인 미설정 시 null (N/A)
  baseline_valid?: boolean;         // false = target 날짜가 실제 계획 미반영
  is_behind: boolean;
  activity_count: number;
  milestone_count: number;
  completed_count: number;
  in_progress_count: number;
  not_started_count: number;
  critical_count: number;
  delayed: DelayedRow[];
  upcoming_milestones: { code: string; name: string; date: string | null }[];
}

export interface ScheduleParseResult {
  success: boolean;
  project_name: string;
  data_date: string | null;
  tasks: GanttTask[];
  summary: ScheduleSummary;
  warnings: string[];
}

export interface SnapshotMeta {
  id: number;
  project_name: string | null;
  data_date: string | null;
  file_name: string | null;
  source_format: string | null;
  activity_count: number;
  created_at: string | null;
}

export interface SnapshotFull extends SnapshotMeta {
  tasks: GanttTask[];
  summary: ScheduleSummary;
}

/** 업로드 → 파싱·분석 → CLM DB(schedule_snapshots) 저장. 저장 id + 데이터 반환. */
export async function uploadSchedule(
  file: File,
  projectName?: string,
): Promise<SnapshotFull> {
  const form = new FormData();
  form.append("file", file);
  if (projectName?.trim()) form.append("project_name", projectName.trim());
  const res = await fetch(`${API_BASE}/schedule/upload`, { method: "POST", body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = (body && (body.detail ?? body.error)) || `${res.status} ${res.statusText}`;
    throw new ScheduleApiError(res.status, String(detail));
  }
  return (await res.json()) as SnapshotFull;
}

/** 저장된 스냅샷 목록 (메타데이터). */
export async function listSnapshots(): Promise<SnapshotMeta[]> {
  const res = await fetch(`${API_BASE}/schedule/snapshots`);
  if (!res.ok) throw new ScheduleApiError(res.status, `${res.status} ${res.statusText}`);
  const j = await res.json();
  return (j.items ?? []) as SnapshotMeta[];
}

/** 단일 스냅샷 전체 (tasks + summary). */
export async function getSnapshot(id: number): Promise<SnapshotFull> {
  const res = await fetch(`${API_BASE}/schedule/snapshots/${id}`);
  if (!res.ok) throw new ScheduleApiError(res.status, `${res.status} ${res.statusText}`);
  return (await res.json()) as SnapshotFull;
}

/** 공정 보고서(일/주/월) 작성 현황 1행. */
export interface ScheduleReportMeta {
  id: number;
  doc_type: ScheduleDocType;
  date: string | null;       // reference_date(공사일보 금일) 또는 report/data_date
  title: string | null;
  document_number: string | null;
  created_at: string | null;
}

/** 소유자의 공정 보고서(일/주/월) 작성 현황 목록. */
export async function listScheduleReports(): Promise<ScheduleReportMeta[]> {
  const res = await fetch(`${API_BASE}/schedule/reports`);
  if (!res.ok) throw new ScheduleApiError(res.status, `${res.status} ${res.statusText}`);
  const j = await res.json();
  return (j.reports ?? []) as ScheduleReportMeta[];
}

/** 단건 공정 보고서 — raw_document(ScheduleReportDoc) 반환 → ScheduleFormView 렌더. */
export async function getScheduleReport(id: number): Promise<ScheduleReportDoc | null> {
  const res = await fetch(`${API_BASE}/schedule/reports/${id}`);
  if (!res.ok) throw new ScheduleApiError(res.status, `${res.status} ${res.statusText}`);
  const j = await res.json();
  return (j.document ?? null) as ScheduleReportDoc | null;
}

/** 그 주/달의 공사일보를 모아 주간/월간 공정현황 보고서 집계·생성. (파일 불필요 — 저장된 일보 집계) */
export async function aggregateReport(
  period: "weekly" | "monthly",
  date: string, // YYYY-MM-DD (그 주/달)
): Promise<{ id: number | null; doc_type: ScheduleDocType; label: string; daily_count: number; document: ScheduleReportDoc | null }> {
  const form = new FormData();
  form.append("period", period);
  form.append("date_str", date);
  const res = await fetch(`${API_BASE}/schedule/aggregate`, { method: "POST", body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ScheduleApiError(res.status, String((body && (body.detail ?? body.error)) || `${res.status}`));
  }
  return await res.json();
}

/** PMXML 파일 업로드 → 공정표(Gantt) task + 진도 요약 (stateless, 저장 X). */
export async function parseSchedule(
  file: File,
  projectName?: string,
): Promise<ScheduleParseResult> {
  const form = new FormData();
  form.append("file", file);
  if (projectName?.trim()) form.append("project_name", projectName.trim());

  const res = await fetch(`${API_BASE}/schedule/parse`, { method: "POST", body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = (body && (body.detail ?? body.error)) || `${res.status} ${res.statusText}`;
    throw new ScheduleApiError(res.status, String(detail));
  }
  return (await res.json()) as ScheduleParseResult;
}

/** 내역서(BOQ) 파싱 결과 — 공종 카드 업로드용. */
export interface BoqResult {
  quantities?: Record<string, number>;   // concrete_m3, formwork_m2, rebar_ton, excavation_m3, backfill_m3, total_cost
  total_cost?: number;
  has_prices?: boolean;
  rows?: number;
  items_matched?: number;
  sheet?: string;       // xlsx 채택 시트명
  filename?: string;
  error?: string;
}

/** 내역서(.csv/.xlsx/.xlsm) 업로드 → 물량/원가 추출 (공종 카드별). */
export async function parseBoq(file: File): Promise<BoqResult> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/schedule/boq/parse`, { method: "POST", body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = (body && (body.detail ?? body.error)) || `${res.status} ${res.statusText}`;
    throw new ScheduleApiError(res.status, String(detail));
  }
  return (await res.json()) as BoqResult;
}

/**
 * PMXML 파일 업로드 → 공정 보고서 생성 (동기).
 * targetDate: 공사일보 '금일' 기준일 (YYYY-MM-DD). 4D 슬라이더 날짜 전달용. 미지정 시 서버 today.
 */
export async function analyzeSchedule(
  file: File,
  docType: ScheduleDocType,
  projectName?: string,
  targetDate?: string,
  statusMap?: Record<string, string>, // {activity_code: pending|active|done} → 실적 기반 공사일보
  delayReason?: string,               // weather|material|equipment|labor|inspection|other → 주간/월간 집계용
): Promise<ScheduleAnalyzeResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("doc_type", docType);
  if (projectName?.trim()) form.append("project_name", projectName.trim());
  if (targetDate?.trim()) form.append("target_date", targetDate.trim());
  if (statusMap && Object.keys(statusMap).length) form.append("status_map", JSON.stringify(statusMap));
  if (delayReason?.trim()) form.append("delay_reason", delayReason.trim());

  const res = await fetch(`${API_BASE}/schedule/analyze`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail =
      (body && (body.detail ?? body.error)) || `${res.status} ${res.statusText}`;
    throw new ScheduleApiError(res.status, String(detail));
  }
  return (await res.json()) as ScheduleAnalyzeResult;
}

// ── 공정표 자동생성기 (6하원칙 → GPT-5.4 → P6 XML) ──────────────────────────

export interface MethodItem { key: string; name: string; discipline: string }
export interface MethodGroup { category: string; key: string; methods: MethodItem[] }

export async function listScheduleMethods(): Promise<MethodGroup[]> {
  const res = await fetch(`${API_BASE}/schedule/methods`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.groups ?? []) as MethodGroup[];
}

export interface GenWorkUnit {
  zone?: string; storey?: string; element_type?: string;
  count?: number; quantity?: number; unit?: string;
  volume_m3?: number; // 정량물량 체적 ㎥ (콘크리트) — 품셈 정밀적용·자원계획용
  area_m2?: number; // 정량물량 면적 ㎡ (거푸집)
  discipline?: string; // 공종(토목/구조/건축/MEP/조경/가설) — 멀티파싱 병합 분리용
}
export interface GenMilestone {
  name: string;          // 마일스톤명 (예: 굴토심의 통과, 철골 현장반입, 사용승인)
  target_date: string;   // YYYY-MM-DD — 이 날짜 이후 게이트 공종 착수 가능
  gates: string;         // 전체|토목|구조|건축|MEP|조경
  kind: string;          // permit(인허가)|material(자재반입)|contract(계약)
}
export interface GenerateScheduleRequest {
  building_type: string;
  scope?: string;
  structure_type?: string;
  discipline?: string; // 공종(토목/구조/건축/MEP/조경) — 공종별 모듈 디스패치
  zones: string[];
  storeys: string[];
  work_units: GenWorkUnit[];
  methods: string[];
  start_date: string;          // YYYY-MM-DD
  target_finish?: string;
  duration_months?: number;
  work_days_per_week: number;
  tower_cranes: number;        // 타워크레인 수 — 동시 양중 한계(스태거)
  work_crews: number;          // 작업조 수 — 동시 동일공종 한계
  civil_equipment?: number;    // 토목 투입조(굴착기·CIP장비 대수) — 토목 기간 = 물량 ÷ (생산성 × 투입조)
  discipline_crews?: Record<string, number>; // 공종별 작업조 {건축, MEP, 조경} — 슬롯 밑 입력, 해당 공종 기간 단축
  gross_floor_area?: number;   // 연면적(㎡) — 건축/MEP 물량 기반 기간(마감·설비는 연면적 비례). 없으면 부재수
  civil_quantities?: { depth_m?: number; footprint_m2?: number; perimeter_m?: number; pile_count?: number }; // 토목 물량(서버 도출)
  discipline_settings?: Record<string, { wbs?: string; start?: string; finish?: string; util?: string; wdpw?: string; strategy?: string; notes?: string; win?: string; heat?: string; rain?: string; snow?: string; wind?: string; boq?: Record<string, number>; boq_confirm?: boolean }>; // 공종별 분리(착공일·가동률·전략·WBS·기상임계·내역서물량·보정컨펌)
  weather_station?: string;   // 기상 지역(서울 등) — 공종별 가동률 기상 기반 산정(미지정 시 프리셋)
  utilization_rate?: number;   // 가동률(0<u≤1) — 공기 현실화(공수÷가동률). 공휴일은 서버가 항상 자동 제외
  formwork_system?: string;    // 거푸집 시스템(재래식/유로폼/갱폼/알폼/시스템폼) — 골조 기준층 사이클 결정
  rapid_concrete?: boolean;    // 조강콘크리트 사용 — 양생기간 단축(×3/7)
  seasonal_weather?: boolean;  // 계절 비작업일 자동 반영 — 동절기(12·1·2월)·우기(7·8월). 가동률과 별개 축
  milestones?: GenMilestone[]; // 외부 마일스톤(인허가/자재반입/계약) — BIM에 없는 외부 게이트
  constraints?: string;
  strategy?: string;   // bottom_up(순타)|top_down(역타) — BIM에 없는 발주·부지 조건(사람 선택)
}
export interface GenTask {
  code: string; name: string; start: string; end: string;
  wbs: string; discipline: string; method: string | null;
  duration_days: number; milestone: boolean; predecessors: string[];
}
export interface GenerateScheduleResult {
  project_name: string;
  start_date: string;
  end_date: string | null;
  activity_count: number;
  relationship_count: number;
  tasks: GenTask[];
  p6xml: string;
  warnings: string[];
  notes: string | null;
  model: string;
  search_rounds: number;
  tool_log: string[];
}

/**
 * 공정표 생성 — 비동기 잡: POST 로 job_id 받고 폴링.
 * gpt-5.4 에이전틱 생성이 2~3분 걸려 동기 요청은 게이트웨이 타임아웃(502) → 잡 패턴.
 */
export async function generateSchedule(
  req: GenerateScheduleRequest,
  onTick?: (elapsedSec: number, progress?: string) => void,
): Promise<GenerateScheduleResult> {
  // 1) 잡 생성 (즉시 반환)
  const res = await fetch(`${API_BASE}/schedule/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = (body && (body.detail ?? body.error)) || `${res.status} ${res.statusText}`;
    throw new ScheduleApiError(res.status, String(detail));
  }
  const { job_id } = (await res.json()) as { job_id: string };

  // 2) 폴링 (3초 간격, 최대 10분) — progress 스트리밍
  const started = Date.now();
  const deadline = started + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const s = await fetch(`${API_BASE}/schedule/generate-status/${job_id}`);
    if (!s.ok) {
      onTick?.(Math.round((Date.now() - started) / 1000));
      continue;
    }
    const data = (await s.json()) as {
      status: string; result?: GenerateScheduleResult; error?: string; progress?: string;
    };
    onTick?.(Math.round((Date.now() - started) / 1000), data.progress);
    if (data.status === "done" && data.result) return data.result;
    if (data.status === "error") throw new ScheduleApiError(500, data.error || "생성 실패");
  }
  throw new ScheduleApiError(504, "생성 시간 초과 (10분) — 입력을 줄이거나 다시 시도해주세요.");
}

export interface InferContextResult { building_type: string; scope: string; structure_type: string; reason: string; discipline?: string }
export async function inferScheduleContext(req: {
  storeys: string[]; zones: string[];
  element_summary: { type: string; count: number; names?: string[] }[]; total_count: number;
  trade_summary?: { trade: string; count: number }[];   // 공정 PSet Trade(ST/MO) — 구조유형 결정론 신호
  discipline_summary?: { discipline: string; count: number }[];   // 공종(흙막이 보정 후) — 멀티파싱 판정
}): Promise<InferContextResult> {
  const res = await fetch(`${API_BASE}/schedule/infer-context`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req),
  });
  if (!res.ok) return { building_type: "", scope: "", structure_type: "", reason: "" };
  return (await res.json()) as InferContextResult;
}

// ── IFC → S3 → 서버 work_unit 추출 (C-1) — 대용량 IFC 브라우저 부담 0 ───────────
export interface IfcWorkUnitsResult {
  work_units: { zone: string; storey: string; element_type: string; count: number; discipline?: string }[];
  zones: string[];
  storeys: string[];
  trade_summary: { trade: string; count: number }[];
  discipline_summary?: { discipline: string; count: number }[];   // 공종 분포(흙막이 보정 후)
  civil_quantities?: { depth_m?: number; footprint_m2?: number; perimeter_m?: number; pile_count?: number }; // 토목 물량(서버 placement 도출)
  suggested_equip?: number;      // 물량 기반 권장 토목 투입조(목표 굴착공기 기준) — 대형현장 비현실 기본값 방지
  project_name?: string;         // IFC 프로젝트/건물명 — 슬롯 간 다른 프로젝트 섞임 검출(보조 신호)
  element_summary: { type: string; count: number; names?: string[] }[];
  unknown_types?: { type: string; count: number; names?: string[] }[]; // 미상(분류 실패) IFC타입
  ai_classified?: number;        // AI 가 이름·타입으로 추정 분류한 부재 수(확정과 구분)
  element_count: number;
}

/** presigned URL 발급 → S3 직접 업로드 → 서버 추출. 실패 시 throw(호출측이 클라 파싱 폴백). */
export async function extractIfcWorkUnitsViaS3(file: File): Promise<IfcWorkUnitsResult> {
  const pres = await fetch(`${API_BASE}/schedule/ifc/presign`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, content_type: file.type || "application/octet-stream" }),
  });
  if (!pres.ok) throw new Error(`presign 실패 (${pres.status})`);
  const { object_key, upload_url, headers } = (await pres.json()) as {
    object_key: string; upload_url: string; headers: Record<string, string>;
  };
  const put = await fetch(upload_url, { method: "PUT", body: file, headers });
  if (!put.ok) throw new Error(`S3 업로드 실패 (${put.status})`);
  const ext = await fetch(`${API_BASE}/schedule/ifc/workunits`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ object_key }),
  });
  if (!ext.ok) throw new Error(`서버 추출 실패 (${ext.status})`);
  return (await ext.json()) as IfcWorkUnitsResult;
}

// ═══ PM 4단계 단계별 계획 (휴먼인더루프) — /schedule/plan/* ═══════════════════

export type PlanStage =
  | "running_p2"      // 플래닝 그래프 실행 중 (WBS~듀레이션, [n/5] progress)
  | "logic_ready"     // 플래닝 완료 — 검토 게이트
  | "scheduled"       // 베이스라인 생성 — 최종 검토
  | "done" | "error";

export interface PlanPredecessor { code: string; type?: string; lag_days?: number }
export interface PlanActivity {
  code: string; name: string;
  wbs_path?: string; discipline?: string; method?: string | null;
  duration_days: number; milestone?: boolean;
  predecessors?: PlanPredecessor[];
  fd_zone?: string | null; fd_storey?: string | null; fd_op?: string | null; fd_phase?: string | null;
  res_crane?: number; res_crew?: number;   // SGS 자원 평준화 입력 (양중=크레인1)
}
export interface PlanScopeWbs {
  wbs: { zone: string; storeys: { storey: string; discs: string[] }[] }[];
  package_count: number; zones: string[]; scope: string; structure_type?: string | null;
}
export interface PlanState {
  plan_id: string; stage: PlanStage; progress?: string | null;
  payload: {
    scope?: PlanScopeWbs;
    activities?: PlanActivity[];
    activities_user?: PlanActivity[];
    notes?: string | null;
    schedule?: { tasks?: GanttTask[] & Record<string, unknown>[] } & Record<string, unknown>;
    strategy?: string;   // bottom_up(순타)|top_down(역타) — SGS 지하밴드 토글
    rationale?: { define?: string; relation?: string; duration?: string };
    stats?: { relation?: { llm?: number; backstop?: number }; duration?: { applied?: number; total?: number } };
    error?: string;
  };
}

async function planFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}/schedule/plan${path}`, {
    headers: { "Content-Type": "application/json" }, ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = (body && (body.detail ?? body.error)) || `${res.status} ${res.statusText}`;
    throw new ScheduleApiError(res.status, String(detail));
  }
  return (await res.json()) as T;
}

/** P1 스코프(즉시) + P2 액티비티(백그라운드) 시작 */
export async function startPlan(req: GenerateScheduleRequest): Promise<{ plan_id: string; stage: PlanStage; scope: PlanScopeWbs }> {
  return planFetch("/start", { method: "POST", body: JSON.stringify(req) });
}

/** 단계·산출물 폴링 */
export async function getPlan(planId: string): Promise<PlanState> {
  return planFetch(`/${planId}`);
}

/** [Gate A] 액티비티 수정본 저장 */
export async function savePlanActivities(planId: string, activities: PlanActivity[], note?: string): Promise<void> {
  await planFetch(`/${planId}/activities`, { method: "PUT", body: JSON.stringify({ activities, note }) });
}

/** 현 단계 컨펌 → 다음 단계. crane/crew 주면 그 자원으로 재스케줄(목표공기 역산 제안 적용) */
export async function confirmPlan(planId: string, res?: { crane?: number; crew?: number; civil_equipment?: number; utilization_rate?: number; formwork_system?: string; rapid_concrete?: boolean; seasonal_weather?: boolean; milestones?: GenMilestone[] }): Promise<{ stage: PlanStage }> {
  return planFetch(`/${planId}/confirm`, { method: "POST", body: JSON.stringify(res ?? {}) });
}

// ── 설계변경 영향분석(IFC diff) ──────────────────────────────────────────────
export interface IfcDiffBucket {
  zone: string; storey: string; discipline: string; element_type: string;
  count?: number; old_count?: number; new_count?: number; delta?: number; pct?: number | null;
  affected_activities: { code: string; name: string }[];
}
export interface IfcDiffResult {
  added: IfcDiffBucket[];
  deleted: IfcDiffBucket[];
  changed: IfcDiffBucket[];
  summary: { added_buckets: number; deleted_buckets: number; changed_buckets: number; affected_activities: number; has_change: boolean };
}
/** 새 IFC work_units 를 플랜의 옛 버전과 비교 — 추가/삭제/물량변경 + 영향 Activity. */
export async function ifcDiff(planId: string, workUnits: unknown[]): Promise<IfcDiffResult> {
  return planFetch(`/${planId}/ifc-diff`, { method: "POST", body: JSON.stringify({ work_units: workUnits }) });
}

export interface ScheduleRisk { severity: string; category: string; title: string; detail: string; count?: number; mitigation: string }
/** AI 리스크 브리핑 — 결정론 탐지 리스크를 mini 가 우선순위·대응으로 서술. */
export async function riskBrief(planId: string): Promise<{ brief: string }> {
  return planFetch(`/${planId}/risk-brief`, { method: "POST", body: "{}" });
}

/** P6 XML 다운로드 URL */
export function planP6XmlUrl(planId: string): string {
  return `${API_BASE}/schedule/plan/${planId}/p6xml`;
}

/** P6 XML 다운로드 URL — import 전용(짧은 Activity Id). 4D용 planP6XmlUrl(긴 4D코드)과 분리. */
export function planP6XmlDownloadUrl(planId: string): string {
  return `${API_BASE}/schedule/plan/${planId}/p6xml-export`;
}

/** P6 XER 다운로드 URL (Primavera import 가장 호환) */
export function planXerUrl(planId: string): string {
  return `${API_BASE}/schedule/plan/${planId}/xer`;
}
