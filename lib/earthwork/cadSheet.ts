/**
 * CAD 레이어 컨택트시트 렌더러 — 각 레이어의 도형을 번호 붙은 썸네일 그리드로 그림.
 * 비전 모델이 '모양'(격자=파일, 큰 닫힌선=경계, 평행선=흙막이)을 보고 분류하도록.
 * 클라이언트 전용(document/canvas).
 */
import type { FileImport } from "./dxfImport";

export interface SheetRef { n: number; file: string; layer: string; name: string; }

const CELL = 200, PAD = 12, COLS = 5;

// 레이어 엔티티들의 robust 범위(중앙값±2.5IQR — 이상치 제거).
function layerBounds(ents: FileImport["doc"]["entities"]) {
  const xs: number[] = [], ys: number[] = [];
  for (const e of ents) for (const v of e.verts) if (Number.isFinite(v.x) && Number.isFinite(v.y)) { xs.push(v.x); ys.push(v.y); }
  if (xs.length < 2) return null;
  xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
  const q = (a: number[], p: number) => a[Math.min(a.length - 1, Math.max(0, Math.round(p * (a.length - 1))))];
  const rng = (a: number[]): [number, number] => {
    const p25 = q(a, 0.25), p50 = q(a, 0.5), p75 = q(a, 0.75);
    const iqr = (p75 - p25) || Math.max(1, Math.abs(p50) * 0.01);
    return [p50 - 2.7 * iqr, p50 + 2.7 * iqr];
  };
  const [minX, maxX] = rng(xs), [minY, maxY] = rng(ys);
  return { minX, minY, maxX, maxY };
}

function drawCell(ctx: CanvasRenderingContext2D, ents: FileImport["doc"]["entities"], ox: number, oy: number) {
  const b = layerBounds(ents);
  if (!b) return;
  const bw = b.maxX - b.minX || 1, bh = b.maxY - b.minY || 1;
  const s = Math.min((CELL - 2 * PAD) / bw, (CELL - 2 * PAD) / bh);
  const cx = ox + (CELL - bw * s) / 2, cy = oy + (CELL + bh * s) / 2;
  const px = (x: number) => cx + (x - b.minX) * s;
  const py = (y: number) => cy - (y - b.minY) * s;
  const cxr = (b.minX + b.maxX) / 2, cyr = (b.minY + b.maxY) / 2, lim = Math.max(bw, bh) * 20;
  ctx.strokeStyle = "#e5e7eb"; ctx.fillStyle = "#e5e7eb"; ctx.lineWidth = 1;
  for (const e of ents) {
    if (e.verts.some((v) => Math.abs(v.x - cxr) > lim || Math.abs(v.y - cyr) > lim)) continue;
    const t = e.type;
    if (t === "LWPOLYLINE" || t === "POLYLINE" || t === "LINE") {
      if (e.verts.length < 2) continue;
      ctx.beginPath(); ctx.moveTo(px(e.verts[0].x), py(e.verts[0].y));
      for (let i = 1; i < e.verts.length; i++) ctx.lineTo(px(e.verts[i].x), py(e.verts[i].y));
      if (e.closed) ctx.closePath();
      ctx.stroke();
    } else if (t === "CIRCLE" && e.verts[0]) {
      ctx.beginPath(); ctx.arc(px(e.verts[0].x), py(e.verts[0].y), Math.max(1.5, (e.radius || 0) * s), 0, Math.PI * 2); ctx.stroke();
    } else if (e.verts[0]) {
      ctx.beginPath(); ctx.arc(px(e.verts[0].x), py(e.verts[0].y), 2, 0, Math.PI * 2); ctx.fill();
    }
  }
}

/** 레이어 목록 → {b64(PNG), refs}. refs 는 번호↔레이어 매핑(비전 응답 해석용). */
export function renderContactSheet(files: FileImport[], targets: { file: string; layer: string }[]): { b64: string; refs: SheetRef[] } | null {
  const refs: SheetRef[] = targets.slice(0, 40).map((t, i) => ({ n: i + 1, file: t.file, layer: t.layer, name: t.layer }));
  if (!refs.length) return null;
  const rows = Math.ceil(refs.length / COLS);
  const cv = document.createElement("canvas");
  cv.width = COLS * CELL; cv.height = rows * CELL;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#111827"; ctx.fillRect(0, 0, cv.width, cv.height);

  for (const r of refs) {
    const col = (r.n - 1) % COLS, row = Math.floor((r.n - 1) / COLS);
    const ox = col * CELL, oy = row * CELL;
    // 셀 테두리
    ctx.strokeStyle = "#374151"; ctx.lineWidth = 1; ctx.strokeRect(ox + 0.5, oy + 0.5, CELL - 1, CELL - 1);
    // 도형
    const f = files.find((x) => x.name === r.file);
    if (f) drawCell(ctx, f.doc.entities.filter((e) => e.layer === r.layer), ox, oy);
    // 번호
    ctx.fillStyle = "#fbbf24"; ctx.font = "bold 20px sans-serif"; ctx.textBaseline = "top";
    ctx.fillText(String(r.n), ox + 8, oy + 6);
  }
  const b64 = cv.toDataURL("image/png").split(",")[1] || "";
  return { b64, refs };
}
