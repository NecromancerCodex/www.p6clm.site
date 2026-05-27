/**
 * 공정관리(Schedule) API 클라이언트.
 *
 * Backend: CLM FastAPI  POST /api/v1/schedule/analyze
 * Frontend base: /api/clm  (next.config.ts rewrite → CLM /api/v1)
 *
 * Primavera P6 XML(PMXML) 업로드 → 공정 보고서(공정계획/현황/지연) 1건 생성.
 */

const API_BASE = "/api/clm";

export type ScheduleDocType = "process_plan" | "process_status" | "process_delay";

export const SCHEDULE_DOC_LABELS: Record<ScheduleDocType, string> = {
  process_plan: "공정 계획서",
  process_status: "공정 현황 보고서",
  process_delay: "공정 지연 분석서",
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

export interface ScheduleAnalyzeResult {
  success: boolean;
  job_id: string;
  doc_type: ScheduleDocType;
  doc_label: string;
  project_name: string | null;
  report_markdown: string | null;
  metrics: ScheduleMetrics | null;
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
  planned_percent: number;
  schedule_variance: number;
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

/** PMXML 파일 업로드 → 공정 보고서 생성 (동기). */
export async function analyzeSchedule(
  file: File,
  docType: ScheduleDocType,
  projectName?: string,
): Promise<ScheduleAnalyzeResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("doc_type", docType);
  if (projectName?.trim()) form.append("project_name", projectName.trim());

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
