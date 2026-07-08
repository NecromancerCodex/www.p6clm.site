"use client";

/**
 * CAD 레이어 2D 미리보기 — DXF 기하를 캔버스에 그려 "무엇이 어디에" 눈으로 확인.
 * 카테고리별 색(경계=녹/파일=주황/벽=적/시추=보라/지형=청록/무시=회미). 클릭 → 그 레이어 선택.
 * 코드명 레이어(C0223367)도 그림 모양(격자=파일, 외곽선=경계)으로 판단 가능.
 */
import { useEffect, useMemo, useRef } from "react";

import { layerKey, type FileImport, type Category } from "../../lib/earthwork/dxfImport";

export const CAT_COLOR: Record<Category, string> = {
  boreholes: "#a855f7",
  boundary: "#22c55e",
  piles: "#f59e0b",
  walls: "#ef4444",
  terrain: "#2dd4bf",
  ignore: "#4b5563",
};

interface Props {
  files: FileImport[];
  catFor: (file: string, layer: string) => Category;
  selectedKey: string | null;
  onSelectLayer: (file: string, layer: string) => void;
  height?: number;
}

export function CadLayerPreview({ files, catFor, selectedKey, onSelectLayer, height = 340 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // 좌표 범위 — 이상치(스트레이 점·0뭉치·-2억 좌표) 제거. 중앙값 ± 2.5×IQR:
  // 도면(대체로 균일분포)은 전부 담기고, 극단 아웃라이어는 뷰 밖으로 클립됨.
  const bounds = useMemo(() => {
    const xs: number[] = [], ys: number[] = [];
    for (const f of files) for (const e of f.doc.entities) for (const v of e.verts) {
      if (Number.isFinite(v.x) && Number.isFinite(v.y)) { xs.push(v.x); ys.push(v.y); }
    }
    if (xs.length < 2) return null;
    xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
    const q = (a: number[], p: number) => a[Math.min(a.length - 1, Math.max(0, Math.round(p * (a.length - 1))))];
    const rng = (a: number[]) => {
      const p25 = q(a, 0.25), p50 = q(a, 0.5), p75 = q(a, 0.75);
      const iqr = (p75 - p25) || Math.max(1, Math.abs(p50) * 0.01);
      return [p50 - 2.5 * iqr, p50 + 2.5 * iqr] as const;
    };
    const [minX, maxX] = rng(xs), [minY, maxY] = rng(ys);
    return { minX, minY, maxX, maxY };
  }, [files]);

  const draw = () => {
    const cv = canvasRef.current, box = boxRef.current;
    if (!cv || !box || !bounds) return;
    const W = box.clientWidth, H = height;
    const dpr = 2;   // 고정 DPR (Math.random/Date 불가 이슈와 무관, 선명도)
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + "px"; cv.style.height = H + "px";
    const ctx = cv.getContext("2d"); if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const pad = 14;
    const bw = bounds.maxX - bounds.minX || 1, bh = bounds.maxY - bounds.minY || 1;
    const s = Math.min((W - 2 * pad) / bw, (H - 2 * pad) / bh);
    const ox = (W - bw * s) / 2, oy = (H - bh * s) / 2;
    const px = (x: number) => ox + (x - bounds.minX) * s;
    const py = (y: number) => H - (oy + (y - bounds.minY) * s);   // Y 뒤집기(CAD up → canvas down)

    const drawEntity = (e: (typeof files)[number]["doc"]["entities"][number], color: string, lw: number, dot: number) => {
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = lw;
      const t = e.type;
      if (t === "LWPOLYLINE" || t === "POLYLINE" || t === "LINE") {
        if (e.verts.length < 2) return;
        ctx.beginPath();
        ctx.moveTo(px(e.verts[0].x), py(e.verts[0].y));
        for (let i = 1; i < e.verts.length; i++) ctx.lineTo(px(e.verts[i].x), py(e.verts[i].y));
        if (e.closed) ctx.closePath();
        ctx.stroke();
      } else if (t === "CIRCLE" && e.verts[0]) {
        ctx.beginPath(); ctx.arc(px(e.verts[0].x), py(e.verts[0].y), Math.max(2, (e.radius || 0) * s), 0, Math.PI * 2); ctx.stroke();
      } else if (e.verts[0]) {   // POINT / INSERT / TEXT
        ctx.beginPath(); ctx.arc(px(e.verts[0].x), py(e.verts[0].y), dot, 0, Math.PI * 2); ctx.fill();
      }
    };

    // 1) 무시 레이어(배경, 흐리게) → 2) 카테고리 → 3) 선택 레이어(위, 강조)
    const passes: ("ignore" | "cat" | "sel")[] = ["ignore", "cat", "sel"];
    for (const pass of passes) {
      for (const f of files) for (const e of f.doc.entities) {
        const cat = catFor(f.name, e.layer);
        const isSel = selectedKey === layerKey(f.name, e.layer);
        if (pass === "ignore" && (cat !== "ignore" || isSel)) continue;
        if (pass === "cat" && (cat === "ignore" || isSel)) continue;
        if (pass === "sel" && !isSel) continue;
        const color = isSel ? "#ffffff" : CAT_COLOR[cat];
        ctx.globalAlpha = pass === "ignore" ? 0.18 : isSel ? 1 : 0.85;
        drawEntity(e, color, isSel ? 2.2 : 1, isSel ? 3 : 1.6);
      }
    }
    ctx.globalAlpha = 1;
  };

  useEffect(() => {
    draw();
    const box = boxRef.current; if (!box) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(box);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, bounds, selectedKey, catFor, height]);

  // 클릭 → 가장 가까운 엔티티의 레이어 선택
  const onClick = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current, box = boxRef.current; if (!cv || !box || !bounds) return;
    const rect = cv.getBoundingClientRect();
    const cx = ev.clientX - rect.left, cy = ev.clientY - rect.top;
    const W = box.clientWidth, H = height, pad = 14;
    const bw = bounds.maxX - bounds.minX || 1, bh = bounds.maxY - bounds.minY || 1;
    const s = Math.min((W - 2 * pad) / bw, (H - 2 * pad) / bh);
    const ox = (W - bw * s) / 2, oy = (H - bh * s) / 2;
    const px = (x: number) => ox + (x - bounds.minX) * s;
    const py = (y: number) => H - (oy + (y - bounds.minY) * s);

    let best: { file: string; layer: string } | null = null, bd = 14 * 14;   // 14px 반경 내
    for (const f of files) for (const e of f.doc.entities) {
      for (const v of e.verts) {
        const dx = px(v.x) - cx, dy = py(v.y) - cy, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = { file: f.name, layer: e.layer }; }
      }
    }
    if (best) onSelectLayer(best.file, best.layer);
  };

  if (!bounds) return null;
  return (
    <div ref={boxRef} style={{ marginTop: 10, borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface-soft)", overflow: "hidden", position: "relative" }}>
      <canvas ref={canvasRef} onClick={onClick} style={{ display: "block", cursor: "crosshair" }} />
      <div style={{ position: "absolute", top: 8, left: 10, display: "flex", gap: 10, flexWrap: "wrap", pointerEvents: "none" }}>
        {(["boreholes", "boundary", "piles", "walls", "terrain"] as Category[]).map((c) => (
          <span key={c} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, color: "var(--muted-strong)" }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: CAT_COLOR[c] }} />{LABEL[c]}
          </span>
        ))}
      </div>
      <div style={{ position: "absolute", bottom: 6, right: 10, fontSize: 10, color: "var(--muted)", pointerEvents: "none" }}>클릭 → 레이어 선택</div>
    </div>
  );
}

const LABEL: Record<string, string> = { boreholes: "시추", boundary: "경계", piles: "파일", walls: "흙막이", terrain: "지형" };
