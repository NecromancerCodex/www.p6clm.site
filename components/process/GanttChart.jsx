"use client";

import React, { useEffect, useRef, useState } from "react";

const SVG_NS = "http://www.w3.org/2000/svg";
const BL_HEIGHT = 4;
const BL_RADIUS = 2;
const TASK_INFO_WIDTH = 320;

// 비교 차선 색상 — Construction.jsx 와 동일 팔레트.
// 0=메인 바에 가장 가까움 (보통 가장 최근 비교/실적), 마지막=베이스라인.
const COMPARE_COLORS = [
  "#c9a35c", // purple
  "#8f8a7c", // teal
  "#97917f", // gray
  "#b3383e", // orange (legacy baseline)
];
const colorForLane = (idx) => COMPARE_COLORS[idx % COMPARE_COLORS.length];

// total_float_hr_cnt <= 0 이거나 is_cp=true 면 critical 활동.
// 메인 Construction.jsx 의 cpThresholdHr 기본값(=0) 과 동일 정책.
const isCriticalTask = (task) => {
  if (!task) return false;
  if (task.is_cp === true) return true;
  const tf = Number(task.total_float_hr_cnt);
  return Number.isFinite(tf) && tf <= 0;
};

// 화살표 분류:
//   - cp:    from/to 둘 다 critical → 빨강 굵게
//   - pred:  to == focus → 보라 (focus 의 선행)
//   - succ:  from == focus → 청록 (focus 의 후행)
//   - other: 나머지 → 회색 흐리게
// hover 강조는 별도 클래스 (.rel-hover / .rel-faded) 로 위 분류 위에 덮어씀.
const classifyArrow = ({ fromTask, toTask, fromId, toId, focusKey }) => {
  if (isCriticalTask(fromTask) && isCriticalTask(toTask)) return "rel-cp";
  if (focusKey && toId === focusKey) return "rel-pred";
  if (focusKey && fromId === focusKey) return "rel-succ";
  return "rel-other";
};

// 화살표 중간에 lag 라벨 (e.g. "+5d", "-2d") 을 SVG text 로 부착.
// from bar 우측과 to bar 좌측의 중점 위에 작은 배경 box + text.
const drawLagLabel = (gantt, layer, arrow, lagDays) => {
  if (!Number.isFinite(lagDays) || lagDays === 0) return;
  const fromBar = arrow.from_task?.$bar;
  const toBar = arrow.to_task?.$bar;
  if (!fromBar || !toBar) return;

  const fromX = fromBar.getX() + fromBar.getWidth();
  const toX = toBar.getX();
  const midX = (fromX + toX) / 2;
  const fromY = fromBar.getY() + fromBar.getHeight() / 2;
  const toY = toBar.getY() + toBar.getHeight() / 2;
  const midY = (fromY + toY) / 2;

  const text = `${lagDays > 0 ? "+" : ""}${lagDays}d`;
  const padX = 3;
  const w = text.length * 5.5 + padX * 2;
  const h = 11;

  const bg = document.createElementNS(SVG_NS, "rect");
  bg.setAttribute("x", String(midX - w / 2));
  bg.setAttribute("y", String(midY - h / 2));
  bg.setAttribute("width", String(w));
  bg.setAttribute("height", String(h));
  bg.setAttribute("rx", "2");
  bg.setAttribute("ry", "2");
  bg.setAttribute("fill", "#1a1a1f");
  bg.setAttribute("stroke", "#3a3a42");
  bg.setAttribute("stroke-width", "0.5");
  bg.setAttribute("class", "rel-lag-bg");
  layer.appendChild(bg);

  const t = document.createElementNS(SVG_NS, "text");
  t.setAttribute("x", String(midX));
  t.setAttribute("y", String(midY));
  t.setAttribute("text-anchor", "middle");
  t.setAttribute("dominant-baseline", "central");
  t.setAttribute("font-size", "9");
  t.setAttribute("font-weight", "600");
  t.setAttribute("fill", lagDays > 0 ? "#c0463f" : "#c9a35c");
  t.setAttribute("class", "rel-lag-text");
  t.textContent = text;
  layer.appendChild(t);
};

// 화살표 스타일링 + hover 핸들러 + lag 라벨 모두 적용.
const decorateArrows = (gantt, tasks, focusId) => {
  if (!gantt?.arrows?.length) return;

  const taskMap = new Map(tasks.map((t) => [String(t.id), t]));
  const focusKey = focusId != null ? String(focusId) : null;

  // 기존 lag 라벨 제거 후 다시 그릴 레이어 준비
  gantt.layers?.arrow?.querySelectorAll(".rel-lag-bg, .rel-lag-text")
    .forEach((el) => el.remove());

  gantt.arrows.forEach((arrow) => {
    const el = arrow.element;
    if (!el) return;
    const fromId = String(arrow.from_task?.task?.id ?? "");
    const toId = String(arrow.to_task?.task?.id ?? "");
    const fromTask = taskMap.get(fromId);
    const toTask = taskMap.get(toId);

    el.classList.remove("rel-cp", "rel-pred", "rel-succ", "rel-other", "rel-hover", "rel-faded");
    el.classList.add(classifyArrow({ fromTask, toTask, fromId, toId, focusKey }));

    // lag 값은 from_task 의 dependencies 에서 to_task.id 매칭으로 조회.
    const dep = (fromTask?.dependencies || []).find((d) => String(d.id) === toId);
    const lag = Number(dep?.lag);
    if (Number.isFinite(lag) && lag !== 0 && gantt.layers?.arrow) {
      drawLagLabel(gantt, gantt.layers.arrow, arrow, lag);
    }
  });

};

// bar hover 델리게이션 — gantt 컨테이너 한 곳에서 listen 후 .bar-wrapper 매칭.
// 직접 bar.group 에 붙이는 방식은 라이브러리가 mouseenter 핸들러를 덮어쓰거나
// SVG layer 순서로 이벤트가 다른 요소에 가로채일 때 안 먹음.
// hover 한 활동의 (a) 연결된 화살표 강조 + 나머지 fade
//                   (b) 연결된 다른 활동 막대는 그대로, 나머지 막대는 dim.
// 호버한 활동 + 선행/후행만 또렷, 나머지는 흐림.
// CSS 우선순위 / SVG 클래스 적용 이슈 회피 위해 inline style 사용.
const setHighlight = (svg, taskId) => {
  if (!svg) return;
  // ⚠ frappe-gantt 의 화살표 path 는 class 가 없음 (<g class="arrow"> 만 있음).
  //    path.arrow 셀렉터는 0 매치 → data-from 속성으로 잡아야 함.
  const arrowEls = svg.querySelectorAll("path[data-from]");
  const barWrappers = svg.querySelectorAll(".bar-wrapper");

  const clearInline = () => {
    arrowEls.forEach((a) => {
      a.style.opacity = "";
      a.style.stroke = "";
      a.style.strokeWidth = "";
    });
    barWrappers.forEach((w) => {
      w.style.opacity = "";
      const bar = w.querySelector(".bar");
      if (bar) {
        bar.style.stroke = "";
        bar.style.strokeWidth = "";
      }
    });
  };
  clearInline();
  if (taskId == null) return;

  const key = String(taskId);
  const connectedIds = new Set([key]);
  arrowEls.forEach((a) => {
    const fromId = a.getAttribute("data-from") || "";
    const toId = a.getAttribute("data-to") || "";
    if (fromId === key) connectedIds.add(toId);
    if (toId === key) connectedIds.add(fromId);
  });

  arrowEls.forEach((a) => {
    const fromId = a.getAttribute("data-from") || "";
    const toId = a.getAttribute("data-to") || "";
    const connected = fromId === key || toId === key;
    if (connected) {
      a.style.opacity = "1";
      a.style.stroke = "#e9e5dc";
      a.style.strokeWidth = "2";
    } else {
      a.style.opacity = "0.12";
      a.style.stroke = "#3a3a42";
      a.style.strokeWidth = "0.8";
    }
  });

  barWrappers.forEach((wrapper) => {
    const id = wrapper.getAttribute("data-id") || "";
    if (connectedIds.has(id)) {
      if (id === key) {
        const bar = wrapper.querySelector(".bar");
        if (bar) {
          bar.style.stroke = "#e9e5dc";
          bar.style.strokeWidth = "1.5";
        }
      }
    } else {
      wrapper.style.opacity = "0.18";
    }
  });
};

const wireHoverDelegation = (gantt, rootEl) => {
  if (!rootEl) return undefined;
  const svg = gantt?.$svg;
  if (!svg) return undefined;

  // mousemove + rAF — 매 프레임 마우스 아래 wrapper 확인. mouseover/mouseout 의
  // race 및 미발사 케이스 회피.
  let currentTaskId = null;
  let rafToken = null;
  let lastTarget = null;

  const tick = () => {
    rafToken = null;
    const wrapper = lastTarget?.closest?.(".bar-wrapper");
    const newId = wrapper?.getAttribute("data-id") || null;
    if (newId !== currentTaskId) {
      setHighlight(svg, newId);
      currentTaskId = newId;
    }
  };

  const onMouseMove = (e) => {
    lastTarget = e.target;
    if (rafToken) return;
    rafToken = requestAnimationFrame(tick);
  };

  const onMouseLeave = () => {
    if (rafToken) {
      cancelAnimationFrame(rafToken);
      rafToken = null;
    }
    if (currentTaskId) {
      setHighlight(svg, null);
      currentTaskId = null;
    }
  };

  rootEl.addEventListener("mousemove", onMouseMove);
  rootEl.addEventListener("mouseleave", onMouseLeave);

  return () => {
    if (rafToken) cancelAnimationFrame(rafToken);
    rootEl.removeEventListener("mousemove", onMouseMove);
    rootEl.removeEventListener("mouseleave", onMouseLeave);
  };
};

const parseLocalDate = (dateStr) => {
  if (!dateStr) return null;
  const parts = String(dateStr).split("T")[0].split("-").map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
};

const cDiff = (d1, d2, unit) => {
  const tzCorrection = (d2.getTimezoneOffset() - d1.getTimezoneOffset()) * 60000;
  const diffMs = (d1 - d2) + tzCorrection;
  const diffDays = diffMs / 86400000;
  if (unit === "day") return Math.round(diffDays * 100) / 100;
  if (unit === "month" || unit === "year") {
    const monthPos = (d) =>
      d.getFullYear() * 12 +
      d.getMonth() +
      (d.getDate() - 1) / new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const m = monthPos(d1) - monthPos(d2);
    if (unit === "year") return Math.round((m / 12) * 100) / 100;
    return Math.round(m * 100) / 100;
  }
  return Math.round(diffDays * 100) / 100;
};

// 메인 Construction 페이지의 drawCompareBars 와 동일 로직:
//   - 다중 비교 차선 stacking (메인 바 아래 → row 바닥)
//   - 메인 바 자동 축소로 차선 공간 확보
//   - 마일스톤 다이아몬드 시프트/축소
//   - 마일스톤 row 차선은 점 모양
// 미니 간트는 task.compares 가 없으면 baseline_*_date 로 합성한다.
const drawBaselineBars = (gantt, data) => {
  if (!gantt?.$svg || !Array.isArray(gantt.rows)) return;
  gantt.$svg.querySelector(".baseline-layer")?.remove();

  const layer = document.createElementNS(SVG_NS, "g");
  layer.setAttribute("class", "baseline-layer");
  const barLayer = gantt.layers?.bar;
  if (barLayer) gantt.$svg.insertBefore(layer, barLayer);
  else gantt.$svg.appendChild(layer);

  const taskMap = new Map(data.map((t) => [String(t.id), t]));
  const { config } = gantt;
  const { column_width: colW, step, unit, header_height: headerH } = config;

  gantt.rows.forEach((row, idx) => {
    if (row.type !== "task" && row.type !== "milestone") return;
    const taskId = String(row.task?.id || "");
    if (!taskId) return;
    const task = taskMap.get(taskId);
    if (!task) return;

    const barObj = typeof gantt.get_bar === "function" ? gantt.get_bar(taskId) : null;

    // 메인 바 원본 높이 백업/복원 — 매번 원본에서 다시 계산.
    if (barObj?.$bar) {
      const $bar = barObj.$bar;
      if (!$bar.getAttribute("data-orig-h")) {
        $bar.setAttribute("data-orig-h", $bar.getAttribute("height"));
      }
      $bar.setAttribute("height", $bar.getAttribute("data-orig-h"));
      const $prog = barObj.$bar_progress;
      if ($prog) {
        if (!$prog.getAttribute("data-orig-h")) {
          $prog.setAttribute("data-orig-h", $prog.getAttribute("height"));
        }
        $prog.setAttribute("height", $prog.getAttribute("data-orig-h"));
      }
    }

    // 마일스톤 다이아몬드 원본 모양 복원.
    if (row.type === "milestone" && barObj?.group) {
      const polygon = barObj.group.querySelector("polygon");
      const cxA = polygon?.getAttribute("data-cx");
      const cyA = polygon?.getAttribute("data-cy");
      const rA = polygon?.getAttribute("data-r");
      if (polygon && cxA && cyA && rA) {
        const cx = +cxA, cy = +cyA, r = +rA;
        polygon.setAttribute(
          "points",
          `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`,
        );
      }
    }

    // 차선 수집: task.compares 우선, 없으면 baseline_*_date 합성.
    const lanes = [];
    if (Array.isArray(task.compares) && task.compares.length) {
      task.compares.forEach((c, origIdx) => {
        if (!c.start || !c.finish) return;
        lanes.push({ start: c.start, finish: c.finish, origIdx });
      });
    } else if (task.baseline_start_date && task.baseline_finish_date) {
      // legacy 단일 베이스라인 — 마지막 색(orange) 사용.
      lanes.push({
        start: task.baseline_start_date,
        finish: task.baseline_finish_date,
        origIdx: COMPARE_COLORS.length - 1,
      });
    }
    if (!lanes.length) return;

    if (!barObj) return;
    const actualBarX = barObj.getBarX();
    const actualTaskStart = barObj.task?._start;
    if (!actualTaskStart) return;

    const rowTop = gantt.get_row_top ? gantt.get_row_top(idx) : 0;
    const rowH = gantt.get_row_height_at ? gantt.get_row_height_at(idx) : 35;
    const rowBottom = headerH + rowTop + rowH;
    const N = lanes.length;

    // 메인 바가 차선 공간을 침범하면 height 축소.
    if (barObj.$bar) {
      const $bar = barObj.$bar;
      const barY = parseFloat($bar.getAttribute("y"));
      const origH = parseFloat($bar.getAttribute("data-orig-h"));
      const stackH = N * BL_HEIGHT + Math.max(0, N - 1);
      const maxBottom = rowBottom - 1 - stackH - 1;
      const newH = Math.max(6, Math.min(origH, maxBottom - barY));
      if (newH < origH) {
        $bar.setAttribute("height", String(newH));
        if (barObj.$bar_progress) {
          barObj.$bar_progress.setAttribute("height", String(newH));
        }
      }
    }

    // 마일스톤 다이아몬드 시프트/축소.
    if (row.type === "milestone" && barObj?.group) {
      const polygon = barObj.group.querySelector("polygon");
      const cxA = polygon?.getAttribute("data-cx");
      const cyA = polygon?.getAttribute("data-cy");
      const rA = polygon?.getAttribute("data-r");
      if (polygon && cxA && cyA && rA) {
        const cx = +cxA, origCy = +cyA, origR = +rA;
        const stackH = N * BL_HEIGHT + Math.max(0, N - 1);
        const maxBottom = rowBottom - 1 - stackH - 1;
        if (origCy + origR > maxBottom) {
          const topY = origCy - origR;
          const newR = Math.max(3, (maxBottom - topY) / 2);
          const newCy = topY + newR;
          polygon.setAttribute(
            "points",
            `${cx},${newCy - newR} ${cx + newR},${newCy} ${cx},${newCy + newR} ${cx - newR},${newCy}`,
          );
        }
      }
    }

    const isMilestoneRow = row.type === "milestone";
    const mainPolygon = barObj?.group?.querySelector?.("polygon");
    const mainCxAttr = mainPolygon?.getAttribute?.("data-cx");
    const mainDiamondCx =
      mainCxAttr != null && mainCxAttr !== ""
        ? parseFloat(mainCxAttr)
        : actualBarX;

    lanes.forEach((lane, i) => {
      const blStart = parseLocalDate(lane.start);
      if (!blStart) return;
      const blFinishPlusOne = parseLocalDate(lane.finish);
      if (!blFinishPlusOne) return;
      blFinishPlusOne.setDate(blFinishPlusOne.getDate() + 1);

      const startOffsetPx = (cDiff(blStart, actualTaskStart, unit) / step) * colW;
      const blWidthPx = (cDiff(blFinishPlusOne, blStart, unit) / step) * colW;
      const x1 = actualBarX + startOffsetPx;
      const width = Math.max(blWidthPx, 3);
      const y = rowBottom - 1 - BL_HEIGHT - (N - 1 - i) * (BL_HEIGHT + 1);
      const fill = colorForLane(lane.origIdx);

      // 마일스톤 row 차선은 점.
      if (isMilestoneRow) {
        const dotSize = BL_HEIGHT;
        const dotCx = mainDiamondCx + startOffsetPx;
        const dot = document.createElementNS(SVG_NS, "rect");
        dot.setAttribute("x", String(dotCx - dotSize / 2));
        dot.setAttribute("y", String(y));
        dot.setAttribute("width", String(dotSize));
        dot.setAttribute("height", String(dotSize));
        dot.setAttribute("rx", String(dotSize / 2));
        dot.setAttribute("ry", String(dotSize / 2));
        dot.setAttribute("fill", fill);
        dot.setAttribute("opacity", "0.85");
        dot.setAttribute("class", "baseline-bar baseline-milestone-dot");
        layer.appendChild(dot);
        return;
      }

      const rect = document.createElementNS(SVG_NS, "rect");
      rect.setAttribute("x", String(x1));
      rect.setAttribute("y", String(y));
      rect.setAttribute("width", String(width));
      rect.setAttribute("height", String(BL_HEIGHT));
      rect.setAttribute("rx", String(BL_RADIUS));
      rect.setAttribute("ry", String(BL_RADIUS));
      rect.setAttribute("fill", fill);
      rect.setAttribute("opacity", "0.85");
      rect.setAttribute("class", "baseline-bar");
      layer.appendChild(rect);
    });
  });
};

const realignTodayMarker = (gantt) => {
  if (!gantt?.$container || !Array.isArray(gantt.dates) || gantt.dates.length < 2) return;

  const marker =
    gantt.$current_highlight || gantt.$container.querySelector(".current-highlight");
  if (!marker) return;

  const now = new Date();
  const dates = gantt.dates;
  const columnWidth = Number(gantt.config?.column_width) || 45;
  const marginLeft = Number.parseFloat(gantt.$svg?.style?.marginLeft || "0") || 0;

  let index = -1;
  for (let i = 0; i < dates.length - 1; i += 1) {
    if (now >= dates[i] && now < dates[i + 1]) {
      index = i;
      break;
    }
  }
  if (index < 0) {
    if (now < dates[0]) index = 0;
    else index = Math.max(0, dates.length - 2);
  }

  const start = dates[index];
  const end = dates[index + 1];
  const duration = end - start;
  const rawProgress = duration > 0 ? (now - start) / duration : 0;
  const progress = Math.max(0, Math.min(1, rawProgress));
  const leftPx = marginLeft + (index + progress) * columnWidth;

  marker.style.left = `${leftPx}px`;
  gantt.$current_highlight = marker;
};

// 외부 타임라인(예: 4D 슬라이더) 날짜를 가리키는 세로선을 SVG 내부에 그린다.
// realignTodayMarker 와 동일한 날짜→x 공식. SVG 내부 좌표라 marginLeft 는 제외
// ((index+progress)*columnWidth). 막대 위에 그려지도록 SVG 마지막 자식으로 append.
const SLIDER_MARKER_CLASS = "clm-slider-marker";
const drawSliderMarker = (gantt, date) => {
  const svg = gantt?.$svg;
  if (!svg) return;
  svg.querySelector(`.${SLIDER_MARKER_CLASS}`)?.remove();
  if (date == null) return;
  const target = date instanceof Date ? date : parseLocalDate(String(date).slice(0, 10));
  const dates = gantt.dates;
  if (!target || !Array.isArray(dates) || dates.length < 2) return;

  const columnWidth = Number(gantt.config?.column_width) || 45;
  let index = -1;
  for (let i = 0; i < dates.length - 1; i += 1) {
    if (target >= dates[i] && target < dates[i + 1]) { index = i; break; }
  }
  if (index < 0) index = target < dates[0] ? 0 : dates.length - 2;
  const span = dates[index + 1] - dates[index];
  const progress = span > 0 ? Math.max(0, Math.min(1, (target - dates[index]) / span)) : 0;
  const x = (index + progress) * columnWidth;
  const h = parseFloat(svg.getAttribute("height")) || svg.getBoundingClientRect().height || 0;

  const line = document.createElementNS(SVG_NS, "line");
  line.setAttribute("x1", String(x));
  line.setAttribute("x2", String(x));
  line.setAttribute("y1", "0");
  line.setAttribute("y2", String(h));
  line.setAttribute("class", SLIDER_MARKER_CLASS);
  line.setAttribute("stroke", "#c9a35c");
  line.setAttribute("stroke-width", "2");
  line.setAttribute("stroke-dasharray", "4 3");
  line.setAttribute("pointer-events", "none");
  svg.appendChild(line);
};

const applyTaskInfoWidthToGantt = (gantt, taskInfoWidth = TASK_INFO_WIDTH, codeColWidth = 98) => {
  if (!gantt) return;

  const widthPx = `${taskInfoWidth}px`;

  if (gantt.$svg) {
    gantt.$svg.style.marginLeft = widthPx;
    gantt.$svg.style.overflow = "hidden";
    gantt.$svg.setAttribute("overflow", "hidden");
    gantt.$svg.style.minWidth = `calc(100% - ${widthPx})`;
  }
  if (gantt.$header) {
    gantt.$header.style.marginLeft = widthPx;
    gantt.$header.style.left = widthPx;
    gantt.$header.style.minWidth = `calc(100% - ${widthPx})`;
  }
  if (gantt.$task_info_grid) {
    gantt.$task_info_grid.style.width = widthPx;
    gantt.$task_info_grid.style.position = "sticky";
    gantt.$task_info_grid.style.left = "0";
    gantt.$task_info_grid.style.zIndex = "2000";
    gantt.$task_info_grid.style.backgroundColor = "#1a1a1f";
  }
  if (gantt.$task_info_svg) {
    gantt.$task_info_svg.setAttribute("width", String(taskInfoWidth));
    gantt.$task_info_svg.setAttribute("overflow", "hidden");
    gantt.$task_info_svg.style.width = widthPx;
    gantt.$task_info_svg.style.overflow = "hidden";
    const cr = gantt.$task_info_svg.querySelector("#sidebar-name-clip rect");
    if (cr) {
      cr.setAttribute("x", String(codeColWidth + 1));
      cr.setAttribute("width", String(Math.max(1, taskInfoWidth - codeColWidth - 1)));
    }
  }

  const sidebarRects = gantt.$task_info_svg?.querySelectorAll(".sidebar-row rect") || [];
  sidebarRects.forEach((rect) => rect.setAttribute("width", String(taskInfoWidth)));

  if (gantt.$current_highlight?.remove) gantt.$current_highlight.remove();
  if (typeof gantt.highlight_current === "function") gantt.highlight_current();
  realignTodayMarker(gantt);
};

export default function GanttChart({ tasks = [], height = 400, viewMode = "Month", focusId = null, markerDate = null, fillWidth = false }) {
  const ganttRef = useRef(null);
  const ganttInstanceRef = useRef(null);
  const markerDateRef = useRef(markerDate);
  markerDateRef.current = markerDate;
  const customScrollbarRef = useRef(null);
  const customScrollbarInnerRef = useRef(null);
  const [ganttHeaderHeight, setGanttHeaderHeight] = useState(56);

  const codeColWidth = tasks.length
    ? Math.min(200, Math.max(98, Math.max(...tasks.map((t) => (t.activity_code || t.id || "").length)) * 6 + 8))
    : 98;

  const nameColWidth = tasks.length
    ? Math.min(
        600,
        Math.max(
          262,
          Math.max(
            ...tasks.map((t) => {
              const depth = String(t.wbs_code || "").split(".").length - 1;
              return (t.name || "").length * 8 + depth * 12;
            })
          )
        )
      )
    : 262;

  const taskInfoWidth = codeColWidth + nameColWidth;

  useEffect(() => {
    if (!tasks || tasks.length === 0) return;

    ganttRef.current.innerHTML = "";

    // 사이드바 미니뷰: 컨트롤 없는 read-only 미리보기.
    // 행/바/헤더 높이는 메인 Construction 페이지와 동일한 컴팩트 톤으로 정렬.
    // scroll_to: focusId 가 있으면 그 활동의 시작일로, 없으면 데이터 시작.
    const focusTask = focusId
      ? tasks.find((tt) => String(tt.id || tt.activity_code) === String(focusId))
      : null;
    // 첫 활동 날짜로 스크롤 — "start"(여백 포함 gantt_start)면 첫 활동 앞 빈 기간(~2주 패딩)이 보임.
    const earliest = tasks.map((t) => t.start).filter(Boolean).map((d) => String(d).slice(0, 10)).sort()[0];
    const scrollTarget = focusTask?.start
      ? String(focusTask.start).slice(0, 10)
      : (earliest || "start");

    // fillWidth: 타임라인이 가용 폭을 정확히 채우도록 컬럼 폭 산정(빈 공간 0).
    //   컬럼 수가 적으면 늘려서 꽉 채우고, 많으면 최소 가독폭 유지(내용>폭 → 가로 스크롤).
    let fillColWidth;
    if (fillWidth) {
      const avail = Math.max(0, (ganttRef.current.clientWidth || 0) - taskInfoWidth);
      const times = tasks
        .flatMap((t) => [t.start, t.end])
        .filter(Boolean)
        .map((d) => new Date(String(d).slice(0, 10)).getTime())
        .filter((n) => Number.isFinite(n));
      if (avail > 0 && times.length) {
        const spanDays = Math.max(1, (Math.max(...times) - Math.min(...times)) / 86400000);
        const unitDays = viewMode === "Day" ? 1 : viewMode === "Week" ? 7 : 30;
        const cols = Math.max(1, Math.ceil(spanDays / unitDays) + 1); // +1 헤더 패딩
        const minW = viewMode === "Day" ? 28 : viewMode === "Week" ? 56 : 80;
        fillColWidth = Math.max(minW, Math.floor(avail / cols));
      }
    }

    const gantt = new window.Gantt(ganttRef.current, tasks, {
      view_mode: viewMode,
      ...(fillColWidth ? { column_width: fillColWidth } : {}),
      wbs_row_height: 22,
      activity_row_height: 26,
      bar_height: 16,
      padding: 8,
      upper_header_height: 26,
      lower_header_height: 20,
      readonly: true,
      view_mode_select: false,
      today_button: false,
      arrow_toggle_checkbox: false,
      cp_toggle_checkbox: false,
      show_arrows: true,
      activityview: true,
      scroll_to: scrollTarget,
      container_height: height,
      code_col_width: codeColWidth,
      milestone_colors: { start: "#c9a35c", finish: "#a8843f" },
      status_border_colors: { DELAY: "#c0463f", DONE: "#7da077", EARLY: "#c9a35c" },
      popup_on: "hover",
      popup: ({ task }) => `
        <div class="title">${task.name}</div>
        <div class="details">${"코드"}: ${task.activity_code || task.id}</div>
        <div class="actions">${"기간"}: ${task._start?.toLocaleDateString?.() ?? "-"} ~ ${task._end?.toLocaleDateString?.() ?? "-"}</div>
        <div class="actions">${"진척"}: ${task.progress}%</div>
      `,
    });

    ganttInstanceRef.current = gantt;

    applyTaskInfoWidthToGantt(gantt, taskInfoWidth, codeColWidth);
    drawBaselineBars(gantt, tasks);
    decorateArrows(gantt, tasks, focusId);
    // 외부 타임라인 마커(4D 슬라이더) — ref 로 읽어 재생성 deps 에서 제외(슬라이더 이동마다 재생성 방지)
    if (markerDateRef.current != null) drawSliderMarker(gantt, markerDateRef.current);
    const hoverCleanup = wireHoverDelegation(gantt, ganttRef.current);

    const hh = gantt.$header?.offsetHeight;
    if (hh && hh > 0) setGanttHeaderHeight(hh);

    // 가로 스크롤 컨테이너 — frappe-gantt 의 .gantt-container 우선.
    const scrollEl =
      ganttRef.current?.querySelector(".gantt-container") ||
      ganttRef.current?.querySelector(".scroll-container") ||
      ganttRef.current?.querySelector(".gantt-body");

    // 커스텀 스크롤바 inner 너비 = 실제 스크롤 가능한 폭. 렌더 직후엔
    // SVG 가 아직 사이즈 갱신 전이라 한 프레임 뒤에 측정.
    requestAnimationFrame(() => {
      if (scrollEl && customScrollbarInnerRef.current) {
        customScrollbarInnerRef.current.style.width = `${scrollEl.scrollWidth}px`;
      }

      // focus 활동의 막대 X 위치로 가로 스크롤
      if (focusId && scrollEl) {
        const focusBar =
          typeof gantt.get_bar === "function" ? gantt.get_bar(String(focusId)) : null;
        const barX = focusBar?.getBarX?.();
        if (Number.isFinite(barX)) {
          const centerOffset = (scrollEl.clientWidth - taskInfoWidth) / 2;
          const target = Math.max(0, barX - centerOffset);
          scrollEl.scrollLeft = target;
          if (customScrollbarRef.current) {
            customScrollbarRef.current.scrollLeft = target;
          }
        }
      }
    });

    // 컨테이너의 가로 스크롤 → 커스텀 스크롤바 동기화 (휠/터치 등 기타 입력 대응)
    let scrollCleanup;
    if (scrollEl && customScrollbarRef.current) {
      const onContainerScroll = () => {
        if (customScrollbarRef.current) {
          customScrollbarRef.current.scrollLeft = scrollEl.scrollLeft;
        }
      };
      scrollEl.addEventListener("scroll", onContainerScroll, { passive: true });
      scrollCleanup = () => scrollEl.removeEventListener("scroll", onContainerScroll);
    }

    return () => {
      hoverCleanup?.();
      scrollCleanup?.();
    };
  }, [tasks, viewMode, focusId, height, taskInfoWidth, fillWidth]);

  // 슬라이더 날짜 변경 → 세로선만 다시 그림(간트 재생성 없이).
  // 자동 스크롤은 하지 않는다 — 마커(예: 오늘)로 점프하면 그 시점에 막대 없는 행만 보여
  // 타임라인이 빈 것처럼 됨. 간트는 공정 시작점(막대 밀집)을 유지하고, 마커는 스크롤해서 확인.
  useEffect(() => {
    const gantt = ganttInstanceRef.current;
    if (gantt) drawSliderMarker(gantt, markerDate);
  }, [markerDate]);

  return (
    <div>
      {/* 범례 — 한 줄 inline */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6, fontSize: 11, color: "#97917f", userSelect: "none" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ display: "inline-block", width: 18, height: 6, background: "#c9a35c", borderRadius: 2 }} />
          {"실적"}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ display: "inline-block", width: 18, height: 3, background: "#b3383e", borderRadius: 2 }} />
          {"계획(기준선)"}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ display: "inline-block", width: 8, height: 8, background: "#c9a35c", transform: "rotate(45deg)" }} />
          {"마일스톤"}
        </span>
      </div>

      {/* 간트 영역 */}
      <div
        className="related-gantt"
        style={{ border: "1px solid #2c2c34", borderRadius: 8, background: "#1a1a1f", width: "100%", position: "relative", height: `${height}px`, overflow: "hidden" }}
      >
        <style>{`
          /* 내부 스크롤 컨테이너 */
          .related-gantt .gantt-container,
          .related-gantt .scroll-container,
          .related-gantt .gantt-body {
            overflow: auto;
            max-height: 100%;
          }

          /* 네이티브 스크롤바 전부 숨김 — 가로는 커스텀 스크롤바로 대체,
             세로는 휠 스크롤로 처리. 메인 Construction 페이지와 동일 패턴.
             (이전에 가로만 숨기려 했지만 Firefox / 일부 webkit 환경에서
             타스크-info 영역으로 스크롤바가 비쳤음) */
          .related-gantt .gantt-container,
          .related-gantt .scroll-container,
          .related-gantt .gantt-body { scrollbar-width: none; }
          .related-gantt .gantt-container::-webkit-scrollbar,
          .related-gantt .scroll-container::-webkit-scrollbar,
          .related-gantt .gantt-body::-webkit-scrollbar { display: none; }

          /* 커스텀 가로 스크롤바 thumb 톤 */
          .related-gantt .related-gantt-hscroll::-webkit-scrollbar { height: 10px; }
          .related-gantt .related-gantt-hscroll::-webkit-scrollbar-track { background: #202026; }
          .related-gantt .related-gantt-hscroll::-webkit-scrollbar-thumb {
            background: #3a3a42; border-radius: 5px;
          }
          .related-gantt .related-gantt-hscroll::-webkit-scrollbar-thumb:hover { background: #55554f; }

          /* 사이드 컨트롤 전부 숨김 — read-only 미리보기 */
          .related-gantt .side-header { display: none !important; }

          /* WBS 행 구분선만 숨김 — WBS 텍스트 깨짐 방지 */
          .related-gantt .task-info-svg .sidebar-row[data-row-type="wbs"] line {
            display: none !important;
          }

          /* 관계선 — 프리마베라풍 톤:
             기본은 가늘게(1px) + 슬레이트 회색 + 살짝 투명 + 픽셀 정렬.
             분류 클래스(rel-cp / rel-pred / rel-succ / rel-other) 로 색·굵기·투명도 덮어씀. */
          .related-gantt { --g-arrow-color: #8a8474; }
          .related-gantt .gantt path.arrow {
            fill: none;
            stroke: #8a8474;
            stroke-width: 1;
            opacity: 0.55;
            stroke-linejoin: miter;
            stroke-linecap: square;
            shape-rendering: crispEdges;
            transition: opacity 0.12s, stroke-width 0.12s, stroke 0.12s;
          }

          /* Critical Path — 두 활동 모두 critical 일 때 빨간 굵은 선 */
          .related-gantt .gantt path.arrow.rel-cp {
            stroke: #c0463f;
            stroke-width: 1.6;
            opacity: 0.85;
          }
          /* focus 의 선행 (들어오는 화살표) */
          .related-gantt .gantt path.arrow.rel-pred {
            stroke: #6366f1;
            stroke-width: 1.4;
            opacity: 0.9;
          }
          /* focus 의 후행 (나가는 화살표) */
          .related-gantt .gantt path.arrow.rel-succ {
            stroke: #8f8a7c;
            stroke-width: 1.4;
            opacity: 0.9;
          }
          /* 그 외 — 차분한 회색 */
          .related-gantt .gantt path.arrow.rel-other {
            stroke: #55554f;
            stroke-width: 1;
            opacity: 0.4;
          }

          /* hover 시 — 연결된 화살표는 진하게, 무관 화살표는 거의 투명 */
          .related-gantt .gantt path.arrow.rel-hover {
            stroke: #e9e5dc !important;
            stroke-width: 2 !important;
            opacity: 1 !important;
          }
          .related-gantt .gantt path.arrow.rel-faded {
            stroke: #3a3a42 !important;
            stroke-width: 0.8 !important;
            opacity: 0.12 !important;
          }

          /* lag 라벨 — 화살표 위에 떠 있는 작은 캡슐 */
          .related-gantt .gantt .rel-lag-bg,
          .related-gantt .gantt .rel-lag-text {
            pointer-events: none;
          }

          /* hover 한 활동에 무관한 막대는 흐리게 */
          .related-gantt .gantt .bar-wrapper {
            transition: opacity 0.12s;
          }
          .related-gantt .gantt .bar-wrapper.bar-dim {
            opacity: 0.18;
          }
          /* hover 대상 막대 자체는 살짝 강조 — outline 으로 */
          .related-gantt .gantt .bar-wrapper.bar-focus .bar {
            stroke: #e9e5dc !important;
            stroke-width: 1.5 !important;
          }
        `}</style>

        <div ref={ganttRef} style={{ width: "100%", height: "100%" }} />

        {/* ─── Zone A: 컬럼 헤더 (코드 | 공정명) ─── */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: `${taskInfoWidth}px`,
            height: `${ganttHeaderHeight}px`,
            background: "#1a1a1f",
            zIndex: 2001,
            pointerEvents: "none",
            borderRight: "1px solid #2c2c34",
            borderBottom: "1px solid #2c2c34",
            display: "flex",
            alignItems: "center",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${codeColWidth}px`,
              minWidth: `${codeColWidth}px`,
              height: "100%",
              display: "flex",
              alignItems: "center",
              paddingLeft: "8px",
              fontSize: "11px",
              fontWeight: 600,
              color: "#8a8474",
              borderRight: "1px solid #2c2c34",
              boxSizing: "border-box",
              overflow: "hidden",
              whiteSpace: "nowrap",
            }}
          >
            {"코드"}
          </div>
          <div
            style={{
              flex: 1,
              height: "100%",
              display: "flex",
              alignItems: "center",
              paddingLeft: "8px",
              fontSize: "11px",
              fontWeight: 600,
              color: "#8a8474",
              overflow: "hidden",
              whiteSpace: "nowrap",
            }}
          >
            {"공정명"}
          </div>
        </div>

        {/* ─── Zone C 세로 경계선 ─── */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: `${ganttHeaderHeight}px`,
            left: `${taskInfoWidth}px`,
            width: "1px",
            bottom: 0,
            background: "#2c2c34",
            zIndex: 2001,
            pointerEvents: "none",
          }}
        />

        {/* ─── 커스텀 가로 스크롤바 — task-info 컬럼 우측에서 시작해 영역 침범 X ─── */}
        <div
          ref={customScrollbarRef}
          className="related-gantt-hscroll"
          style={{
            position: "absolute",
            bottom: 0,
            left: `${taskInfoWidth}px`,
            right: 0,
            overflowX: "auto",
            overflowY: "hidden",
            height: 10,
            zIndex: 2100,
          }}
          onScroll={(e) => {
            const scrollEl =
              ganttRef.current?.querySelector(".gantt-container") ||
              ganttRef.current?.querySelector(".scroll-container") ||
              ganttRef.current?.querySelector(".gantt-body");
            if (scrollEl) scrollEl.scrollLeft = e.currentTarget.scrollLeft;
          }}
        >
          <div ref={customScrollbarInnerRef} style={{ height: 1 }} />
        </div>
      </div>
    </div>
  );
}
