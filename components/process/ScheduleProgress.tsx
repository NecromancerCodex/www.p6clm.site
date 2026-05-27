"use client";

import { Activity, FileUp, Loader2, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";

import { parseSchedule, ScheduleApiError } from "../../lib/api/schedule";
import { useScheduleStore } from "../../stores/scheduleStore";

export function ScheduleProgress() {
  const { summary, projectName: storedProject, setResult } = useScheduleStore();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const onSubmit = useCallback(async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const res = await parseSchedule(file);
      setResult({
        fileName: file.name,
        projectName: res.project_name,
        tasks: res.tasks,
        summary: res.summary,
      });
    } catch (e) {
      setError(e instanceof ScheduleApiError ? e.detail : String(e));
    } finally {
      setLoading(false);
    }
  }, [file, setResult]);

  return (
    <div className="ws-inner-pad">
      <div className="ws-section-title">
        <Activity size={18} strokeWidth={1.8} />
        공정 진도율
      </div>
      <p className="ws-section-desc">
        업로드된 공정표의 기준일 시점 진도율·지연 활동을 분석합니다.{" "}
        {storedProject ? (
          <>현재 프로젝트: <strong>{storedProject}</strong></>
        ) : (
          <><Link href="/schedule/construction">공정표</Link>에서 먼저 업로드하거나 아래에서 업로드하세요.</>
        )}
      </p>

      {!summary && (
        <div className="sch-toolbar">
          <button type="button" className="sch-dropzone sch-toolbar-file" onClick={() => inputRef.current?.click()}>
            <FileUp size={16} />
            <span>{file ? file.name : ".xml 선택"}</span>
          </button>
          <input ref={inputRef} type="file" accept=".xml" hidden
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <button type="button" className="sch-submit sch-toolbar-go" onClick={onSubmit} disabled={loading || !file}>
            {loading ? <><Loader2 size={15} className="sch-spin" /> 분석 중</> : "진도 분석"}
          </button>
        </div>
      )}

      {error && <div className="sch-error"><AlertTriangle size={15} /> {error}</div>}

      {summary && (
        <>
          <div className="sch-metrics" style={{ marginTop: 14 }}>
            <Metric label="실제 진도" value={`${summary.overall_percent}%`} big />
            <Metric label="계획 진도" value={`${summary.planned_percent}%`} />
            <Metric label="편차" value={`${summary.schedule_variance > 0 ? "+" : ""}${summary.schedule_variance}%p`} warn={summary.is_behind} />
            <Metric label="완료" value={`${summary.completed_count}`} />
            <Metric label="진행" value={`${summary.in_progress_count}`} />
            <Metric label="미착수" value={`${summary.not_started_count}`} />
            <Metric label="임계공정" value={`${summary.critical_count}`} />
            <Metric label="지연" value={`${summary.delayed.length}`} warn={summary.delayed.length > 0} />
          </div>

          {/* 진도 막대 */}
          <div className="sch-progress-bar-wrap">
            <div className="sch-progress-track">
              <div className="sch-progress-planned" style={{ width: `${Math.min(100, summary.planned_percent)}%` }} title={`계획 ${summary.planned_percent}%`} />
              <div className={`sch-progress-actual${summary.is_behind ? " behind" : ""}`} style={{ width: `${Math.min(100, summary.overall_percent)}%` }} title={`실제 ${summary.overall_percent}%`} />
            </div>
            <div className="sch-progress-legend">
              <span><i className="dot planned" /> 계획 {summary.planned_percent}%</span>
              <span><i className="dot actual" /> 실제 {summary.overall_percent}%</span>
            </div>
          </div>

          {/* 지연 활동 테이블 */}
          <h3 className="sch-h3">지연 활동 ({summary.delayed.length})</h3>
          {summary.delayed.length === 0 ? (
            <p className="sch-empty">지연 활동이 없습니다.</p>
          ) : (
            <table className="sch-table">
              <thead>
                <tr>
                  <th>코드</th><th>공정명</th><th>유형</th><th>지연(일)</th><th>진도</th><th>계획종료</th><th>임계</th>
                </tr>
              </thead>
              <tbody>
                {summary.delayed.map((d) => (
                  <tr key={d.code} className={d.is_critical ? "is-cp" : ""}>
                    <td>{d.code}</td>
                    <td>{d.name}</td>
                    <td>{d.reason}</td>
                    <td className="num warn">{d.delay_days}</td>
                    <td className="num">{d.percent_complete.toFixed(0)}%</td>
                    <td>{d.planned_finish ?? "-"}</td>
                    <td>{d.is_critical ? "⚠" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* 다가오는 마일스톤 */}
          <h3 className="sch-h3">다가오는 마일스톤</h3>
          {summary.upcoming_milestones.length === 0 ? (
            <p className="sch-empty">예정된 마일스톤이 없습니다.</p>
          ) : (
            <ul className="sch-milestones">
              {summary.upcoming_milestones.map((m) => (
                <li key={m.code}><span className="diamond" /> {m.name} <em>{m.date ?? "-"}</em></li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function Metric({ label, value, warn, big }: { label: string; value: string; warn?: boolean; big?: boolean }) {
  return (
    <div className={`sch-metric${warn ? " warn" : ""}${big ? " big" : ""}`}>
      <span className="sch-metric-val">{value}</span>
      <span className="sch-metric-label">{label}</span>
    </div>
  );
}
