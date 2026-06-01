"use client";

/**
 * 4D 뷰어 — three.js 씬 + 타임라인 슬라이더.
 * use4DSchedule.js 로직 이식: 슬라이더 날짜 vs 요소 활동범위 → 정점색상 갱신.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { ParsedIfc } from "../../lib/fourd/ifc";
import { statusAt, type MatchResult, type ScheduleIndex } from "../../lib/fourd/match";

// use4DSchedule.js 팔레트
const C_DONE = [0.063, 0.725, 0.506]; // green
const C_ACTIVE = [0.133, 0.827, 0.933]; // cyan
const C_PLANNED = [0.376, 0.647, 0.98]; // blue
const C_GHOST = [0.32, 0.34, 0.4]; // 미매칭 (어두운 회색)

function colorFor(status: number): number[] {
  if (status === 2) return C_DONE;
  if (status === 1) return C_ACTIVE;
  if (status === 0) return C_PLANNED;
  return C_GHOST;
}

interface Props {
  parsed: ParsedIfc;
  ranges: Map<string, MatchResult>;
  index: ScheduleIndex;
}

function fmt(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function FourDViewer({ parsed, ranges, index }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const colorAttrRef = useRef<THREE.BufferAttribute | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const [dateMs, setDateMs] = useState<number>(index.maxDate);
  const [kpi, setKpi] = useState({ done: 0, active: 0, planned: 0, ghost: 0 });

  // ── three.js 씬 1회 셋업 ──
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e1116);

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

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    };
  }, [parsed]);

  // ── 날짜 변경 → 색상 갱신 ──
  useEffect(() => {
    const attr = colorAttrRef.current;
    if (!attr) return;
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
    attr.needsUpdate = true;
    setKpi(counts);
  }, [dateMs, parsed, ranges]);

  const pct = useMemo(() => {
    const span = index.maxDate - index.minDate || 1;
    return Math.round(((dateMs - index.minDate) / span) * 100);
  }, [dateMs, index]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 8 }}>
      <div ref={mountRef} style={{ flex: 1, minHeight: 360, borderRadius: 8, overflow: "hidden", background: "#0e1116" }} />

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
          min={index.minDate}
          max={index.maxDate}
          step={86400000}
          value={dateMs}
          onChange={(e) => setDateMs(Number(e.target.value))}
          style={{ flex: 1 }}
          aria-label="공정 시뮬레이션 날짜"
        />
        <span style={{ minWidth: 44, textAlign: "right" }}>{pct}%</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#9ca3af" }}>
        <span>{fmt(index.minDate)}</span>
        <span>{fmt(index.maxDate)}</span>
      </div>
    </div>
  );
}
