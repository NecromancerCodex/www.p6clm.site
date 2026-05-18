import type { StateCreator } from "zustand";

import { labelForDocType } from "../../lib/docLabels";
import type { ChatStore, JobStatus, JobsSlice, Message, TriggeredJob } from "./types";

const API_BASE = "/api/clm";
const POLL_INTERVAL_MS = 2500;
const POLL_MAX_ATTEMPTS = 240;

/** doc_type 별로 "정상 완료"가 되려면 result 에 있어야 하는 양식 객체. */
const REQUIRED_RESULT_KEY: Record<string, "ncr" | "safety_inspection"> = {
  defect_report: "ncr",
  safety_inspect: "safety_inspection",
};

interface JobResult {
  steps_taken?: string[];
  ncr?: unknown;
  safety_inspection?: unknown;
  final_response?: string;
  alert?: string | null;
  /** 백엔드가 명시적으로 거부 사유를 넣어주는 경우. */
  rejected_reason?: string;
}

function appendAssistant(content: string, idPrefix: string, jobId: string): Message {
  return {
    id: `${idPrefix}-${jobId}`,
    role: "assistant",
    content,
  };
}

/**
 * 백엔드가 status=done 으로 돌려줘도, 요청한 양식이 실제로 만들어졌는지 검증한다.
 * defect_report / safety_inspect 처럼 구조화 양식을 요구하는 doc_type 의 경우,
 * 해당 객체가 result 에 없으면 "rejected" 로 분류한다 (예: YOLO 안전 라벨만 탐지 → NCR 거부).
 */
function classifyDone(docType: string, result: JobResult): { phase: "done" | "rejected"; reason?: string } {
  const requiredKey = REQUIRED_RESULT_KEY[docType];
  if (!requiredKey) return { phase: "done" };

  const payload = result[requiredKey];
  if (payload && typeof payload === "object") return { phase: "done" };

  // 백엔드가 명시적인 사유를 줬으면 그대로, 아니면 alert 필드 또는 기본 문구
  const reason =
    result.rejected_reason ||
    (result.alert && typeof result.alert === "string" ? result.alert.replace(/[⚠✦]/g, "").trim() : "") ||
    "요청한 양식 생성이 거부되어 일반 보고서로 대체되었습니다.";
  return { phase: "rejected", reason };
}

export const createJobsSlice: StateCreator<ChatStore, [], [], JobsSlice> = (set, get) => ({
  jobStatuses: {},

  trackJob: (job: TriggeredJob) => {
    const { jobStatuses } = get();
    if (jobStatuses[job.job_id]) return; // 멱등

    set({
      jobStatuses: {
        ...jobStatuses,
        [job.job_id]: { phase: "polling", startedAt: Date.now() },
      },
    });

    const updateStatus = (next: Partial<JobStatus>) => {
      const cur = get().jobStatuses[job.job_id];
      set({
        jobStatuses: {
          ...get().jobStatuses,
          [job.job_id]: { ...cur, ...next },
        },
      });
    };

    const pushSystemMessage = (content: string, idPrefix: string) => {
      set((s) => ({
        messages: [...s.messages, appendAssistant(content, idPrefix, job.job_id)],
      }));
    };

    const poll = async () => {
      const docLabel = labelForDocType(job.doc_type);

      for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        let res: Response;
        try {
          res = await fetch(`${API_BASE}/job/${job.job_id}`);
        } catch {
          continue;
        }
        if (!res.ok) continue;

        const data = await res.json().catch(() => null);
        if (!data) continue;

        if (data.status === "done") {
          const result: JobResult = data.result ?? {};
          const { phase, reason } = classifyDone(job.doc_type, result);

          if (phase === "done") {
            updateStatus({ phase: "done", completedAt: Date.now() });
            pushSystemMessage(
              `✓ **${docLabel}** 작성이 완료되었습니다. \`/progress\` 페이지에서 결과를 확인하세요.`,
              "done"
            );
          } else {
            updateStatus({ phase: "rejected", reason, completedAt: Date.now() });
            pushSystemMessage(
              `⚠ **${docLabel}** 양식 생성이 거부되었습니다. ${reason ? `사유: ${reason} ` : ""}일반 보고서로 대체되어 \`/progress\` 에 저장되었습니다.`,
              "rejected"
            );
          }
          return;
        }

        if (data.status === "error") {
          const errMsg = data.error ?? "알 수 없는 오류";
          updateStatus({ phase: "error", reason: errMsg, completedAt: Date.now() });
          pushSystemMessage(`✗ **${docLabel}** 작성 중 오류가 발생했습니다: ${errMsg}`, "err");
          return;
        }
      }

      updateStatus({
        phase: "error",
        reason: "처리 시간이 초과되었습니다 (10분)",
        completedAt: Date.now(),
      });
      pushSystemMessage(
        `✗ **${labelForDocType(job.doc_type)}** 처리 시간이 초과되었습니다. /progress 페이지에서 상태를 확인하세요.`,
        "timeout"
      );
    };

    void poll();
  },
});
