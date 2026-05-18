import type { StateCreator } from "zustand";

import type { ChatStore, Message, MessageSlice } from "./types";

export const createMessageSlice: StateCreator<ChatStore, [], [], MessageSlice> = (set, get) => ({
  messages: [],
  isLoading: false,

  clearMessages: () => set({ messages: [] }),

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

    try {
      let res: Response;
      const historyPayload = messages.map(({ role, content }) => ({ role, content }));

      if (pendingImage) {
        const form = new FormData();
        form.append("message", outboundMessage);
        form.append("history_json", JSON.stringify(historyPayload));
        form.append("image", pendingImage);
        res = await fetch("/api/cbot/chat/image", { method: "POST", body: form });
      } else {
        res = await fetch("/api/cbot/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, history: historyPayload }),
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
    } catch (err) {
      const errMsg: Message = {
        id: `e-${Date.now()}`,
        role: "assistant",
        content: `오류: ${err instanceof Error ? err.message : "알 수 없는 오류"}`,
      };
      set((s) => ({ messages: [...s.messages, errMsg] }));
    } finally {
      set({ isLoading: false });
    }
  },
});
