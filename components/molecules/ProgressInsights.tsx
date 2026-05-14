"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import type { CategoryId } from "../../stores/docStore";
import { DOC_CATEGORIES, resolveItemCategory } from "../../lib/docCategories";

/** ProgressDashboard와 공유하는 이력 행 최소 필드 */
export interface ProgressInsightItem {
  created_at: string;
  doc_type: string;
  doc_category: string | null;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function dayKeyLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

const WEEK_LABELS = ["일", "월", "화", "수", "목", "금", "토"] as const;

const BAR_TONE: Record<CategoryId, string> = {
  design: "progress-bar--design",
  process: "progress-bar--process",
  construction: "progress-bar--construction",
  quality: "progress-bar--quality",
  safety: "progress-bar--safety",
};

interface ProgressInsightsProps {
  items: ProgressInsightItem[];
  itemsInCategory: ProgressInsightItem[];
  activeCat: CategoryId;
  filterDayKey: string | null;
  onFilterDayKey: (key: string | null) => void;
}

export function ProgressInsights({
  items,
  itemsInCategory,
  activeCat,
  filterDayKey,
  onFilterDayKey,
}: ProgressInsightsProps) {
  const [viewMonth, setViewMonth] = useState(() => {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), 1);
  });

  const y = viewMonth.getFullYear();
  const mo = viewMonth.getMonth();
  const dim = new Date(y, mo + 1, 0).getDate();
  const firstWeekday = new Date(y, mo, 1).getDay();

  const countsByDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of itemsInCategory) {
      const k = dayKeyLocal(it.created_at);
      if (!k) continue;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [itemsInCategory]);

  const categoryBars = useMemo(() => {
    const rows = DOC_CATEGORIES.map((c) => ({
      id: c.id,
      label: c.label,
      icon: c.icon,
      count: items.filter((it) => resolveItemCategory(it.doc_type, it.doc_category) === c.id).length,
    }));
    const max = Math.max(1, ...rows.map((r) => r.count));
    return { rows, max };
  }, [items]);

  const today = new Date();
  const todayKey = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  function shiftMonth(delta: number) {
    setViewMonth(new Date(y, mo + delta, 1));
  }

  function dayKeyFor(d: number) {
    return `${y}-${pad2(mo + 1)}-${pad2(d)}`;
  }

  return (
    <div className="progress-insights">
      <div className="progress-insights-calendar">
        <div className="progress-cal-head">
          <span className="progress-cal-title">생성 일자</span>
          <span className="progress-cal-sub">선택한 관리 구역 기준</span>
        </div>
        <div className="progress-cal-nav">
          <button type="button" className="progress-cal-nav-btn" onClick={() => shiftMonth(-1)} aria-label="이전 달">
            <ChevronLeft size={18} strokeWidth={2} />
          </button>
          <span className="progress-cal-month">
            {y}년 {mo + 1}월
          </span>
          <button type="button" className="progress-cal-nav-btn" onClick={() => shiftMonth(1)} aria-label="다음 달">
            <ChevronRight size={18} strokeWidth={2} />
          </button>
        </div>
        {filterDayKey ? (
          <div className="progress-cal-filter-chip">
            <span>{filterDayKey} 생성분만 이력에 표시 중</span>
            <button type="button" onClick={() => onFilterDayKey(null)}>
              전체 날짜
            </button>
          </div>
        ) : null}
        <div className="progress-cal-weekdays">
          {WEEK_LABELS.map((w) => (
            <span key={w} className="progress-cal-wd">
              {w}
            </span>
          ))}
        </div>
        <div className="progress-cal-grid">
          {cells.map((d, idx) => {
            if (d == null) {
              return <div key={`e-${idx}`} className="progress-cal-cell progress-cal-cell--empty" />;
            }
            const key = dayKeyFor(d);
            const n = countsByDay.get(key) ?? 0;
            const isSel = filterDayKey === key;
            const isToday = key === todayKey;
            return (
              <button
                key={key}
                type="button"
                className={`progress-cal-cell${n > 0 ? " has-docs" : ""}${isSel ? " is-selected" : ""}${
                  isToday ? " is-today" : ""
                }`}
                onClick={() => {
                  if (n === 0 && !isSel) return;
                  onFilterDayKey(isSel ? null : key);
                }}
                disabled={n === 0 && !isSel}
                title={n > 0 ? `${n}건` : "문서 없음"}
              >
                <span className="progress-cal-daynum">{d}</span>
                {n > 0 ? <span className="progress-cal-dot">{n > 9 ? "9+" : n}</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="progress-insights-chart">
        <div className="progress-chart-head">
          <span className="progress-chart-title">관리 구분별 누적</span>
          <span className="progress-chart-sub">전체 이력 기준 · 총 {items.length}건</span>
        </div>
        <ul className="progress-chart-list" aria-label="관리 구분별 문서 건수">
          {categoryBars.rows.map((row) => {
            const pct = (row.count / categoryBars.max) * 100;
            const active = row.id === activeCat;
            return (
              <li key={row.id} className={`progress-chart-row${active ? " is-active-cat" : ""}`}>
                <div className="progress-chart-label">
                  <span className="progress-chart-icon" aria-hidden>
                    {row.icon}
                  </span>
                  <span className="progress-chart-name">{row.label}</span>
                  <span className="progress-chart-count">{row.count}</span>
                </div>
                <div className="progress-chart-track" role="presentation">
                  <div
                    className={`progress-chart-bar ${BAR_TONE[row.id]}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
