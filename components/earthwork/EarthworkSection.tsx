"use client";

/**
 * 지질 단면도 — 시추공 두 점을 잇는 단면을 따라 지층을 색띠로 그린다(SVG).
 *  · 단면선 A→B 따라 N등분 샘플 → 각 점 IDW 보간 경계표고 → 지층 폴리곤.
 *  · 단면선 근처 시추공 투영(수직선+공번), 지하수위(점선).
 */
import { useMemo } from "react";

import { LAYERS, gwlElAt, interfaceAt, type BoreSet, type Borehole } from "../../lib/earthwork/model";

const W = 960, H = 360;
const ML = 54, MR = 16, MT = 16, MB = 36; // 여백
const PL = ML, PR = W - MR, PT = MT, PB = H - MB;
const PW = PR - PL, PH = PB - PT;
const N = 140; // 단면 샘플 수
const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

interface Props {
  set: BoreSet;
  boreholes: Borehole[];
  ax: number; ay: number; bx: number; by: number;
  aLabel: string; bLabel: string;
}

export function EarthworkSection({ set, boreholes, ax, ay, bx, by, aLabel, bLabel }: Props) {
  const view = useMemo(() => {
    const L = Math.hypot(bx - ax, by - ay) || 1;
    // 샘플
    const samples: { d: number; x: number; y: number; e: number[]; gwl: number }[] = [];
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      samples.push({ d: t * L, x, y, e: interfaceAt(set, x, y), gwl: gwlElAt(set, x, y) });
    }
    // 표고 범위
    let maxEl = -Infinity, minEl = Infinity;
    for (const s of samples) {
      maxEl = Math.max(maxEl, s.e[0]);
      minEl = Math.min(minEl, s.e[s.e.length - 1]);
    }
    const pad = (maxEl - minEl) * 0.04 || 1;
    maxEl += pad; minEl -= pad;
    const range = maxEl - minEl;

    const xS = (d: number) => PL + (d / L) * PW;
    const yS = (el: number) => PT + ((maxEl - el) / range) * PH;

    // 지층 밴드 path (위 경계 → 아래 경계 되돌아오기)
    const bands = LAYERS.map((lay, m) => {
      const top = samples.map((s) => `${xS(s.d).toFixed(1)},${yS(s.e[m]).toFixed(1)}`);
      const bot = samples.map((s) => `${xS(s.d).toFixed(1)},${yS(s.e[m + 1]).toFixed(1)}`).reverse();
      return { color: hex(lay.color), d: `M${top.join(" L")} L${bot.join(" L")} Z` };
    });

    // 지하수위 점선 (표고 범위 안)
    const gwlPts = samples
      .map((s) => `${xS(s.d).toFixed(1)},${yS(Math.max(minEl, Math.min(maxEl, s.gwl))).toFixed(1)}`)
      .join(" ");

    // 시추공 투영 (단면선 근처만)
    const ux = (bx - ax) / L, uy = (by - ay) / L; // 단위벡터
    const buffer = Math.max(20, L * 0.12);
    const bores = boreholes.map((b) => {
      const t = (b.x - ax) * ux + (b.y - ay) * uy; // 투영거리
      const projX = ax + ux * t, projY = ay + uy * t;
      const perp = Math.hypot(b.x - projX, b.y - projY);
      return { b, t, perp };
    }).filter((o) => o.t >= -1 && o.t <= L + 1 && o.perp < buffer);

    // 표고 눈금 (~6개 라운드)
    const step = niceStep(range / 6);
    const ticks: number[] = [];
    for (let v = Math.ceil(minEl / step) * step; v <= maxEl; v += step) ticks.push(v);

    return { L, bands, gwlPts, bores, ticks, xS, yS, maxEl, minEl,
      exag: (PH / range) / (PW / L) };
  }, [set, boreholes, ax, ay, bx, by]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", background: "#0e1116", borderRadius: 10 }}>
      {/* 표고 눈금 + 그리드 */}
      {view.ticks.map((v) => (
        <g key={v}>
          <line x1={PL} y1={view.yS(v)} x2={PR} y2={view.yS(v)} stroke="#243042" strokeWidth={1} />
          <text x={PL - 6} y={view.yS(v) + 3} fontSize={10} fill="#7b8aa0" textAnchor="end">{v.toFixed(0)}</text>
        </g>
      ))}
      {/* 지층 밴드 */}
      {view.bands.map((b, i) => (
        <path key={i} d={b.d} fill={b.color} stroke="#0e1116" strokeWidth={0.4} />
      ))}
      {/* 지하수위 */}
      <polyline points={view.gwlPts} fill="none" stroke="#38bdf8" strokeWidth={1.4} strokeDasharray="6 4" />
      {/* 시추공 투영 */}
      {view.bores.map(({ b, t }) => {
        const x = view.xS(t);
        return (
          <g key={b.id}>
            <line x1={x} y1={view.yS(b.el)} x2={x} y2={view.yS(b.el - b.depth)} stroke="#e5e7eb" strokeWidth={1.4} />
            <circle cx={x} cy={view.yS(b.el)} r={2.4} fill="#fff" />
            <text x={x} y={view.yS(b.el) - 5} fontSize={10} fill="#e5e7eb" textAnchor="middle">{b.id}</text>
          </g>
        );
      })}
      {/* 양 끝 라벨 + 축 */}
      <text x={PL} y={PB + 22} fontSize={11} fill="#cbd5e1" textAnchor="start">{aLabel} ◀ 거리(m) ▶ {bLabel}</text>
      <text x={PR} y={PB + 22} fontSize={11} fill="#7b8aa0" textAnchor="end">{view.L.toFixed(0)}m · 수직과장 ×{view.exag.toFixed(1)}</text>
      <text x={14} y={PT + 4} fontSize={10} fill="#7b8aa0" transform={`rotate(-90 14 ${PT + 4})`} textAnchor="end">표고 EL(m)</text>
    </svg>
  );
}

/** 1/2/5 ×10ⁿ 라운드 스텝. */
function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-6))));
  const n = raw / p;
  const s = n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10;
  return s * p;
}
