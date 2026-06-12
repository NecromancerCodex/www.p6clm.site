/**
 * 토공/지반 모델 — 시추주상도(NH-1~11) → 층서 보간(IDW) → 층별 체적.
 *
 * 데이터 출처:
 *   · 좌표(X,Y,EL): 5.2 시추주상도.pdf 에서 추출.
 *   · 층두께(m)   : 지층별 분포 두께표. (층두께 합 = 굴진심도 일치 검증 완료)
 * 층서(위→아래): 매립층→점성토→사질토→자갈→풍화토→풍화암→연암→보통암→경암.
 *   미시추(굴진심도 미도달) 하부층은 두께 0 → 해당 위치서 층이 첨멸(pinch-out).
 */

export interface LayerDef {
  key: string;
  label: string;
  color: number; // three.js hex
  group: "토사" | "풍화" | "암반";
}

// 지질 표준 색 계열 (토사=갈/황, 풍화=올리브, 암=회/청회).
export const LAYERS: LayerDef[] = [
  { key: "fill", label: "매립층", color: 0xc9a16b, group: "토사" },
  { key: "clay", label: "점성토", color: 0x9b7b4f, group: "토사" },
  { key: "sand", label: "사질토", color: 0xd9c36b, group: "토사" },
  { key: "gravel", label: "자갈", color: 0xcf8a3b, group: "토사" },
  { key: "wsoil", label: "풍화토", color: 0xa98a55, group: "풍화" },
  { key: "wrock", label: "풍화암", color: 0x8a8a4a, group: "풍화" },
  { key: "srock", label: "연암", color: 0x6f8a78, group: "암반" },
  { key: "mrock", label: "보통암", color: 0x868c93, group: "암반" },
  { key: "hrock", label: "경암", color: 0x55606b, group: "암반" },
];

export interface Borehole {
  id: string;
  x: number; // 측량 X (easting)
  y: number; // 측량 Y (northing)
  el: number; // 지표고 EL(+m)
  depth: number; // 굴진심도 G.L.-m
  gwl: number; // 지하수위 G.L.-m
  t: Record<string, number>; // 층key → 두께(m)
}

const L0 = (o: Partial<Record<string, number>>): Record<string, number> => ({
  fill: 0, clay: 0, sand: 0, gravel: 0, wsoil: 0, wrock: 0, srock: 0, mrock: 0, hrock: 0, ...o,
});

// 좌표=PDF, 두께=분포표. (두께 합 ≈ 굴진심도)
export const BOREHOLES: Borehole[] = [
  { id: "NH-1", x: 285796.486, y: 211993.446, el: 2.81, depth: 42.0, gwl: 13.95, t: L0({ fill: 8.0, clay: 19.0, sand: 3.0, wrock: 4.5, srock: 5.5 }) },
  { id: "NH-2", x: 285808.596, y: 212029.159, el: 2.93, depth: 70.0, gwl: 11.95, t: L0({ fill: 8.0, clay: 14.0, gravel: 2.0, srock: 17.2, mrock: 8.6, hrock: 20.2 }) },
  { id: "NH-3", x: 285839.01, y: 212057.34, el: 3.06, depth: 40.0, gwl: 10.55, t: L0({ fill: 7.0, clay: 2.5, sand: 5.0, gravel: 0.8, wrock: 1.7, srock: 16.1, mrock: 6.9 }) },
  { id: "NH-4", x: 285767.819, y: 212023.646, el: 2.7, depth: 70.0, gwl: 13.5, t: L0({ fill: 7.0, clay: 8.5, sand: 8.0, gravel: 2.5, srock: 18.7, hrock: 25.3 }) },
  { id: "NH-5", x: 285789.603, y: 212042.205, el: 3.05, depth: 70.0, gwl: 13.2, t: L0({ fill: 4.0, clay: 10.5, sand: 3.0, gravel: 3.0, wsoil: 2.0, wrock: 4.0, srock: 19.6, mrock: 23.9 }) },
  { id: "NH-6", x: 285798.839, y: 212070.106, el: 3.04, depth: 70.0, gwl: 12.45, t: L0({ fill: 5.0, clay: 2.5, sand: 5.5, gravel: 2.0, mrock: 23.0, hrock: 32.0 }) },
  { id: "NH-7", x: 285771.711, y: 212054.015, el: 3.07, depth: 70.0, gwl: 12.65, t: L0({ fill: 6.5, clay: 1.3, sand: 7.5, gravel: 1.7, srock: 8.4, hrock: 44.6 }) },
  { id: "NH-8", x: 285728.011, y: 212037.071, el: 2.5, depth: 40.0, gwl: 13.05, t: L0({ fill: 7.0, clay: 15.0, srock: 3.2, hrock: 12.8 }) },
  { id: "NH-9", x: 285749.044, y: 212068.592, el: 2.89, depth: 40.0, gwl: 12.2, t: L0({ fill: 7.0, clay: 8.0, gravel: 2.5, srock: 3.7, mrock: 18.8 }) },
  { id: "NH-10", x: 285769.952, y: 212100.048, el: 2.79, depth: 40.0, gwl: 8.35, t: L0({ fill: 7.0, clay: 6.0, gravel: 2.0, wrock: 1.0, srock: 11.1, mrock: 12.9 }) },
  { id: "NH-11", x: 285816.9, y: 212024.125, el: 2.94, depth: 40.0, gwl: 11.25, t: L0({ fill: 7.0, clay: 15.5, sand: 1.0, srock: 3.5, mrock: 6.0, hrock: 6.5 }) },
];

// ── 대표 지형 프리셋 ── 실 시추 없이 지형 형태를 바로 3D로 확인하는 데모/템플릿.
export type TerrainKind = "flat" | "slope" | "hill" | "valley";

export const TERRAIN_PRESETS: { kind: TerrainKind; label: string; desc: string }[] = [
  { kind: "flat", label: "평지", desc: "지표고 일정" },
  { kind: "slope", label: "경사지", desc: "한쪽으로 기울어진 지형" },
  { kind: "hill", label: "구릉", desc: "가운데가 솟은 언덕" },
  { kind: "valley", label: "계곡", desc: "가운데가 패인 골짜기" },
];

// 암반대(풍화~경암)는 평탄하게 고정, 토사(fill~gravel)가 지표까지 채움 → 지형 따라 토사 물량이 달라짐.
const ROCK_LAYERS = { wsoil: 3, wrock: 4, srock: 6, mrock: 7, hrock: 8 }; // 합 28m, 전 지점 동일
const ROCK_TOP_EL = 20; // 암반대 상단 표고(평탄)
const SOIL_RATIO = { fill: 0.27, clay: 0.36, sand: 0.27, gravel: 0.1 }; // 토사 내 비율

/** 5×5 격자(120×120m)에 형태별 지표고를 부여한 가상 시추공 셋. */
export function makeTerrainPreset(kind: TerrainKind): Borehole[] {
  const N = 5;
  const span = 120;
  const step = span / (N - 1); // 30m 간격
  const base = 50; // 기준 지표고 EL
  const out: Borehole[] = [];
  let i = 0;
  for (let iy = 0; iy < N; iy++) {
    for (let ix = 0; ix < N; ix++) {
      const x = ix * step;
      const y = iy * step;
      const u = ix / (N - 1); // 0..1
      const v = iy / (N - 1);
      const dx = u - 0.5;
      const dy = v - 0.5;
      let el = base;
      if (kind === "slope") el = base - 14 + u * 28; // 36 → 64 (한 방향 경사)
      else if (kind === "hill") el = base + 24 * Math.exp(-(dx * dx + dy * dy) / 0.06); // 중앙 봉우리
      else if (kind === "valley") el = base + 4 - 24 * Math.exp(-(dx * dx + dy * dy) / 0.06); // 중앙 골
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const soil = Math.max(2, el - ROCK_TOP_EL); // 지표~암반상단 = 토사 총두께(지형 따라 변함)
      out.push({
        id: `T-${String(++i).padStart(2, "0")}`,
        x,
        y,
        el: r2(el),
        depth: r2(el - (ROCK_TOP_EL - 28)), // 지표~암반 최하단(평탄 base)
        gwl: 8,
        t: L0({
          fill: r2(soil * SOIL_RATIO.fill),
          clay: r2(soil * SOIL_RATIO.clay),
          sand: r2(soil * SOIL_RATIO.sand),
          gravel: r2(soil * SOIL_RATIO.gravel),
          ...ROCK_LAYERS,
        }),
      });
    }
  }
  return out;
}

/** 시추공의 층 경계 표고 (위→아래). 길이 = LAYERS.length+1. [0]=지표, [L]=최하단. */
export function interfaceElevations(b: Borehole): number[] {
  const out = [b.el];
  let acc = 0;
  for (const L of LAYERS) {
    acc += b.t[L.key] || 0;
    out.push(b.el - acc);
  }
  return out;
}

/** IDW(역거리가중, power=2) 보간. 시추공 위치 정확히 일치하면 그 값. */
function idw(px: number, py: number, samples: { x: number; y: number; v: number }[]): number {
  let num = 0;
  let den = 0;
  for (const s of samples) {
    const dx = px - s.x;
    const dy = py - s.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < 1e-6) return s.v;
    const w = 1 / d2; // 1/거리² → power 2
    num += w * s.v;
    den += w;
  }
  return den ? num / den : 0;
}

/** 보간용 전처리본 — 시추공 경계표고 미리 계산. */
export interface BoreSet {
  boreholes: Borehole[];
  ifs: { x: number; y: number; gwlEl: number; e: number[] }[];
}

/** 시추공 배열 → BoreSet(경계표고 1회 계산). */
export function prepare(boreholes: Borehole[]): BoreSet {
  return {
    boreholes,
    ifs: boreholes.map((b) => ({ x: b.x, y: b.y, gwlEl: b.el - b.gwl, e: interfaceElevations(b) })),
  };
}

/** 기본 샘플(시추 11공) 전처리본. */
export const SAMPLE_SET = prepare(BOREHOLES);

/** 임의 (x,y) 의 층 경계 표고 [지표,…9하단] — IDW(power2) + 단조 보정. */
export function interfaceAt(set: BoreSet, x: number, y: number): number[] {
  const ni = LAYERS.length + 1;
  const num = new Array(ni).fill(0);
  let den = 0;
  for (const b of set.ifs) {
    const dx = x - b.x, dy = y - b.y, d2 = dx * dx + dy * dy;
    if (d2 < 1e-6) return b.e.slice();
    const w = 1 / d2;
    den += w;
    for (let m = 0; m < ni; m++) num[m] += w * b.e[m];
  }
  const res = num.map((v) => (den ? v / den : 0));
  for (let m = 1; m < ni; m++) if (res[m] > res[m - 1]) res[m] = res[m - 1];
  return res;
}

/** 임의 (x,y) 의 지하수위 표고(EL) — IDW. */
export function gwlElAt(set: BoreSet, x: number, y: number): number {
  let num = 0, den = 0;
  for (const b of set.ifs) {
    const dx = x - b.x, dy = y - b.y, d2 = dx * dx + dy * dy;
    if (d2 < 1e-6) return b.gwlEl;
    const w = 1 / d2;
    num += w * b.gwlEl;
    den += w;
  }
  return den ? num / den : 0;
}

const _orZero = (v: number) => (Number.isFinite(v) ? v : 0);

/**
 * boreholes.csv 형식 파싱 → 시추공 배열. 좌표(X,Y) 없는 행은 제외(3D 배치 불가).
 * 헤더: borehole,X,Y,surface_EL,drill_depth,gwl_GL,fill,clay,sand,gravel,wsoil,wrock,srock,mrock,hrock
 */
export function parseBoreholeCsv(text: string): Borehole[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim());
  const idx: Record<string, number> = {};
  header.forEach((h, i) => (idx[h] = i));
  const num = (c: string[], k: string) => {
    const i = idx[k];
    return i != null ? parseFloat((c[i] ?? "").trim()) : NaN;
  };
  const out: Borehole[] = [];
  for (let r = 1; r < lines.length; r++) {
    const c = lines[r].split(",");
    const id = (c[idx["borehole"]] ?? "").trim();
    const x = num(c, "X"), y = num(c, "Y");
    if (!id || !Number.isFinite(x) || !Number.isFinite(y)) continue; // 좌표 없는 행 스킵
    const t: Record<string, number> = {};
    for (const L of LAYERS) t[L.key] = _orZero(num(c, L.key));
    out.push({
      id, x, y,
      el: _orZero(num(c, "surface_EL")),
      depth: _orZero(num(c, "drill_depth")),
      gwl: _orZero(num(c, "gwl_GL")),
      t,
    });
  }
  return out;
}

export interface GridModel {
  nx: number;
  ny: number;
  spacing: number;
  // 로컬 좌표(측량원점 차감) — three.js 평면. lx = X-minX, ly = Y-minY.
  minX: number;
  minY: number;
  width: number; // X 방향(m)
  depthY: number; // Y 방향(m)
  lx: number[]; // [ix] 로컬 X
  ly: number[]; // [iy] 로컬 Y
  ifaces: number[][][]; // [m=0..LAYERS.length][iy][ix] = 경계 표고(EL)
}

/** 부지 격자 + 각 층 경계 표고 IDW 보간. boreholes 기반. spacing(m). */
export function buildGridModel(boreholes: Borehole[], spacing = 2): GridModel {
  const minX = Math.min(...boreholes.map((b) => b.x));
  const maxX = Math.max(...boreholes.map((b) => b.x));
  const minY = Math.min(...boreholes.map((b) => b.y));
  const maxY = Math.max(...boreholes.map((b) => b.y));
  const width = maxX - minX;
  const depthY = maxY - minY;
  const nx = Math.max(2, Math.ceil(width / spacing) + 1);
  const ny = Math.max(2, Math.ceil(depthY / spacing) + 1);
  const lx = Array.from({ length: nx }, (_, i) => (i / (nx - 1)) * width);
  const ly = Array.from({ length: ny }, (_, j) => (j / (ny - 1)) * depthY);

  // 시추공별 경계 표고 미리 계산.
  const bIf = boreholes.map((b) => ({ x: b.x - minX, y: b.y - minY, e: interfaceElevations(b) }));
  const nIf = LAYERS.length + 1;
  const ifaces: number[][][] = [];
  for (let m = 0; m < nIf; m++) {
    const samples = bIf.map((b) => ({ x: b.x, y: b.y, v: b.e[m] }));
    const grid: number[][] = [];
    for (let iy = 0; iy < ny; iy++) {
      const row: number[] = [];
      for (let ix = 0; ix < nx; ix++) row.push(idw(lx[ix], ly[iy], samples));
      grid.push(row);
    }
    ifaces.push(grid);
  }
  // 단조성 보정 — 보간 오차로 하부 경계가 상부보다 높아지지 않게 (체적 음수 방지).
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      for (let m = 1; m < nIf; m++) {
        if (ifaces[m][iy][ix] > ifaces[m - 1][iy][ix]) ifaces[m][iy][ix] = ifaces[m - 1][iy][ix];
      }
    }
  }
  return { nx, ny, spacing, minX, minY, width, depthY, lx, ly, ifaces };
}

export interface LayerVolume {
  key: string;
  label: string;
  group: string;
  color: number;
  volume: number; // m³
}

/** 층별 토공 물량(m³) — 격자 셀별 평균두께 × 셀면적 적분. */
export function layerVolumes(g: GridModel): LayerVolume[] {
  const out: LayerVolume[] = [];
  for (let m = 0; m < LAYERS.length; m++) {
    const top = g.ifaces[m];
    const bot = g.ifaces[m + 1];
    let vol = 0;
    for (let iy = 0; iy < g.ny - 1; iy++) {
      for (let ix = 0; ix < g.nx - 1; ix++) {
        // 셀 4코너 평균 두께
        const th =
          (top[iy][ix] - bot[iy][ix] +
            top[iy][ix + 1] - bot[iy][ix + 1] +
            top[iy + 1][ix] - bot[iy + 1][ix] +
            top[iy + 1][ix + 1] - bot[iy + 1][ix + 1]) / 4;
        const cellW = g.lx[ix + 1] - g.lx[ix];
        const cellH = g.ly[iy + 1] - g.ly[iy];
        if (th > 0) vol += th * cellW * cellH;
      }
    }
    out.push({ key: LAYERS[m].key, label: LAYERS[m].label, group: LAYERS[m].group, color: LAYERS[m].color, volume: vol });
  }
  return out;
}
