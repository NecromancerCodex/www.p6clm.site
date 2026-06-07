/**
 * 토공 시추공 영속화 API — CSV 업로드 데이터를 DB에 저장(소유자별, 최신만 유지).
 * Backend: CLM  /api/v1/earthwork  (rewrite: /api/clm → /api/v1).
 */
import type { Borehole } from "../earthwork/model";

const API_BASE = "/api/clm";

interface ApiBorehole {
  name: string;
  x: number;
  y: number;
  surface_el: number;
  drill_depth: number;
  gwl: number;
  thickness: Record<string, number>;
}

const toWeb = (a: ApiBorehole): Borehole => ({
  id: a.name, x: a.x, y: a.y, el: a.surface_el, depth: a.drill_depth, gwl: a.gwl, t: a.thickness ?? {},
});
const toApi = (b: Borehole): ApiBorehole => ({
  name: b.id, x: b.x, y: b.y, surface_el: b.el, drill_depth: b.depth, gwl: b.gwl, thickness: b.t,
});

/** 저장된 시추공 로드 (없거나 백엔드 미가동이면 빈 배열). */
export async function loadBoreholes(): Promise<Borehole[]> {
  try {
    const res = await fetch(`${API_BASE}/earthwork/boreholes`);
    if (!res.ok) return [];
    const j = await res.json();
    return (j.boreholes ?? []).map(toWeb);
  } catch {
    return [];
  }
}

/** CSV 업로드 데이터 저장 — 기존 행 교체(최신만 유지). 적재 건수 반환. */
export async function saveBoreholes(boreholes: Borehole[]): Promise<number> {
  const res = await fetch(`${API_BASE}/earthwork/boreholes/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ boreholes: boreholes.map(toApi) }),
  });
  if (!res.ok) throw new Error(`시추공 저장 실패 (${res.status})`);
  const j = await res.json();
  return (j.imported ?? 0) as number;
}
