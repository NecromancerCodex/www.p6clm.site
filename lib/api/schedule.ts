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
}
export interface GenerateScheduleRequest {
  building_type: string;
  scope?: string;
  zones: string[];
  storeys: string[];
  work_units: GenWorkUnit[];
  methods: string[];
  start_date: string;          // YYYY-MM-DD
  target_finish?: string;
  duration_months?: number;
  work_days_per_week: number;
  constraints?: string;
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

export async function generateSchedule(
  req: GenerateScheduleRequest,
): Promise<GenerateScheduleResult> {
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
  return (await res.json()) as GenerateScheduleResult;
}
