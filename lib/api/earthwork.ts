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

/** 토공 extra(경계·Pile·흙막이·지형) — 백엔드 JSONB 그대로 통과. */
export interface EarthworkExtra {
  terrain?: unknown[];
  boundary?: unknown[];
  piles?: unknown[];
  walls?: unknown[];
}

/** 저장된 시추공 + extra 로드 (없거나 백엔드 미가동이면 빈 값). */
export async function loadEarthwork(): Promise<{ boreholes: Borehole[]; extra: EarthworkExtra }> {
  try {
    const res = await fetch(`${API_BASE}/earthwork/boreholes`);
    if (!res.ok) return { boreholes: [], extra: {} };
    const j = await res.json();
    return { boreholes: (j.boreholes ?? []).map(toWeb), extra: (j.extra ?? {}) as EarthworkExtra };
  } catch {
    return { boreholes: [], extra: {} };
  }
}

/** (호환) 시추공만 로드 — fourd·물량패널 등 extra 불필요한 곳. */
export async function loadBoreholes(): Promise<Borehole[]> {
  return (await loadEarthwork()).boreholes;
}

/** CAD 레이어 의미 분류 (gpt-5-mini) — {레이어명: 카테고리}. 실패 시 {} (클라 규칙기반 폴백). */
export interface CadLayerMeta { name: string; types: string; samples: string[]; }
export async function classifyCadLayers(layers: CadLayerMeta[]): Promise<Record<string, string>> {
  if (!layers.length) return {};
  try {
    const res = await fetch(`${API_BASE}/earthwork/cad/classify-layers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layers }),
    });
    if (!res.ok) return {};
    return (await res.json()) as Record<string, string>;
  } catch {
    return {};
  }
}

/** CSV 업로드 데이터 저장 — 시추+extra 기존 행 교체(최신만 유지, owner 개인화). 적재 건수 반환. */
export async function saveEarthwork(boreholes: Borehole[], extra: EarthworkExtra): Promise<number> {
  const res = await fetch(`${API_BASE}/earthwork/boreholes/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ boreholes: boreholes.map(toApi), extra }),
  });
  if (!res.ok) throw new Error(`토공 모델 저장 실패 (${res.status})`);
  const j = await res.json();
  return (j.imported ?? 0) as number;
}
