/**
 * DXF → 의미기반 토공 데이터 추출. 파일별로 카테고리(경계/등고선/파일/흙막이/시추위치)를
 * 자동 추천 + 사용자 확정. 여러 DXF(경계 따로·pile 따로 …)를 병합해 EarthworkData 로.
 * 좌표는 CAD 원좌표(X_cad) 그대로 — CSV export 가 X_cad 로 내보내 기존 파서와 호환.
 */
import { parseDxf, type DxfDoc, type DxfEntity } from "./dxfParse";
import { LAYERS, type Borehole, type TerrainPt, type PileItem, type WallLine, type EarthworkData } from "./model";

export type Category = "boundary" | "terrain" | "piles" | "walls" | "boreholes" | "ignore";

export const CATEGORY_LABEL: Record<Category, string> = {
  boundary: "대지경계",
  terrain: "등고선·지형",
  piles: "파일(Pile)",
  walls: "흙막이(CIP·벽)",
  boreholes: "시추공 위치",
  ignore: "무시",
};

const emptyT = (): Record<string, number> => Object.fromEntries(LAYERS.map((l) => [l.key, 0]));
const isPoly = (e: DxfEntity) => e.type === "LWPOLYLINE" || e.type === "POLYLINE";

/** 파일명·레이어·엔티티 구성으로 카테고리 자동 추천. */
export function detectCategory(doc: DxfDoc, filename = ""): Category {
  const name = (filename + " " + doc.layers.join(" ")).toLowerCase();
  const has = (...kw: string[]) => kw.some((k) => name.includes(k));
  if (has("경계", "boundary", "대지", "site", "bnd")) return "boundary";
  if (has("등고", "contour", "지형", "terrain", "elev", "표고")) return "terrain";
  if (has("pile", "파일", "말뚝", "phc", "phc")) return "piles";
  if (has("cip", "흙막이", "scw", "wall", "벽", "옹벽", "버팀")) return "walls";
  if (has("시추", "borehole", "주상도", "bh", "nh")) return "boreholes";

  // 이름 단서 없으면 엔티티 구성으로 추정
  const closed = doc.entities.filter((e) => e.type === "LWPOLYLINE" && e.closed).length;
  const inserts = doc.entities.filter((e) => e.type === "INSERT" || e.type === "CIRCLE").length;
  const texts = doc.entities.filter((e) => e.type === "TEXT" || e.type === "MTEXT").length;
  const withZ = doc.entities.filter((e) => isPoly(e) && (e.elevation || e.verts.some((v) => v.z))).length;
  if (inserts >= 3 && inserts >= texts) return "piles";
  if (withZ >= 2) return "terrain";
  if (closed >= 1) return "boundary";
  if (texts >= 2) return "boreholes";
  return "ignore";
}

const BH_LABEL = /\b([A-Z]{1,3}[-\s]?\d{1,3})\b/;

/** 한 DXF 에서 선택된 카테고리의 데이터만 추출 → EarthworkData 부분. */
export function extractCategory(doc: DxfDoc, cat: Category): Partial<EarthworkData> {
  if (cat === "boundary") {
    // 가장 큰 닫힌 폴리라인 우선, 없으면 정점 최다 폴리라인.
    const polys = doc.entities.filter(isPoly).filter((e) => e.verts.length >= 3);
    const closed = polys.filter((e) => e.closed);
    const pick = (closed.length ? closed : polys).sort((a, b) => area(b) - area(a))[0];
    if (!pick) return { boundary: [] };
    return { boundary: pick.verts.map((v) => ({ x: v.x, y: v.y })) };
  }
  if (cat === "terrain") {
    const pts: TerrainPt[] = [];
    for (const e of doc.entities) {
      if (isPoly(e)) {
        const z = e.elevation ?? 0;
        for (const v of e.verts) pts.push({ x: v.x, y: v.y, z: v.z || z });
      } else if (e.type === "POINT" && e.verts[0]) {
        pts.push({ x: e.verts[0].x, y: e.verts[0].y, z: e.verts[0].z });
      } else if ((e.type === "TEXT" || e.type === "MTEXT") && e.verts[0]) {
        const z = parseFloat((e.text || "").replace(/[^\d.\-]/g, ""));
        if (Number.isFinite(z)) pts.push({ x: e.verts[0].x, y: e.verts[0].y, z });
      }
    }
    return { terrain: pts.filter((p) => Number.isFinite(p.z)) };
  }
  if (cat === "piles") {
    const piles: PileItem[] = [];
    for (const e of doc.entities) {
      if (e.type === "INSERT" && e.verts[0]) piles.push({ kind: e.text || "Pile", x: e.verts[0].x, y: e.verts[0].y, dia: 0, length: 0 });
      else if (e.type === "CIRCLE" && e.verts[0]) piles.push({ kind: "Pile", x: e.verts[0].x, y: e.verts[0].y, dia: (e.radius || 0) * 2, length: 0 });
    }
    return { piles };
  }
  if (cat === "walls") {
    const walls: WallLine[] = doc.entities.filter(isPoly).filter((e) => e.verts.length >= 2)
      .map((e) => ({ kind: e.layer || "Wall", points: e.verts.map((v) => ({ x: v.x, y: v.y })) }));
    return { walls };
  }
  if (cat === "boreholes") {
    const bores: Borehole[] = [];
    const seen = new Set<string>();
    for (const e of doc.entities) {
      let id = "", x = 0, y = 0, ok = false;
      if ((e.type === "TEXT" || e.type === "MTEXT") && e.verts[0]) {
        const m = (e.text || "").match(BH_LABEL);
        if (m) { id = m[1].replace(/\s/g, ""); x = e.verts[0].x; y = e.verts[0].y; ok = true; }
      } else if (e.type === "INSERT" && e.verts[0]) {
        id = e.text || `BH-${bores.length + 1}`; x = e.verts[0].x; y = e.verts[0].y; ok = true;
      } else if (e.type === "POINT" && e.verts[0]) {
        id = `BH-${bores.length + 1}`; x = e.verts[0].x; y = e.verts[0].y; ok = true;
      }
      if (ok && !seen.has(id)) { seen.add(id); bores.push({ id, x, y, el: 0, depth: 0, gwl: 0, t: emptyT() }); }
    }
    return { boreholes: bores };
  }
  return {};
}

function area(e: DxfEntity): number {
  const p = e.verts; let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j].x + p[i].x) * (p[j].y - p[i].y);
  return Math.abs(a) / 2;
}

export interface FileImport { name: string; doc: DxfDoc; category: Category; }

/** DXF 텍스트 → FileImport(자동 카테고리 포함). */
export function readDxfFile(name: string, text: string): FileImport {
  const doc = parseDxf(text);
  return { name, doc, category: detectCategory(doc, name) };
}

/** 여러 파일(각자 확정 카테고리) → 병합 EarthworkData. */
export function mergeImports(files: FileImport[]): EarthworkData {
  const out: EarthworkData = { boreholes: [], terrain: [], boundary: [], piles: [], walls: [] };
  for (const f of files) {
    if (f.category === "ignore") continue;
    const part = extractCategory(f.doc, f.category);
    if (part.boreholes) out.boreholes.push(...part.boreholes);
    if (part.terrain) out.terrain.push(...part.terrain);
    if (part.piles) out.piles.push(...part.piles);
    if (part.walls) out.walls.push(...part.walls);
    if (part.boundary && part.boundary.length >= 3 && out.boundary.length === 0) out.boundary = part.boundary;
  }
  return out;
}
