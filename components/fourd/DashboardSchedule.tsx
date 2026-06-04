"use client";

/**
 * 대시보드 하단 공정표 — 기존 공정표 조회와 동일한 frappe-gantt 스타일로 표시.
 *
 * 4D 뷰어는 공정표를 클라이언트에서 ScheduleTask[] 로 파싱하므로, 이를 GanttTask[] 로
 * 변환해 GanttChart(포크 frappe-gantt)에 그대로 넘긴다. (이전 '공정표 보던 스타일' 재사용)
 */
import { type FC, useEffect, useMemo, useState } from "react";

import { type GanttTask } from "../../lib/api/schedule";
import { type ScheduleTask } from "../../lib/fourd/match";
import GanttChartRaw from "../process/GanttChart";

const GanttChart = GanttChartRaw as unknown as FC<{
  tasks: GanttTask[];
  height?: number;
  viewMode?: string;
  focusId?: string | null;
  markerDate?: string | null;
}>;

/** 포크 frappe-gantt(umd) + css 1회 로드. GanttView 와 동일 자산 — 회귀 회피 위해 독립 복제. */
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

/** ISO/날짜 문자열 → "YYYY-MM-DD" (frappe-gantt 파서 호환). */
const date10 = (s?: string | null): string | undefined => (s ? String(s).slice(0, 10) : undefined);

/** ScheduleTask[] → GanttTask[]. 선행(활동명)은 유일할 때만 코드로 매핑해 화살표 연결. */
function toGanttTasks(tasks: ScheduleTask[]): GanttTask[] {
  const nameToCode = new Map<string, string>();
  const dupNames = new Set<string>();
  for (const t of tasks) {
    if (!t.name) continue;
    if (nameToCode.has(t.name)) dupNames.add(t.name);
    else nameToCode.set(t.name, t.code);
  }
  return tasks
    .filter((t) => t.start && t.end) // 날짜 없는 활동은 간트에 못 그림
    .map((t) => {
      const deps = (t.preds ?? [])
        .map((n) => (dupNames.has(n) ? undefined : nameToCode.get(n)))
        .filter((c): c is string => !!c && c !== t.code);
      // progress: 0~1 비율이면 %로, 이미 0~100이면 그대로.
      const raw = t.progress ?? 0;
      const progress = raw <= 1 ? Math.round(raw * 100) : Math.round(raw);
      return {
        id: t.code,
        activity_code: t.code,
        name: t.name ?? t.code,
        wbs_code: "",
        start: date10(t.start),
        end: date10(t.end),
        progress,
        is_cp: false,
        total_float_hr_cnt: null,
        status: "",
        dependencies: deps,
      } satisfies GanttTask;
    });
}

/** dateMs(epoch) → "YYYY-MM-DD" 로컬 (간트 마커용). */
const msToDate10 = (ms?: number): string | null => {
  if (ms == null) return null;
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function DashboardSchedule({
  tasks,
  markerDate,
}: {
  tasks: ScheduleTask[];
  markerDate?: number; // 4D 슬라이더 날짜(epoch ms) — 간트에 세로선으로 표시
}) {
  // 기본 '주' 뷰 — 다개월 공정표는 월 뷰면 컬럼이 폭을 못 채워 오른쪽이 비고 가로 스크롤이 사라진다.
  // 주 뷰는 폭을 채우면서 가로 스크롤도 생긴다(밀도·가독성 ↑).
  const [viewMode, setViewMode] = useState<ViewMode>("Week");
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    loadFrappeGantt().then(() => setReady(true)).catch((e) => setErr(String(e)));
  }, []);

  const ganttTasks = useMemo(() => toGanttTasks(tasks), [tasks]);
  const marker = msToDate10(markerDate);
  // 높이는 고정(460) — 너무 키우면 하단 가로 스크롤바가 화면 밖으로 밀려 불편.
  const ganttHeight = 460;

  return (
    <div className="ws-inner-pad" style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#334155" }}>
          공정표 ({ganttTasks.length}개 활동)
        </div>
        <div className="sch-viewmode">
          {VIEW_MODES.map((vm) => (
            <button
              key={vm}
              type="button"
              className={`sch-vm-btn${viewMode === vm ? " active" : ""}`}
              onClick={() => setViewMode(vm)}
            >
              {VIEW_LABEL[vm]}
            </button>
          ))}
        </div>
      </div>

      {err && <div className="sch-error">{err}</div>}
      {!ready && !err && <div className="sch-hint">간트 엔진 로딩 중…</div>}
      {ready && ganttTasks.length === 0 && (
        <div className="sch-hint">날짜가 있는 공정 활동이 없습니다.</div>
      )}
      {ready && ganttTasks.length > 0 && (
        <GanttChart tasks={ganttTasks} height={ganttHeight} viewMode={viewMode} markerDate={marker} />
      )}
    </div>
  );
}
