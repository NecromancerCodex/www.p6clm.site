/**
 * chatStore — ConstructBot 대화 상태 (Zustand)
 *
 * 관리 항목:
 *   - messages   : 대화 히스토리 (이미지 URL 포함 가능)
 *   - input      : 텍스트 입력창 값
 *   - isLoading  : AI 응답 대기 여부
 *   - pendingImage: 첨부 대기 중인 이미지 파일
 */
import { create } from "zustand";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  imageUrl?: string; // 사용자가 업로드한 이미지 미리보기 URL
}

interface ChatState {
  messages: Message[];
  input: string;
  isLoading: boolean;
  pendingImage: File | null;
  pendingImagePreview: string | null;
}

interface ChatActions {
  setInput: (input: string) => void;
  setPendingImage: (file: File | null) => void;
  clearPendingImage: () => void;
  sendMessage: () => Promise<void>;
  clearMessages: () => void;
}

export const useChatStore = create<ChatState & ChatActions>((set, get) => ({
  /* ── state ── */
  messages: [],
  input: "",
  isLoading: false,
  pendingImage: null,
  pendingImagePreview: null,

  /* ── actions ── */
  setInput: (input) => set({ input }),

  setPendingImage: (file) => {
    if (!file) {
      set({ pendingImage: null, pendingImagePreview: null });
      return;
    }
    const preview = URL.createObjectURL(file);
    set({ pendingImage: file, pendingImagePreview: preview });
  },

  clearPendingImage: () => {
    const { pendingImagePreview } = get();
    if (pendingImagePreview) URL.revokeObjectURL(pendingImagePreview);
    set({ pendingImage: null, pendingImagePreview: null });
  },

  clearMessages: () => set({ messages: [] }),

  sendMessage: async () => {
    const { input, messages, isLoading, pendingImage, pendingImagePreview } = get();
    const text = input.trim();
    // 텍스트 없이 이미지만 보내는 경우도 허용 (기존: !text 이면 무조건 return → 첨부만으로 전송 불가)
    if ((!text && !pendingImage) || isLoading) return;

    const defaultCaption = "첨부 이미지를 분석해 주세요.";
    const outboundMessage = text || defaultCaption;

    // 사용자 메시지 즉시 표시
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
        // 이미지 첨부 → multipart 엔드포인트
        const form = new FormData();
        form.append("message", outboundMessage);
        form.append("history_json", JSON.stringify(historyPayload));
        form.append("image", pendingImage);
        res = await fetch("/api/cbot/chat/image", { method: "POST", body: form });
      } else {
        // 텍스트만 → JSON 엔드포인트
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
}));
