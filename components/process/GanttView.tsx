"use client";

import { CalendarRange, FileUp, Loader2, AlertTriangle } from "lucide-react";
import { type FC, useCallback, useEffect, useRef, useState } from "react";

import { parseSchedule, ScheduleApiError, type GanttTask } from "../../lib/api/schedule";
import { useScheduleStore } from "../../stores/scheduleStore";
// 포크 frappe-gantt 기반 래퍼 (window.Gantt 사용). JS 컴포넌트 — props 타입 명시.
import GanttChartRaw from "./GanttChart";

const GanttChart = GanttChartRaw as unknown as FC<{
  tasks: GanttTask[];
  height?: number;
  viewMode?: string;
  focusId?: string | null;
}>;

/** 포크 frappe-gantt(umd) + css 를 1회 로드하고 window.Gantt 준비 여부 반환. */
let _ganttLoad: Promise<void> | null = null;
function loadFrappeGantt(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if ((window as unknown as { Gantt?: unknown }).Gantt) return Promise.resolve();
  if (_ganttLoad) return _ganttLoad;

  _ganttLoad = new Promise<void>((resolve, reject) => {
    // CSS
    if (!document.querySelector('link[data-frappe-gantt]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "/libs/frappe-gantt.css";
      link.setAttribute("data-frappe-gantt", "1");
      document.head.appendChild(link);
    }
    // JS
    const existing = document.querySelector<HTMLScriptElement>('script[data-frappe-gantt]');
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("frappe-gantt 로드 실패")));
      return;
    }
    const script = document.createElement("script");
    script.src = "/libs/frappe-gantt.umd.js";
    script.setAttribute("data-frappe-gantt", "1");
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("frappe-gantt 로드 실패"));
    document.body.appendChild(script);
  });
  return _ganttLoad;
}

const VIEW_MODES = ["Day", "Week", "Month"] as const;
type ViewMode = (typeof VIEW_MODES)[number];
const VIEW_LABEL: Record<ViewMode, string> = { Day: "일", Week: "주", Month: "월" };

export function GanttView() {
  const { tasks, summary, projectName: storedProject, setResult } = useScheduleStore();
  const [projectName, setProjectName] = useState(storedProject ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("Month");
  const [ganttReady, setGanttReady] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadFrappeGantt()
      .then(() => setGanttReady(true))
      .catch((e) => setError(String(e)));
  }, []);

  const onPick = useCallback((f: File | null) => {
    setError(null);
    if (f && !/\.xml$/i.test(f.name)) {
      setError("Primavera P6 XML(.xml) 파일만 업로드할 수 있습니다.");
      return;
    }
    setFile(f);
  }, []);

  const onSubmit = useCallback(async () => {
    if (!file) {
      setError("XML 파일을 선택하세요.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await parseSchedule(file, projectName);
      setResult({
        fileName: file.name,
        projectName: res.project_name,
        tasks: res.tasks,
        summary: res.summary,
      });
    } catch (e) {
      const msg = e instanceof ScheduleApiError ? e.detail : String(e);
      setError(`공정표 분석 실패: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [file, projectName, setResult]);

  const variance = summary?.schedule_variance ?? 0;

  return (
    <div className="ws-inner-pad">
      <div className="ws-section-title">
        <CalendarRange size={18} strokeWidth={1.8} />
        공정표 조회
      </div>
      <p className="ws-section-desc">
        Primavera P6 공정표(<code>PMXML .xml</code>)를 업로드하면 WBS 트리·주공정선(임계공정)·
        계획 대비 실적을 간트 차트로 표시합니다.
      </p>

      {/* 업로드 바 */}
      <div className="sch-toolbar">
        <input
          className="sch-input sch-toolbar-proj"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          placeholder="프로젝트명 (선택)"
        />
        <button type="button" className="sch-dropzone sch-toolbar-file" onClick={() => inputRef.current?.click()}>
          <FileUp size={16} />
          <span>{file ? file.name : ".xml 선택"}</span>
        </button>
        <input ref={inputRef} type="file" accept=".xml,text/xml,application/xml" hidden
          onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
        <button type="button" className="sch-submit sch-toolbar-go" onClick={onSubmit} disabled={loading || !file || !ganttReady}>
          {loading ? <><Loader2 size={15} className="sch-spin" /> 분석 중</> : "공정표 생성"}
        </button>
        {tasks.length > 0 && (
          <div className="sch-viewmode">
            {VIEW_MODES.map((vm) => (
              <button key={vm} type="button"
                className={`sch-vm-btn${viewMode === vm ? " active" : ""}`}
                onClick={() => setViewMode(vm)}>
                {VIEW_LABEL[vm]}
              </button>
            ))}
          </div>
        )}
      </div>

      {!ganttReady && !error && (
        <div className="sch-hint"><Loader2 size={14} className="sch-spin" /> 간트 엔진 로딩 중…</div>
      )}
      {error && <div className="sch-error"><AlertTriangle size={15} /> {error}</div>}

      {/* 진도 지표 스트립 */}
      {summary && (
        <div className="sch-metrics" style={{ marginTop: 14 }}>
          <Metric label="실제 진도" value={`${summary.overall_percent}%`} />
          <Metric label="계획 진도" value={`${summary.planned_percent}%`} />
          <Metric label="편차" value={`${variance > 0 ? "+" : ""}${variance}%p`} warn={variance < 0} />
          <Metric label="활동" value={`${summary.activity_count}개`} />
          <Metric label="임계공정" value={`${summary.critical_count}개`} />
          <Metric label="지연" value={`${summary.delayed.length}개`} warn={summary.delayed.length > 0} />
        </div>
      )}

      {/* 간트 */}
      {ganttReady && tasks.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <GanttChart tasks={tasks} height={560} viewMode={viewMode} />
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`sch-metric${warn ? " warn" : ""}`}>
      <span className="sch-metric-val">{value}</span>
      <span className="sch-metric-label">{label}</span>
    </div>
  );
}
