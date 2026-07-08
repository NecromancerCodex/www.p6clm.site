"use client";

/**
 * CAD 레이어 2D 미리보기 — DXF 기하를 캔버스에 그려 "무엇이 어디에" 눈으로 확인.
 * 카테고리별 색(경계=녹/파일=주황/벽=적/시추=보라/지형=청록/무시=회미).
 * 휠=확대/축소(커서 기준), 드래그=이동, 클릭=그 레이어 선택. 극단 이상치 엔티티는 스킵.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { layerKey, type FileImport, type Category } from "../../lib/earthwork/dxfImport";

export const CAT_COLOR: Record<Category, string> = {
  boreholes: "#a855f7", boundary: "#22c55e", piles: "#f59e0b", walls: "#ef4444", terrain: "#2dd4bf", ignore: "#4b5563",
};
const LABEL: Record<string, string> = { boreholes: "시추", boundary: "경계", piles: "파일", walls: "흙막이", terrain: "지형" };

interface Props {
  files: FileImport[];
  catFor: (file: string, layer: string) => Category;
  selectedKey: string | null;
  onSelectLayer: (file: string, layer: string) => void;
  height?: number;
}

interface View { s: number; tx: number; ty: number; }

export function CadLayerPreview({ files, catFor, selectedKey, onSelectLayer, height = 380 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View | null>(null);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: number } | null>(null);

  // 좌표 범위 — 중앙값 ± 2.5×IQR (극단 이상치·0뭉치 제거)
  const bounds = useMemo(() => {
    const xs: number[] = [], ys: number[] = [];
    for (const f of files) for (const e of f.doc.entities) for (const v of e.verts) {
      if (Number.isFinite(v.x) && Number.isFinite(v.y)) { xs.push(v.x); ys.push(v.y); }
    }
    if (xs.length < 2) return null;
    xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
    const q = (a: number[], p: number) => a[Math.min(a.length - 1, Math.max(0, Math.round(p * (a.length - 1))))];
    const rng = (a: number[]): [number, number] => {
      const p25 = q(a, 0.25), p50 = q(a, 0.5), p75 = q(a, 0.75);
      const iqr = (p75 - p25) || Math.max(1, Math.abs(p50) * 0.01);
      return [p50 - 2.5 * iqr, p50 + 2.5 * iqr];
    };
    const [minX, maxX] = rng(xs), [minY, maxY] = rng(ys);
    return { minX, minY, maxX, maxY };
  }, [files]);

  // 이상치 엔티티 제외: ① 중심에서 너무 먼 vertex ② 자체 span 이 도면 폭 초과(도면→이상치 실선).
  const sane = useMemo(() => {
    if (!bounds) return () => true;
    const cx = (bounds.minX + bounds.maxX) / 2, cy = (bounds.minY + bounds.maxY) / 2;
    const bw = (bounds.maxX - bounds.minX) || 1, bh = (bounds.maxY - bounds.minY) || 1;
    const lim = Math.max(bw, bh) * 3, span = Math.max(bw, bh) * 2;
    return (e: FileImport["doc"]["entities"][number]) => {
      let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
      for (const v of e.verts) {
        if (Math.abs(v.x - cx) > lim || Math.abs(v.y - cy) > lim) return false;
        if (v.x < mnx) mnx = v.x; if (v.x > mxx) mxx = v.x; if (v.y < mny) mny = v.y; if (v.y > mxy) mxy = v.y;
      }
      return (mxx - mnx) <= span && (mxy - mny) <= span;
    };
  }, [bounds]);

  // 초기/리셋 뷰 (bounds·크기 변화 시 fit)
  useEffect(() => {
    const box = boxRef.current; if (!box || !bounds) { setView(null); return; }
    const W = box.clientWidth, H = height, pad = 26;
    const bw = bounds.maxX - bounds.minX || 1, bh = bounds.maxY - bounds.minY || 1;
    const s = Math.min((W - 2 * pad) / bw, (H - 2 * pad) / bh);
    setView({ s, tx: (W - (bounds.minX + bounds.maxX) * s) / 2, ty: (H + (bounds.minY + bounds.maxY) * s) / 2 });
  }, [bounds, height]);

  const draw = () => {
    const cv = canvasRef.current, box = boxRef.current;
    if (!cv || !box || !bounds || !view) return;
    const W = box.clientWidth, H = height, dpr = 2;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + "px"; cv.style.height = H + "px";
    const ctx = cv.getContext("2d"); if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const px = (x: number) => x * view.s + view.tx;
    const py = (y: number) => view.ty - y * view.s;

    const drawEntity = (e: FileImport["doc"]["entities"][number], color: string, lw: number, dot: number) => {
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = lw;
      const t = e.type;
      if (t === "LWPOLYLINE" || t === "POLYLINE" || t === "LINE") {
        if (e.verts.length < 2) return;
        ctx.beginPath(); ctx.moveTo(px(e.verts[0].x), py(e.verts[0].y));
        for (let i = 1; i < e.verts.length; i++) ctx.lineTo(px(e.verts[i].x), py(e.verts[i].y));
        if (e.closed) ctx.closePath();
        ctx.stroke();
      } else if (t === "CIRCLE" && e.verts[0]) {
        ctx.beginPath(); ctx.arc(px(e.verts[0].x), py(e.verts[0].y), Math.max(1.5, (e.radius || 0) * view.s), 0, Math.PI * 2); ctx.stroke();
      } else if (e.verts[0]) {
        ctx.beginPath(); ctx.arc(px(e.verts[0].x), py(e.verts[0].y), dot, 0, Math.PI * 2); ctx.fill();
      }
    };

    for (const pass of ["ignore", "cat", "sel"] as const) {
      for (const f of files) for (const e of f.doc.entities) {
        if (!sane(e)) continue;
        const cat = catFor(f.name, e.layer);
        const isSel = selectedKey === layerKey(f.name, e.layer);
        if (pass === "ignore" && (cat !== "ignore" || isSel)) continue;
        if (pass === "cat" && (cat === "ignore" || isSel)) continue;
        if (pass === "sel" && !isSel) continue;
        ctx.globalAlpha = pass === "ignore" ? 0.16 : isSel ? 1 : 0.85;
        drawEntity(e, isSel ? "#ffffff" : CAT_COLOR[cat], isSel ? 2.2 : 1, isSel ? 3.2 : 1.7);
      }
    }
    ctx.globalAlpha = 1;
  };

  useEffect(() => { draw(); const box = boxRef.current; if (!box) return; const ro = new ResizeObserver(() => draw()); ro.observe(box); return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, view, selectedKey, catFor, sane, height]);

  // 휠 확대/축소 (커서 기준) — passive:false 위해 네이티브 리스너
  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setView((v) => {
        if (!v) return v;
        const rect = cv.getBoundingClientRect();
        const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
        const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const s2 = v.s * f;
        const wx = (cx - v.tx) / v.s, wy = (v.ty - cy) / v.s;
        return { s: s2, tx: cx - wx * s2, ty: cy + wy * s2 };
      });
    };
    cv.addEventListener("wheel", onWheel, { passive: false });
    return () => cv.removeEventListener("wheel", onWheel);
  }, []);

  const onDown = (e: React.MouseEvent) => { if (view) drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: 0 }; };
  const onMove = (e: React.MouseEvent) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.moved = Math.max(d.moved, Math.abs(dx) + Math.abs(dy));
    setView((v) => (v ? { ...v, tx: d.tx + dx, ty: d.ty + dy } : v));
  };
  const onUp = (e: React.MouseEvent) => {
    const d = drag.current; drag.current = null;
    if (!d || d.moved > 5 || !view || !bounds) return;   // 드래그면 선택 안 함
    const cv = canvasRef.current, box = boxRef.current; if (!cv || !box) return;
    const rect = cv.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    let best: { file: string; layer: string } | null = null, bd = 16 * 16;
    for (const f of files) for (const en of f.doc.entities) {
      if (!sane(en)) continue;
      for (const v of en.verts) {
        const sx = v.x * view.s + view.tx, sy = view.ty - v.y * view.s;
        const q = (sx - cx) ** 2 + (sy - cy) ** 2;
        if (q < bd) { bd = q; best = { file: f.name, layer: en.layer }; }
      }
    }
    if (best) onSelectLayer(best.file, best.layer);
  };
  const resetView = () => setView((v) => v && bounds && boxRef.current ? (() => {
    const W = boxRef.current!.clientWidth, H = height, pad = 26;
    const bw = bounds.maxX - bounds.minX || 1, bh = bounds.maxY - bounds.minY || 1;
    const s = Math.min((W - 2 * pad) / bw, (H - 2 * pad) / bh);
    return { s, tx: (W - (bounds.minX + bounds.maxX) * s) / 2, ty: (H + (bounds.minY + bounds.maxY) * s) / 2 };
  })() : v);

  if (!bounds) return null;
  return (
    <div ref={boxRef} style={{ marginTop: 10, borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface-soft)", overflow: "hidden", position: "relative" }}>
      <canvas ref={canvasRef}
        onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={() => { drag.current = null; }}
        style={{ display: "block", cursor: drag.current ? "grabbing" : "crosshair" }} />
      <div style={{ position: "absolute", top: 8, left: 10, display: "flex", gap: 10, flexWrap: "wrap", pointerEvents: "none" }}>
        {(["boreholes", "boundary", "piles", "walls", "terrain"] as Category[]).map((c) => (
          <span key={c} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, color: "var(--muted-strong)" }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: CAT_COLOR[c] }} />{LABEL[c]}
          </span>
        ))}
      </div>
      <button type="button" onClick={resetView}
        style={{ position: "absolute", top: 6, right: 10, fontSize: 10.5, color: "var(--muted-strong)", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 6, padding: "2px 8px", cursor: "pointer" }}>
        맞춤
      </button>
      <div style={{ position: "absolute", bottom: 6, right: 10, fontSize: 10, color: "var(--muted)", pointerEvents: "none" }}>휠=확대 · 드래그=이동 · 클릭=레이어 선택</div>
    </div>
  );
}
