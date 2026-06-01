/**
 * 티링크 전화 내역 REST 클라이언트 (무전 STT 검증·감사용, admin 전용).
 *
 * Backend: /api/v1/tlink/calls (api/v1/tlink_endpoints.py)
 * Frontend proxy: /api/clm (next.config rewrite → /api/v1)
 *
 * 목적:
 *   ① 티링크 녹음이 STT 텍스트로 잘 변환·저장됐는지 확인
 *   ② 어떤 텍스트를 근거로 보고서가 작성됐는지 추적
 */

const API_BASE = "/api/clm";

export interface TranscriptSegment {
  time?: string;
  speaker?: string;
  text?: string;
}

export interface TlinkCallSummary {
  id: number;
  call_idx: number;
  member_name: string | null;
  guest_num: string | null;
  call_type: "in" | "out" | null;
  call_time_sec: number | null;
  b_date: string | null;
  stage: string;
  classifier_score: number | null;
  matched_keywords: string[];
  triggered_doc_type: string | null;
  triggered_doc_id: string | null;
  stt_title: string | null;
  stt_preview: string;
  has_stt: boolean;
  created_at: string | null;
}

export interface TlinkCallDetail extends TlinkCallSummary {
  member_id: string | null;
  e_date: string | null;
  stage_reason: string | null;
  group_id: string | null;
  stt_summary: string | null;
  stt_keywords: Array<{ keyword: string; count: number }>;
  transcript: TranscriptSegment[];
}

export async function listTlinkCalls(limit = 50): Promise<TlinkCallSummary[]> {
  const res = await fetch(`${API_BASE}/tlink/calls?limit=${limit}`, { cache: "no-store" });
  if (res.status === 403) throw new Error("관리자 전용 화면입니다.");
  if (!res.ok) throw new Error(`전화 내역 조회 실패 ${res.status}`);
  const data = await res.json();
  return data.items ?? [];
}

export async function getTlinkCall(id: number): Promise<TlinkCallDetail> {
  const res = await fetch(`${API_BASE}/tlink/calls/${id}`, { cache: "no-store" });
  if (res.status === 403) throw new Error("관리자 전용 화면입니다.");
  if (!res.ok) throw new Error(`전화 내역 상세 조회 실패 ${res.status}`);
  return res.json();
}

export async function deleteTlinkCall(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/tlink/calls/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`전화 내역 삭제 실패 ${res.status}`);
}
