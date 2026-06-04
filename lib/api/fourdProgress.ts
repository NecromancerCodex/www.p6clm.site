/**
 * 4D 워크유닛 실적 상태 API — 공정 진도율 보드.
 *
 * 대기/진행/완료 수동 관리 = 실적의 단일 소스. activity_code 키로 영속(재분석에도 보존).
 * Backend: CLM  GET/POST /api/v1/fourd/progress  (rewrite: /api/clm → /api/v1)
 */
const API_BASE = "/api/clm";

export type UnitStatus = "pending" | "active" | "done";

export interface ProgressUnit {
  id: number;
  activity_code: string | null;
  name: string | null;
  phase: string | null;
  match_source: string;
  zone: string | null;
  storey: string | null;
  package_key: string | null;
  start: string | null;
  end: string | null;
  status: UnitStatus;
}

/** 소유자의 최신 워크유닛 + 실적 상태 로드. */
export async function getUnitProgress(): Promise<ProgressUnit[]> {
  const res = await fetch(`${API_BASE}/fourd/progress`);
  if (!res.ok) throw new Error(`진도율 로드 실패 (${res.status})`);
  const j = await res.json();
  return (j.units ?? []) as ProgressUnit[];
}

/** 워크유닛 상태 upsert (activity_code 키). */
export async function saveUnitProgress(
  items: { activity_code: string; status: UnitStatus }[],
): Promise<void> {
  if (items.length === 0) return;
  const res = await fetch(`${API_BASE}/fourd/progress`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error(`진도율 저장 실패 (${res.status})`);
}
