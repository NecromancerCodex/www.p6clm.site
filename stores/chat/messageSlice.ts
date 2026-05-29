import type { StateCreator } from "zustand";

import type { ChatStore, Message, MessageSlice } from "./types";

// 진행 중 요청의 AbortController — 모듈 스코프(직렬화 불필요, 반응성 불필요).
// cancelMessage 가 abort, sendMessage 가 생성/정리.
let activeController: AbortController | null = null;

export const createMessageSlice: StateCreator<ChatStore, [], [], MessageSlice> = (set, get) => ({
  messages: [],
  isLoading: false,

  clearMessages: () => set({ messages: [] }),

  cancelMessage: () => {
    if (activeController) {
      activeController.abort();
      activeController = null;
    }
    // sendMessage 의 finally 도 isLoading 을 내리지만, 즉각 UX 위해 여기서도 해제.
    set({ isLoading: false });
  },

  sendMessage: async (overrideText?: string) => {
    const { input, messages, isLoading, pendingImage, pendingImagePreview } = get();
    // overrideText 우선 — VoiceMicButton 같이 setInput 직후 호출하는 경로의 race 회피.
    const text = (overrideText ?? input).trim();
    if ((!text && !pendingImage) || isLoading) return;

    const defaultCaption = "첨부 이미지를 분석해 주세요.";
    const outboundMessage = text || defaultCaption;

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text || "(이미지)",
      imageUrl: pendingImagePreview ?? undefined,
    };

    set({
      messages: [...messages, userMsg],
      input: "",
      isLoading: true,
      pendingImage: null,
      pendingImagePreview: null,
    });

    // 요청별 AbortController — 취소 버튼이 이걸 abort.
    const controller = new AbortController();
    activeController = controller;

    try {
      let res: Response;
      const historyPayload = messages.map(({ role, content }) => ({ role, content }));

      if (pendingImage) {
        const form = new FormData();
        form.append("message", outboundMessage);
        form.append("history_json", JSON.stringify(historyPayload));
        form.append("image", pendingImage);
        // 세션 영속화 — 텍스트 경로와 동일. null 이면 미전송(백엔드가 새 세션 생성).
        const _sid = get().currentSessionId;
        if (_sid != null) form.append("session_id", String(_sid));
        res = await fetch("/api/cbot/chat/image", {
          method: "POST",
          body: form,
          signal: controller.signal,
        });
      } else {
        res = await fetch("/api/cbot/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // session_id 동봉 — 백엔드가 영속화 후 (신규면 새 id) 반환.
          body: JSON.stringify({
            message: text,
            history: historyPayload,
            session_id: get().currentSessionId,
          }),
          signal: controller.signal,
        });
      }

      if (!res.ok) throw new Error(`서버 오류 ${res.status}`);

      const data = await res.json();
      const assistantMsg: Message = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: data.response ?? "응답을 받지 못했습니다.",
        triggeredJob: data.triggered_job ?? undefined,
      };
      set((s) => ({ messages: [...s.messages, assistantMsg] }));
      // 세션 id 갱신(신규 생성 시) + 사이드바 목록 새로고침.
      if (typeof data.session_id === "number") {
        set({ currentSessionId: data.session_id });
        void get().loadSessions();
      }
    } catch (err) {
      // 사용자 취소(abort)는 오류가 아님 — 조용한 시스템 메시지로 구분.
      if (controller.signal.aborted) {
        set((s) => ({
          messages: [
            ...s.messages,
            { id: `c-${Date.now()}`, role: "assistant", content: "⏹ 요청을 취소했습니다." },
          ],
        }));
      } else {
        set((s) => ({
          messages: [
            ...s.messages,
            {
              id: `e-${Date.now()}`,
              role: "assistant",
              content: `오류: ${err instanceof Error ? err.message : "알 수 없는 오류"}`,
            },
          ],
        }));
      }
    } finally {
      if (activeController === controller) activeController = null;
      set({ isLoading: false });
    }
  },
});
