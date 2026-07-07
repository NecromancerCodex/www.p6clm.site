/**
 * EarthworkData → ##섹션 CSV (addin 이 만들던 포맷과 동일).
 * 생성 CSV 를 기존 parseEarthworkCsv 에 넣으면 그대로 작동 = 성공 기준.
 * 좌표는 X_cad/Y_cad 로 내보냄(원 CAD 좌표).
 */
import { LAYERS, type EarthworkData } from "./model";

const n = (v: number) => (Number.isFinite(v) ? +(+v).toFixed(3) : 0);

export function earthworkToCsv(d: EarthworkData): string {
  const out: string[] = [];

  // ── 시추공 (위치만; 지층 두께는 수동 입력분이 있으면 반영) ──
  out.push("##BOREHOLES");
  out.push(["borehole", "X_cad", "Y_cad", "surface_EL", "drill_depth", "gwl_GL", ...LAYERS.map((l) => l.key)].join(","));
  for (const b of d.boreholes) {
    out.push([
      b.id, n(b.x), n(b.y), n(b.el), n(b.depth), n(b.gwl),
      ...LAYERS.map((l) => n(b.t?.[l.key] ?? 0)),
    ].join(","));
  }

  // ── 대지경계선 ──
  out.push("##BOUNDARY");
  out.push("p_id,type,X_cad,Y_cad");
  d.boundary.forEach((p, i) => out.push([i + 1, "경계", n(p.x), n(p.y)].join(",")));

  // ── 파일 ──
  out.push("##PILES");
  out.push("p_id,kind,X_cad,Y_cad,dia_m,length_m");
  d.piles.forEach((p, i) => out.push([i + 1, p.kind || "Pile", n(p.x), n(p.y), n(p.dia), n(p.length)].join(",")));

  // ── 흙막이 벽 (w_id 별 폴리선) ──
  out.push("##WALLS");
  out.push("w_id,kind,X_cad,Y_cad");
  d.walls.forEach((w, wi) => {
    for (const pt of w.points) out.push([wi + 1, w.kind || "Wall", n(pt.x), n(pt.y)].join(","));
  });

  // ── 지형 표고점 ──
  out.push("##TERRAIN");
  out.push("p_id,X_cad,Y_cad,Z");
  d.terrain.forEach((p, i) => out.push([i + 1, n(p.x), n(p.y), n(p.z)].join(",")));

  return out.join("\n") + "\n";
}
