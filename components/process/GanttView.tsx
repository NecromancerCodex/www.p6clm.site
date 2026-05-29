"use client";

import { CalendarRange, FileUp, Loader2, AlertTriangle } from "lucide-react";
import { type FC, useCallback, useEffect, useRef, useState } from "react";

import { type GanttTask } from "../../lib/api/schedule";
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
    if (!document.querySelector("link[data-frappe-gantt]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "/libs/frappe-gantt.css";
      link.setAttribute("data-frappe-gantt", "1");
      document.head.appendChild(link);
    }
    const existing = document.querySelector<HTMLScriptElement>("script[data-frappe-gantt]");
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
  const {
    snapshots, selectedId, tasks, summary, loading, uploading, error,
    loadedOnce, loadSnapshots, selectSnapshot, upload,
  } = useScheduleStore();
  const [projectName, setProjectName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [localErr, setLocalErr] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("Month");
  const [ganttReady, setGanttReady] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadFrappeGantt().then(() => setGanttReady(true)).catch((e) => setLocalErr(String(e)));
  }, []);

  useEffect(() => {
    if (!loadedOnce) loadSnapshots();
  }, [loadedOnce, loadSnapshots]);

  const onPick = useCallback((f: File | null) => {
    setLocalErr(null);
    if (f && !/\.(xml|xer)$/i.test(f.name)) {
      setLocalErr("Primavera P6 공정표(.xml 또는 .xer) 파일만 업로드할 수 있습니다.");
      return;
    }
    setFile(f);
  }, []);

  const onSubmit = useCallback(async () => {
    if (!file) {
      setLocalErr("공정표 파일을 선택하세요.");
      return;
    }
    setLocalErr(null);
    try {
      await upload(file, projectName);
      setFile(null);
    } catch {
      /* 에러는 store.error 로 표시 */
    }
  }, [file, projectName, upload]);

  // 베이스라인(목표 일정) 미설정 시 계획 진도·편차는 N/A — 근거 없는 수치 표시 방지
  const hasBaseline = summary != null && summary.planned_percent != null && summary.schedule_variance != null;
  const variance = summary?.schedule_variance ?? 0;
  const shownErr = localErr || error;

  return (
    <div className="ws-inner-pad">
      <div className="ws-section-title">
        <CalendarRange size={18} strokeWidth={1.8} />
        공정표 조회
      </div>
      <p className="ws-section-desc">
        Primavera P6 공정표(<code>.xer</code> 또는 <code>PMXML .xml</code>)를 업로드하면 CLM에 저장되어,
        이후 공정표·진도율 화면에서 재업로드 없이 계속 조회됩니다.
      </p>

      {/* 업로드 + 스냅샷 선택 바 */}
      <div className="sch-toolbar">
        {snapshots.length > 0 && (
          <select
            className="sch-input sch-snap-select"
            value={selectedId ?? ""}
            onChange={(e) => selectSnapshot(Number(e.target.value))}
          >
            {snapshots.map((s) => (
              <option key={s.id} value={s.id}>
                {(s.project_name || s.file_name || `#${s.id}`)} · {s.activity_count}건 ·{" "}
                {s.created_at ? new Date(s.created_at).toLocaleDateString() : ""}
              </option>
            ))}
          </select>
        )}
        <input
          className="sch-input sch-toolbar-proj"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          placeholder="프로젝트명 (선택)"
        />
        <button type="button" className="sch-dropzone sch-toolbar-file" onClick={() => inputRef.current?.click()}>
          <FileUp size={16} />
          <span>{file ? file.name : ".xer / .xml 선택"}</span>
        </button>
        <input ref={inputRef} type="file" accept=".xml,.xer,text/xml,application/xml" hidden
          onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
        <button type="button" className="sch-submit sch-toolbar-go" onClick={onSubmit}
          disabled={uploading || !file || !ganttReady}>
          {uploading ? <><Loader2 size={15} className="sch-spin" /> 저장 중</> : "업로드 · 저장"}
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

      {(!ganttReady || loading) && !shownErr && (
        <div className="sch-hint">
          <Loader2 size={14} className="sch-spin" /> {loading ? "공정표 불러오는 중…" : "간트 엔진 로딩 중…"}
        </div>
      )}
      {shownErr && <div className="sch-error"><AlertTriangle size={15} /> {shownErr}</div>}
      {loadedOnce && !loading && snapshots.length === 0 && !shownErr && (
        <div className="sch-hint">저장된 공정표가 없습니다. 위에서 .xer / .xml 파일을 업로드하세요.</div>
      )}

      {summary && (
        <>
          <div className="sch-metrics" style={{ marginTop: 14 }}>
            <Metric label="실제 진도" value={`${summary.overall_percent}%`} />
            <Metric label="계획 진도" value={hasBaseline ? `${summary.planned_percent}%` : "N/A"} />
            <Metric
              label="편차"
              value={hasBaseline ? `${variance > 0 ? "+" : ""}${variance}%p` : "—"}
              warn={hasBaseline && variance < 0}
            />
            <Metric label="활동" value={`${summary.activity_count}개`} />
            <Metric label="임계공정" value={`${summary.critical_count}개`} />
            <Metric label="지연" value={`${summary.delayed.length}개`} warn={summary.delayed.length > 0} />
          </div>
          {!hasBaseline && (
            <div className="sch-hint" style={{ marginTop: 8 }}>
              <AlertTriangle size={14} /> 베이스라인(목표 일정)이 설정되지 않아 계획 진도·편차를 산출할 수 없습니다.
              P6에서 베이스라인을 지정해 재업로드하면 계획 대비 분석이 표시됩니다.
            </div>
          )}
        </>
      )}

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
