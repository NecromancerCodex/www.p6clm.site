import type { StateCreator } from "zustand";

import { labelForDocType } from "../../lib/docLabels";
import type { ChatStore, JobsSlice, Message, TriggeredJob } from "./types";

const API_BASE = "/api/clm";
const POLL_INTERVAL_MS = 2500;
const POLL_MAX_ATTEMPTS = 240;

function appendAssistant(content: string, idPrefix: string, jobId: string): Message {
  return {
    id: `${idPrefix}-${jobId}`,
    role: "assistant",
    content,
  };
}

export const createJobsSlice: StateCreator<ChatStore, [], [], JobsSlice> = (set, get) => ({
  jobStatuses: {},

  trackJob: (job: TriggeredJob) => {
    const { jobStatuses } = get();
    if (jobStatuses[job.job_id]) return; // 이미 추적 중 → 멱등

    set({
      jobStatuses: {
        ...jobStatuses,
        [job.job_id]: { phase: "polling", startedAt: Date.now() },
      },
    });

    const updateStatus = (next: Partial<typeof jobStatuses[string]>) => {
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
          updateStatus({ phase: "done", completedAt: Date.now() });
          pushSystemMessage(
            `✓ **${docLabel}** 작성이 완료되었습니다. \`/progress\` 페이지에서 결과를 확인하세요.`,
            "done"
          );
          return;
        }
        if (data.status === "error") {
          const errMsg = data.error ?? "알 수 없는 오류";
          updateStatus({ phase: "error", error: errMsg, completedAt: Date.now() });
          pushSystemMessage(`✗ **${docLabel}** 작성 중 오류가 발생했습니다: ${errMsg}`, "err");
          return;
        }
      }

      updateStatus({ phase: "error", error: "처리 시간이 초과되었습니다 (10분)", completedAt: Date.now() });
      pushSystemMessage(
        `✗ **${labelForDocType(job.doc_type)}** 처리 시간이 초과되었습니다. /progress 페이지에서 상태를 확인하세요.`,
        "timeout"
      );
    };

    void poll();
  },
});
