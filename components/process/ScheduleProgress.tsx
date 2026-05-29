"use client";

import { Activity, Loader2, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { useScheduleStore } from "../../stores/scheduleStore";

export function ScheduleProgress() {
  const {
    snapshots, selectedId, summary, loading, error, loadedOnce,
    loadSnapshots, selectSnapshot,
  } = useScheduleStore();

  useEffect(() => {
    if (!loadedOnce) loadSnapshots();
  }, [loadedOnce, loadSnapshots]);

  return (
    <div className="ws-inner-pad">
      <div className="ws-section-title">
        <Activity size={18} strokeWidth={1.8} />
        공정 진도율
      </div>
      <p className="ws-section-desc">
        CLM에 저장된 공정표의 기준일 시점 진도율·지연 활동을 보여 줍니다.
      </p>

      {snapshots.length > 0 && (
        <div className="sch-toolbar">
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
        </div>
      )}

      {loading && <div className="sch-hint"><Loader2 size={14} className="sch-spin" /> 불러오는 중…</div>}
      {error && <div className="sch-error"><AlertTriangle size={15} /> {error}</div>}
      {loadedOnce && !loading && snapshots.length === 0 && !error && (
        <div className="sch-hint">
          저장된 공정표가 없습니다. <Link href="/schedule/construction">공정표</Link>에서 먼저 업로드하세요.
        </div>
      )}

      {summary && (() => {
        // 베이스라인 미설정 시 계획 진도·편차 N/A — 근거 없는 수치 방지
        const hasBaseline = summary.planned_percent != null && summary.schedule_variance != null;
        const plannedPct = summary.planned_percent ?? 0;
        return (
        <>
          <div className="sch-metrics" style={{ marginTop: 14 }}>
            <Metric label="실제 진도" value={`${summary.overall_percent}%`} big />
            <Metric label="계획 진도" value={hasBaseline ? `${summary.planned_percent}%` : "N/A"} />
            <Metric
              label="편차"
              value={hasBaseline ? `${summary.schedule_variance! > 0 ? "+" : ""}${summary.schedule_variance}%p` : "—"}
              warn={hasBaseline && summary.is_behind}
            />
            <Metric label="완료" value={`${summary.completed_count}`} />
            <Metric label="진행" value={`${summary.in_progress_count}`} />
            <Metric label="미착수" value={`${summary.not_started_count}`} />
            <Metric label="임계공정" value={`${summary.critical_count}`} />
            <Metric label="지연" value={`${summary.delayed.length}`} warn={summary.delayed.length > 0} />
          </div>

          {!hasBaseline && (
            <div className="sch-hint" style={{ marginTop: 8 }}>
              <AlertTriangle size={14} /> 베이스라인(목표 일정)이 설정되지 않아 계획 진도·편차를 산출할 수 없습니다.
              P6에서 베이스라인을 지정해 재업로드하면 계획 대비 분석이 표시됩니다.
            </div>
          )}

          {/* 진도 막대 */}
          <div className="sch-progress-bar-wrap">
            <div className="sch-progress-track">
              {hasBaseline && (
                <div className="sch-progress-planned" style={{ width: `${Math.min(100, plannedPct)}%` }} title={`계획 ${plannedPct}%`} />
              )}
              <div className={`sch-progress-actual${summary.is_behind ? " behind" : ""}`} style={{ width: `${Math.min(100, summary.overall_percent)}%` }} title={`실제 ${summary.overall_percent}%`} />
            </div>
            <div className="sch-progress-legend">
              <span><i className="dot planned" /> 계획 {hasBaseline ? `${plannedPct}%` : "N/A"}</span>
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
        );
      })()}
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
