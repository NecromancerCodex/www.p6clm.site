/**
 * 자원 계획 자재 API — 필요자재(BIM 추출) / 보유자재(재고) CRUD.
 *
 * Backend: CLM  /api/v1/materials  (rewrite: /api/clm → /api/v1).
 * 소유자 격리는 백엔드가 세션 쿠키(owner_user_id)로 처리 → 프론트는 키 안 보냄.
 */
const API_BASE = "/api/clm";

export type MaterialKind = "required" | "stock";

export interface Material {
  id: number;
  kind: MaterialKind;
  name: string;
  spec: string | null;
  unit: string;
  quantity: number;
  ifc_type: string | null;
  note: string | null;
}

export interface MaterialCreate {
  kind: MaterialKind;
  name: string;
  spec?: string;
  unit?: string;
  quantity?: number;
  note?: string;
}

export type MaterialPatch = Partial<Pick<Material, "name" | "spec" | "unit" | "quantity" | "note">>;

/** 소유자의 자재 전체(필요+보유). */
export async function listMaterials(): Promise<Material[]> {
  const res = await fetch(`${API_BASE}/materials`);
  if (!res.ok) throw new Error(`자재 로드 실패 (${res.status})`);
  const j = await res.json();
  return (j.items ?? []) as Material[];
}

/** 자재 1건 추가 → 생성된 행(id 포함) 반환. */
export async function createMaterial(m: MaterialCreate): Promise<Material> {
  const res = await fetch(`${API_BASE}/materials`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(m),
  });
  if (!res.ok) throw new Error(`자재 추가 실패 (${res.status})`);
  return (await res.json()) as Material;
}

/** 자재 1건 수정. */
export async function updateMaterial(id: number, patch: MaterialPatch): Promise<void> {
  const res = await fetch(`${API_BASE}/materials/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`자재 수정 실패 (${res.status})`);
}

/** 자재 1건 삭제. */
export async function deleteMaterial(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/materials/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`자재 삭제 실패 (${res.status})`);
}

export interface BimMaterial {
  name: string;
  spec?: string;
  unit?: string;
  quantity: number;
  ifc_type?: string;
}

/** BIM 추출 결과로 '필요 자재' 전체 교체 → 적재 건수 반환. */
export async function importRequiredFromBim(items: BimMaterial[]): Promise<number> {
  const res = await fetch(`${API_BASE}/materials/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error(`BIM 가져오기 실패 (${res.status})`);
  const j = await res.json();
  return (j.imported ?? 0) as number;
}
