import type { StateCreator } from "zustand";

import {
  deleteChatSession,
  getChatSession,
  listChatSessions,
} from "../../lib/api/chatSessions";
import type { ChatStore, Message, SessionSlice } from "./types";

export const createSessionSlice: StateCreator<ChatStore, [], [], SessionSlice> = (set, get) => ({
  currentSessionId: null,
  sessions: [],

  setSessionId: (id) => set({ currentSessionId: id }),

  loadSessions: async () => {
    try {
      const items = await listChatSessions(50);
      set({
        sessions: items.map((s) => ({
          id: s.id,
          title: s.title,
          message_count: s.message_count,
          updated_at: s.updated_at,
        })),
      });
    } catch {
      // 사이드바 목록 실패는 조용히 무시 (채팅 기능 자체엔 영향 없음)
    }
  },

  loadSession: async (id) => {
    try {
      const detail = await getChatSession(id);
      const messages: Message[] = detail.messages.map((m) => ({
        id: `db-${m.id}`,
        role: m.role,
        content: m.content,
        triggeredJob: (m.triggered_job as unknown as Message["triggeredJob"]) ?? undefined,
      }));
      set({ currentSessionId: id, messages });
    } catch {
      // 로드 실패 시 현재 대화 유지
    }
  },

  newChat: () => set({ currentSessionId: null, messages: [] }),

  deleteSession: async (id) => {
    try {
      await deleteChatSession(id);
    } catch {
      return;
    }
    const isCurrent = get().currentSessionId === id;
    set((s) => ({
      sessions: s.sessions.filter((x) => x.id !== id),
      ...(isCurrent ? { currentSessionId: null, messages: [] } : {}),
    }));
  },
});
