/**
 * 정책기반 LLM 매칭 클라이언트 — 규칙으로 못 잡은 미매칭 그룹을
 * 백엔드(gpt-5-mini)에 보내 시공순서 지식으로 후보 활동에 연결.
 * 해당 없으면 activity_key=null → 연결 안 함(회색 유지).
 *
 * Backend: CLM FastAPI POST /api/v1/fourd/policy-match (/api/clm rewrite)
 */
import type { Candidate } from "./match";

export interface UnmatchedGroup {
  key: string;
  label: string;
  count: number;
  ifc_types: string[];
  names?: string[]; // 대표 부재명 — AI 별도/부속 구조 추론 신호
  storey: string | null;
  zone: string | null;
  reason: string;
}

export interface PolicyAssignment {
  group_key: string;
  activity_key: string | null;
  confidence: number;
  reason: string;
}

export async function policyMatch(
  unmatched: UnmatchedGroup[],
  activities: Candidate[],
): Promise<PolicyAssignment[]> {
  const res = await fetch("/api/clm/fourd/policy-match", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      unmatched,
      activities: activities.map((a) => ({
        key: a.key,
        name: a.name,
        zone: a.zone ?? null,
        storey: a.storey ?? null,
        wt: a.wt ?? null,
      })),
    }),
  });
  if (!res.ok) throw new Error(`정책매칭 실패 (${res.status})`);
  const data = (await res.json()) as { assignments: PolicyAssignment[] };
  return data.assignments ?? [];
}
