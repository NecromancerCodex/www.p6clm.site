/**
 * 채팅 세션 REST 클라이언트 (Phase 3C).
 *
 * Backend: /api/v1/chat/sessions (api/v1/chat_sessions.py)
 * Frontend proxy: /api/clm (next.config rewrite → /api/v1)
 */

const API_BASE = "/api/clm";

export interface ChatSessionSummary {
  id: number;
  title: string | null;
  project_name: string | null;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export interface ChatMessageRead {
  id: number;
  role: "user" | "assistant";
  content: string;
  triggered_job: Record<string, unknown> | null;
  image_ref: string | null;
  created_at: string;
}

export interface ChatSessionDetail {
  id: number;
  title: string | null;
  project_name: string | null;
  messages: ChatMessageRead[];
}

export async function listChatSessions(limit = 50): Promise<ChatSessionSummary[]> {
  const res = await fetch(`${API_BASE}/chat/sessions?limit=${limit}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`세션 목록 조회 실패 ${res.status}`);
  const data = await res.json();
  return data.items ?? [];
}

export async function getChatSession(id: number): Promise<ChatSessionDetail> {
  const res = await fetch(`${API_BASE}/chat/sessions/${id}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`세션 조회 실패 ${res.status}`);
  return res.json();
}

export async function deleteChatSession(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/chat/sessions/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`세션 삭제 실패 ${res.status}`);
}

export async function renameChatSession(id: number, title: string): Promise<ChatSessionSummary> {
  const res = await fetch(`${API_BASE}/chat/sessions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`세션 제목 수정 실패 ${res.status}`);
  return res.json();
}
