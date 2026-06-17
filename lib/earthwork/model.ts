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

// ── 통합 토공 데이터 (add CSV ##섹션) ──
export interface TerrainPt { x: number; y: number; z: number; }
export interface PileItem { kind: string; x: number; y: number; dia: number; length: number; }
export interface EarthworkData {
  boreholes: Borehole[];
  terrain: TerrainPt[];
  boundary: { x: number; y: number }[];
  piles: PileItem[];
}

/** "##SECTION" 구분자로 텍스트를 섹션별 라인배열로 분리. */
function splitSections(text: string): Record<string, string[]> {
  const sec: Record<string, string[]> = {};
  let cur = "";
  for (const ln of text.split(/\r?\n/)) {
    const t = ln.trim();
    if (!t) continue;
    if (t.startsWith("##")) { cur = t.slice(2).toUpperCase(); sec[cur] = []; continue; }
    if (cur) sec[cur].push(ln);
  }
  return sec;
}

/**
 * add(AutoCAD) 통합 CSV 파싱 → 시추공+지형+경계+Pile.
 * ##섹션 없으면 일반 시추공 CSV로 폴백. 좌표계: ##섹션은 CAD 좌표(X_cad)로 통일.
 */
export function parseEarthworkCsv(text: string): EarthworkData {
  const data: EarthworkData = { boreholes: [], terrain: [], boundary: [], piles: [] };
  if (!text.includes("##")) {
    data.boreholes = parseBoreholeCsv(text);
    return data;
  }
  const sec = splitSections(text);
  const rows = (name: string) => {
    const block = sec[name];
    if (!block || block.length < 2) return [] as ((k: string) => string)[];
    const header = block[0].split(",").map((h) => h.trim());
    const hi: Record<string, number> = {};
    header.forEach((h, i) => (hi[h] = i));
    return block.slice(1).map((ln) => {
      const c = ln.split(",");
      return (k: string) => (hi[k] != null ? (c[hi[k]] ?? "").trim() : "");
    });
  };
  const f = (s: string) => parseFloat(s);

  for (const g of rows("BOREHOLES")) {
    const id = g("borehole");
    if (!id) continue;
    const xc = f(g("X_cad")), yc = f(g("Y_cad"));
    const x = Number.isFinite(xc) && xc !== 0 ? xc : f(g("X")); // CAD 좌표 우선(통일), 없으면 측량
    const y = Number.isFinite(yc) && yc !== 0 ? yc : f(g("Y"));
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const t: Record<string, number> = {};
    for (const L of LAYERS) t[L.key] = _orZero(f(g(L.key)));
    data.boreholes.push({
      id, x, y, el: _orZero(f(g("surface_EL"))), depth: _orZero(f(g("drill_depth"))),
      gwl: _orZero(f(g("gwl_GL"))), t,
    });
  }
  for (const g of rows("TERRAIN")) {
    const x = f(g("X_cad")), y = f(g("Y_cad")), z = f(g("Z"));
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) data.terrain.push({ x, y, z });
  }
  for (const g of rows("BOUNDARY")) {
    const x = f(g("X_cad")), y = f(g("Y_cad"));
    if (Number.isFinite(x) && Number.isFinite(y)) data.boundary.push({ x, y });
  }
  for (const g of rows("PILES")) {
    const x = f(g("X_cad")), y = f(g("Y_cad"));
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    data.piles.push({ kind: g("kind") || "Pile", x, y, dia: _orZero(f(g("dia_m"))), length: _orZero(f(g("length_m"))) });
  }
  return data;
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

/**
 * 층별 토공 물량(m³) — 격자 셀별 평균두께 × 셀면적 적분.
 * clipLocal: 대지경계선(로컬좌표 x-minX,y-minY) 주면 셀 중심이 경계 안인 셀만 합산(부지 내부만).
 */
export function layerVolumes(g: GridModel, clipLocal?: { x: number; y: number }[]): LayerVolume[] {
  const clip = clipLocal && clipLocal.length >= 3 ? clipLocal : null;
  const out: LayerVolume[] = [];
  for (let m = 0; m < LAYERS.length; m++) {
    const top = g.ifaces[m];
    const bot = g.ifaces[m + 1];
    let vol = 0;
    for (let iy = 0; iy < g.ny - 1; iy++) {
      for (let ix = 0; ix < g.nx - 1; ix++) {
        if (clip) {
          const cx = (g.lx[ix] + g.lx[ix + 1]) / 2;
          const cy = (g.ly[iy] + g.ly[iy + 1]) / 2;
          if (!pointInPoly(clip, cx, cy)) continue; // 경계 밖 셀 제외
        }
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

/** 점(px,py)이 폴리곤 내부인지 — ray casting. */
export function pointInPoly(poly: { x: number; y: number }[], px: number, py: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 폴리곤 면적(m²) — shoelace. */
export function polygonArea(poly: { x: number; y: number }[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  }
  return Math.abs(a) / 2;
}

// ── 등고선 생성 (표고점 → IDW 격자 → 마칭스퀘어) ── add ContourCommand 포팅.
export interface Contour { z: number; major: boolean; points: { x: number; y: number }[]; }

/** nearest-16 IDW(power=2). 최근접점이 maxDist 밖이면 NaN(외삽 방지). */
function idwZ(x: number, y: number, pts: TerrainPt[], maxDist: number): number {
  const n = Math.min(16, pts.length);
  const d2 = new Array<number>(n).fill(Infinity);
  const zz = new Array<number>(n).fill(0);
  for (const p of pts) {
    const dd = (x - p.x) ** 2 + (y - p.y) ** 2;
    if (dd < 1e-10) return p.z;
    let mi = 0;
    for (let i = 1; i < n; i++) if (d2[i] > d2[mi]) mi = i;
    if (dd < d2[mi]) { d2[mi] = dd; zz[mi] = p.z; }
  }
  let minD2 = Infinity;
  for (let i = 0; i < n; i++) if (d2[i] < minD2) minD2 = d2[i];
  if (maxDist > 0 && minD2 > maxDist * maxDist) return NaN;
  let sw = 0, swz = 0;
  for (let i = 0; i < n; i++) {
    if (d2[i] === Infinity) continue;
    const w = 1 / d2[i]; // power 2
    sw += w; swz += w * zz[i];
  }
  return sw > 0 ? swz / sw : NaN;
}

/** 한 레벨의 마칭스퀘어 선분 [x1,y1,x2,y2]. */
function contourSegments(grid: Float64Array, W: number, nx: number, ny: number,
  minX: number, minY: number, dx: number, dy: number, level: number): number[][] {
  const res: number[][] = [];
  const edge = (a: number, b: number, ax: number, bx: number) =>
    Math.abs(b - a) < 1e-10 ? (ax + bx) * 0.5 : ax + ((bx - ax) * (level - a)) / (b - a);
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const vbl = grid[iy * W + ix], vbr = grid[iy * W + ix + 1];
      const vtr = grid[(iy + 1) * W + ix + 1], vtl = grid[(iy + 1) * W + ix];
      if (Number.isNaN(vbl) || Number.isNaN(vbr) || Number.isNaN(vtr) || Number.isNaN(vtl)) continue;
      const c = (vbl >= level ? 1 : 0) | (vbr >= level ? 2 : 0) | (vtr >= level ? 4 : 0) | (vtl >= level ? 8 : 0);
      if (c === 0 || c === 15) continue;
      const x0 = minX + ix * dx, y0 = minY + iy * dy;
      const bx2 = edge(vbl, vbr, x0, x0 + dx), by2 = y0;
      const rx = x0 + dx, ry = edge(vbr, vtr, y0, y0 + dy);
      const tx = edge(vtl, vtr, x0, x0 + dx), ty = y0 + dy;
      const lx = x0, ly = edge(vbl, vtl, y0, y0 + dy);
      switch (c) {
        case 1: case 14: res.push([lx, ly, bx2, by2]); break;
        case 2: case 13: res.push([bx2, by2, rx, ry]); break;
        case 3: case 12: res.push([lx, ly, rx, ry]); break;
        case 4: case 11: res.push([rx, ry, tx, ty]); break;
        case 6: case 9: res.push([bx2, by2, tx, ty]); break;
        case 7: case 8: res.push([lx, ly, tx, ty]); break;
        case 5:
          if (vbl + vtr < vbr + vtl) { res.push([lx, ly, tx, ty]); res.push([bx2, by2, rx, ry]); }
          else { res.push([lx, ly, bx2, by2]); res.push([rx, ry, tx, ty]); }
          break;
        case 10:
          if (vbl + vtr >= vbr + vtl) { res.push([lx, ly, tx, ty]); res.push([bx2, by2, rx, ry]); }
          else { res.push([lx, ly, bx2, by2]); res.push([rx, ry, tx, ty]); }
          break;
      }
    }
  }
  return res;
}

/** 끝점이 맞닿는 선분들을 이어 폴리선으로. */
function chainSegments(segs: number[][]): { x: number; y: number }[][] {
  const TOL = 1e-6;
  const used = new Array<boolean>(segs.length).fill(false);
  const out: { x: number; y: number }[][] = [];
  const endMap = new Map<string, number[]>();
  const key = (x: number, y: number) => `${Math.round(x / TOL)},${Math.round(y / TOL)}`;
  const add = (k: string, i: number) => { const l = endMap.get(k); if (l) l.push(i); else endMap.set(k, [i]); };
  for (let i = 0; i < segs.length; i++) { add(key(segs[i][0], segs[i][1]), i); add(key(segs[i][2], segs[i][3]), i); }
  const pick = (k: string): number => {
    const cs = endMap.get(k); if (!cs) return -1;
    for (const ci of cs) if (!used[ci]) return ci;
    return -1;
  };
  for (let s = 0; s < segs.length; s++) {
    if (used[s]) continue;
    used[s] = true;
    const chain = [{ x: segs[s][0], y: segs[s][1] }, { x: segs[s][2], y: segs[s][3] }];
    for (;;) {
      const t = chain[chain.length - 1];
      const nx2 = pick(key(t.x, t.y));
      if (nx2 < 0) break;
      used[nx2] = true;
      const [a, b, c, d] = segs[nx2];
      chain.push(Math.abs(a - t.x) < TOL && Math.abs(b - t.y) < TOL ? { x: c, y: d } : { x: a, y: b });
    }
    for (;;) {
      const h = chain[0];
      const nx2 = pick(key(h.x, h.y));
      if (nx2 < 0) break;
      used[nx2] = true;
      const [a, b, c, d] = segs[nx2];
      chain.unshift(Math.abs(c - h.x) < TOL && Math.abs(d - h.y) < TOL ? { x: a, y: b } : { x: c, y: d });
    }
    out.push(chain);
  }
  return out;
}

/** 표고점 → 등고선 폴리선들. interval=간격(m), majorEvery=주곡선 주기. */
export function generateContours(terrain: TerrainPt[], interval = 1.0, majorEvery = 5): Contour[] {
  if (terrain.length < 3 || interval <= 0) return [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of terrain) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  let nx = Math.min(Math.ceil((maxX - minX) / (span / 200)), 500);
  let ny = Math.min(Math.ceil((maxY - minY) / (span / 200)), 500);
  nx = Math.max(nx, 10); ny = Math.max(ny, 10);
  const dx = (maxX - minX) / nx, dy = (maxY - minY) / ny;
  const maxDist = Math.sqrt(((maxX - minX) * (maxY - minY)) / terrain.length) * 3.0;

  const W = nx + 1;
  let grid = new Float64Array(W * (ny + 1));
  for (let iy = 0; iy <= ny; iy++)
    for (let ix = 0; ix <= nx; ix++)
      grid[iy * W + ix] = idwZ(minX + ix * dx, minY + iy * dy, terrain, maxDist);

  // 3×3 스무딩 1회
  const sm = new Float64Array(W * (ny + 1));
  for (let iy = 0; iy <= ny; iy++)
    for (let ix = 0; ix <= nx; ix++) {
      let sum = 0, cnt = 0;
      for (let ky = -1; ky <= 1; ky++)
        for (let kx = -1; kx <= 1; kx++) {
          const gx = ix + kx, gy = iy + ky;
          if (gx >= 0 && gx <= nx && gy >= 0 && gy <= ny) {
            const v = grid[gy * W + gx];
            if (!Number.isNaN(v)) { sum += v; cnt++; }
          }
        }
      sm[iy * W + ix] = cnt > 0 ? sum / cnt : NaN;
    }
  grid = sm;

  let gMin = Infinity, gMax = -Infinity;
  for (let i = 0; i < grid.length; i++) { const v = grid[i]; if (!Number.isNaN(v)) { if (v < gMin) gMin = v; if (v > gMax) gMax = v; } }
  if (!Number.isFinite(gMin)) return [];
  const startZ = Math.ceil(gMin / interval) * interval;
  const endZ = Math.floor(gMax / interval) * interval;

  const out: Contour[] = [];
  for (let z = startZ; z <= endZ + 1e-9; z += interval) {
    const major = Math.abs(Math.round(z / interval) % majorEvery) < 1e-6;
    const chains = chainSegments(contourSegments(grid, W, nx, ny, minX, minY, dx, dy, z));
    for (const ch of chains) if (ch.length >= 2) out.push({ z: Math.round(z * 1000) / 1000, major, points: ch });
  }
  return out;
}
