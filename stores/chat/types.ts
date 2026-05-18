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

/* ── Job 추적 (supervisor 가 트리거한 비동기 doc-generate) ─────────── */

/**
 * - polling  : 진행 중
 * - done     : 정상 완료 (요청한 양식이 만들어짐)
 * - rejected : 백엔드가 done 으로 응답했지만, 요청한 양식(NCR/SIR 등)이 생성 거부되어
 *              일반 텍스트 보고서로 폴백된 경우. silent suppression 방지 차원에서 별도 phase.
 * - error    : 파이프라인 오류 / 타임아웃
 */
export type JobPhase = "polling" | "done" | "rejected" | "error";

export interface JobStatus {
  phase: JobPhase;
  startedAt: number;
  completedAt?: number;
  /** error 또는 rejected 시 사용자에게 노출할 사유. */
  reason?: string;
}

export interface JobsSlice {
  jobStatuses: Record<string, JobStatus>;
  /** 멱등 — 이미 추적 중이면 무시. 폴링 후 완료/오류 시 시스템 메시지 자동 push. */
  trackJob: (job: TriggeredJob) => void;
}

export type ChatStore = MessageSlice & InputSlice & MediaSlice & JobsSlice;
