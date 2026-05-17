/**
 * chatStore 공통 타입
 *
 * 슬라이스(messageSlice / inputSlice / mediaSlice)가 공유하는
 * 도메인 모델 및 통합 스토어 타입.
 */

export interface TriggeredJob {
  job_id: string;
  doc_type: string;
  doc_category: string;
  project_name: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  imageUrl?: string;
  triggeredJob?: TriggeredJob;
}

export interface MessageSlice {
  messages: Message[];
  isLoading: boolean;
  clearMessages: () => void;
  sendMessage: () => Promise<void>;
}

export interface InputSlice {
  input: string;
  setInput: (input: string) => void;
}

export interface MediaSlice {
  pendingImage: File | null;
  pendingImagePreview: string | null;
  setPendingImage: (file: File | null) => void;
  clearPendingImage: () => void;
}

export type ChatStore = MessageSlice & InputSlice & MediaSlice;
