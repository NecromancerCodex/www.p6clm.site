"use client";

/**
 * 4D 뷰어 — three.js 씬 + 타임라인 슬라이더.
 * use4DSchedule.js 로직 이식: 슬라이더 날짜 vs 요소 활동범위 → 정점색상 갱신.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { ParsedIfc, ParsedElement } from "../../lib/fourd/ifc";
import { statusAt, type MatchResult, type ScheduleIndex } from "../../lib/fourd/match";

// IFC 타입 → 한글 부재명
const TYPE_KO: Record<string, string> = {
  IfcWall: "벽",
  IfcWallStandardCase: "벽",
  IfcColumn: "기둥",
  IfcSlab: "슬래브",
  IfcBeam: "보",
  IfcFooting: "기초",
  IfcBuildingElementProxy: "부재",
  IfcCovering: "마감",
  IfcRailing: "난간",
  IfcMember: "부재",
  IfcPlate: "판",
};

/** "502_3층 SL" → "3층" (블록코드·공종코드 제거). */
function cleanStorey(name: string | null): string {
  if (!name) return "—";
  return name.replace(/^[A-Za-z0-9]+_/, "").replace(/\s+[A-Z]{1,3}$/, "").trim() || name;
}

/** via("CR@03"/"MO@05"/"FT@PT") → 공종 한글. */
function workKo(via: string): string {
  if (via.startsWith("FT")) return "기초";
  if (via.startsWith("CR")) return "코어·골조(벽·기둥)";
  if (via.startsWith("MO")) return "층 모듈/마감";
  return "";
}

/** 정점 인덱스 → 소속 요소 (elements 는 vStart 오름차순 → 이진탐색). */
function findElementByVertex(els: ParsedElement[], vIdx: number): ParsedElement | null {
  let lo = 0;
  let hi = els.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const e = els[mid];
    if (vIdx < e.vStart) hi = mid - 1;
    else if (vIdx >= e.vStart + e.vCount) lo = mid + 1;
    else return e;
  }
  return null;
}

// use4DSchedule.js 팔레트
const C_DONE = [0.063, 0.725, 0.506]; // green
const C_ACTIVE = [0.133, 0.827, 0.933]; // cyan
const C_PLANNED = [0.376, 0.647, 0.98]; // blue
const C_GHOST = [0.32, 0.34, 0.4]; // 미매칭 (어두운 회색)
const C_HILITE = [1.0, 0.85, 0.2]; // hover 공정단위 강조 (황색)

function colorFor(status: number): number[] {
  if (status === 2) return C_DONE;
  if (status === 1) return C_ACTIVE;
  if (status === 0) return C_PLANNED;
  return C_GHOST;
}

/** 요소 정점 범위에 색 채우기. */
function paintElement(arr: Float32Array, el: ParsedElement, c: number[]) {
  const end = (el.vStart + el.vCount) * 3;
  for (let i = el.vStart * 3; i < end; i += 3) {
    arr[i] = c[0];
    arr[i + 1] = c[1];
    arr[i + 2] = c[2];
  }
}

interface Props {
  parsed: ParsedIfc;
  ranges: Map<string, MatchResult>;
  index: ScheduleIndex;
}

const DAY = 86400000;
function fmt(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function FourDViewer({ parsed, ranges, index }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const colorAttrRef = useRef<THREE.BufferAttribute | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const hiliteViaRef = useRef<string | null>(null); // 현재 강조 중인 공정단위(via)
  // 슬라이더는 정수 day-index(0..numDays)로 구동한다. epoch ms 격자로 돌리면
  // value↔step 불일치로 controlled input 이 onChange 무한 재발화(React #185)를 일으킨다.
  const tMin = useMemo(() => Math.floor(index.minDate / DAY) * DAY, [index.minDate]);
  const numDays = useMemo(
    () => Math.max(1, Math.ceil((index.maxDate - index.minDate) / DAY)),
    [index.minDate, index.maxDate],
  );
  const [dayIdx, setDayIdx] = useState<number>(numDays); // 초기: 마지막 날(완료 시점)
  const dateMs = tMin + dayIdx * DAY;
  const [kpi, setKpi] = useState({ done: 0, active: 0, planned: 0, ghost: 0 });
  // 마우스 오버한 요소 (툴팁) — 화면 좌표 + 요소
  const [hover, setHover] = useState<{ x: number; y: number; el: ParsedElement } | null>(null);

  // ── three.js 씬 1회 셋업 ──
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e1116);
    sceneRef.current = scene;

    const w = mount.clientWidth;
    const h = mount.clientHeight;
    const camera = new THREE.PerspectiveCamera(55, w / h, 0.1, parsed.radius * 50);
    const r = parsed.radius || 50;
    camera.position.set(parsed.center.x + r * 1.4, parsed.center.y + r * 1.2, parsed.center.z + r * 1.4);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(parsed.center);
    controls.update();

    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(1, 2, 1);
    scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.4);
    dir2.position.set(-1, 1, -1);
    scene.add(dir2);

    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(parsed.geometry, material);
    scene.add(mesh);
    colorAttrRef.current = parsed.geometry.getAttribute("color") as THREE.BufferAttribute;

    // 바닥 그리드 (공간 기준)
    const grid = new THREE.GridHelper(parsed.radius * 4, 40, 0x334155, 0x1e293b);
    grid.position.set(parsed.center.x, parsed.center.y - parsed.radius, parsed.center.z);
    scene.add(grid);

    let raf = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    animate();

    const onResize = () => {
      const nw = mount.clientWidth;
      const nh = mount.clientHeight;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    };
    window.addEventListener("resize", onResize);

    // ── 마우스 오버 → 레이캐스트로 요소 식별 (70ms 스로틀) ──
    const ray = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let lastRC = 0;
    const onMove = (ev: PointerEvent) => {
      if (ev.timeStamp - lastRC < 70) return;
      lastRC = ev.timeStamp;
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      ray.setFromCamera(mouse, camera);
      const hits = ray.intersectObject(mesh, false);
      const fi = hits[0]?.faceIndex;
      if (fi == null) {
        setHover(null);
        return;
      }
      const el = findElementByVertex(parsed.elements, fi * 3);
      setHover(el ? { x: ev.clientX - rect.left, y: ev.clientY - rect.top, el } : null);
    };
    const onLeave = () => setHover(null);
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerleave", onLeave);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    };
  }, [parsed]);

  // ── 날짜 변경 → 색상 갱신 (RAF 스로틀) ──
  // 드래그 중 onChange 가 프레임당 수십 번 발생하면 10,890개 정점색 재계산이 동기로
  // 쌓여 React 19 가 업데이트 폭주(#185)로 판단할 수 있다. 직전 프레임을 취소하고
  // 마지막 값만 계산해 프레임당 1회로 합친다.
  useEffect(() => {
    const attr = colorAttrRef.current;
    if (!attr) return;
    const raf = requestAnimationFrame(() => {
      const arr = attr.array as Float32Array;
      const counts = { done: 0, active: 0, planned: 0, ghost: 0 };
      for (const el of parsed.elements) {
        const mr = ranges.get(el.globalId);
        const st = statusAt(dateMs, mr?.range ?? null);
        const c = colorFor(st);
        if (st === 2) counts.done++;
        else if (st === 1) counts.active++;
        else if (st === 0) counts.planned++;
        else counts.ghost++;
        const end = (el.vStart + el.vCount) * 3;
        for (let i = el.vStart * 3; i < end; i += 3) {
          arr[i] = c[0];
          arr[i + 1] = c[1];
          arr[i + 2] = c[2];
        }
      }
      // 강조 중인 공정단위가 있으면 상태색 위에 다시 덮어쓰기
      const via = hiliteViaRef.current;
      if (via) {
        for (const el of parsed.elements) {
          if (ranges.get(el.globalId)?.via === via) paintElement(arr, el, C_HILITE);
        }
      }
      attr.needsUpdate = true;
      setKpi((prev) =>
        prev.done === counts.done &&
        prev.active === counts.active &&
        prev.planned === counts.planned &&
        prev.ghost === counts.ghost
          ? prev
          : counts,
      );
    });
    return () => cancelAnimationFrame(raf);
  }, [dateMs, parsed, ranges]);

  // ── hover 한 공정단위 실제 부재를 황색 강조 (증분: 그룹이 바뀔 때만 재색칠) ──
  // 박스(AABB)는 U자 형상에서 겹쳐 부정확 → 실제 부재를 칠해 정확한 공정 범위를 보인다.
  const [hiliteCount, setHiliteCount] = useState(0);
  useEffect(() => {
    const attr = colorAttrRef.current;
    if (!attr) return;
    const arr = attr.array as Float32Array;
    const mr = hover ? ranges.get(hover.el.globalId) : undefined;
    const newVia = mr?.range ? mr.via : null;
    if (newVia === hiliteViaRef.current) return; // 같은 그룹 → 변화 없음

    let count = 0;
    // 1) 이전 강조 그룹 → 상태색 복원
    const prevVia = hiliteViaRef.current;
    if (prevVia) {
      for (const el of parsed.elements) {
        if (ranges.get(el.globalId)?.via !== prevVia) continue;
        const st = statusAt(dateMs, ranges.get(el.globalId)?.range ?? null);
        paintElement(arr, el, colorFor(st));
      }
    }
    // 2) 새 그룹 → 황색 강조
    if (newVia) {
      for (const el of parsed.elements) {
        if (ranges.get(el.globalId)?.via !== newVia) continue;
        paintElement(arr, el, C_HILITE);
        count++;
      }
    }
    hiliteViaRef.current = newVia;
    attr.needsUpdate = true;
    setHiliteCount(count);
  }, [hover, parsed, ranges, dateMs]);

  const pct = Math.round((dayIdx / numDays) * 100);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 8 }}>
      <div style={{ position: "relative", flex: 1, minHeight: 360 }}>
        <div
          ref={mountRef}
          style={{ position: "absolute", inset: 0, borderRadius: 8, overflow: "hidden", background: "#0e1116" }}
        />
        {hover &&
          (() => {
            const mr = ranges.get(hover.el.globalId);
            const range = mr?.range ?? null;
            const st = statusAt(dateMs, range);
            const stMeta =
              st === 2
                ? { t: "완료", c: "#10b981" }
                : st === 1
                  ? { t: "진행중", c: "#22d3ee" }
                  : st === 0
                    ? { t: "미착수", c: "#60a5fa" }
                    : { t: "미매칭", c: "#9ca3af" };
            return (
              <div
                style={{
                  position: "absolute",
                  left: Math.min(hover.x + 14, 9999),
                  top: hover.y + 14,
                  maxWidth: 280,
                  padding: "8px 10px",
                  background: "rgba(15,17,22,0.95)",
                  border: "1px solid #334155",
                  borderRadius: 8,
                  color: "#e2e8f0",
                  fontSize: 12,
                  lineHeight: 1.6,
                  pointerEvents: "none",
                  zIndex: 10,
                  boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
                }}
              >
                <div style={{ fontWeight: 600 }}>
                  {TYPE_KO[hover.el.ifcType] ?? hover.el.ifcType} · {cleanStorey(hover.el.storeyName)}
                </div>
                {range && mr ? (
                  <>
                    <div>
                      공정: {cleanStorey(hover.el.storeyName)} {workKo(mr.via)}
                    </div>
                    {hiliteCount > 0 && (
                      <div style={{ color: "#fbbf24" }}>
                        이 공정 부재 {hiliteCount.toLocaleString()}개 강조 중
                      </div>
                    )}
                    <div style={{ color: "#94a3b8" }}>
                      기간: {fmt(range.start)} ~ {fmt(range.end)}
                    </div>
                    <div style={{ color: stMeta.c, fontWeight: 600 }}>상태: {stMeta.t}</div>
                  </>
                ) : (
                  <div style={{ color: "#fbbf24" }}>공정 없음 (공정표에 일정 미존재)</div>
                )}
              </div>
            );
          })()}
      </div>

      {/* KPI */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 13 }}>
        <span style={{ color: "#10b981" }}>● 완료 {kpi.done.toLocaleString()}</span>
        <span style={{ color: "#22d3ee" }}>● 진행중 {kpi.active.toLocaleString()}</span>
        <span style={{ color: "#60a5fa" }}>● 미착수 {kpi.planned.toLocaleString()}</span>
        <span style={{ color: "#6b7280" }}>● 미매칭 {kpi.ghost.toLocaleString()}</span>
      </div>

      {/* 타임라인 */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <strong style={{ minWidth: 96 }}>{fmt(dateMs)}</strong>
        <input
          type="range"
          min={0}
          max={numDays}
          step={1}
          value={dayIdx}
          onChange={(e) => setDayIdx(Number(e.target.value))}
          style={{ flex: 1 }}
          aria-label="공정 시뮬레이션 날짜"
        />
        <span style={{ minWidth: 44, textAlign: "right" }}>{pct}%</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#9ca3af" }}>
        <span>{fmt(tMin)}</span>
        <span>{fmt(tMin + numDays * DAY)}</span>
      </div>
    </div>
  );
}
