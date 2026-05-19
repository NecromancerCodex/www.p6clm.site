import type { StateCreator } from "zustand";

import {
  createDocument,
  createDocumentWithFile,
  getJob,
  DocumentApiError,
} from "../../lib/api/documents";
import type { DocStore, GenerateSlice } from "./types";

const POLL_INTERVAL_MS = 2500;
const POLL_MAX_ATTEMPTS = 240;

const INITIAL_RESULT = {
  status: "idle" as const,
  ncrResult: null,
  sirResult: null,
  rawResult: "",
  errorMsg: "",
  stepsLog: [],
};

export const createGenerateSlice: StateCreator<DocStore, [], [], GenerateSlice> = (set, get) => ({
  ...INITIAL_RESULT,

  reset: () =>
    set({
      ...INITIAL_RESULT,
      activeCat: "quality",
      activeDoc: "defect_report",
      context: "",
      imageFile: null,
      imagePreview: null,
    }),

  generate: async () => {
    const { activeCat, activeDoc, context, imageFile } = get();
    if (!activeDoc) return;

    set({ status: "submitting", ncrResult: null, rawResult: "", errorMsg: "", stepsLog: [] });

    try {
      const created = imageFile
        ? await createDocumentWithFile(
            { category: activeCat, doc_type: activeDoc, context, project_name: "POSCO CONSTRUCTION" },
            imageFile,
          )
        : await createDocument({
            category: activeCat,
            doc_type: activeDoc,
            context,
            project_name: "POSCO CONSTRUCTION",
          });

      set({ status: "polling" });

      for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        let job;
        try {
          job = await getJob(created.job_id);
        } catch (pollErr) {
          // 일시적 네트워크 오류는 다음 시도로 — DocumentApiError가 아닌 경우만 즉시 중단
          if (pollErr instanceof DocumentApiError && pollErr.status >= 500) continue;
          continue;
        }

        if (job.status === "done" && job.result) {
          set({
            stepsLog: job.result.steps_taken ?? [],
            ncrResult: (job.result.ncr as never) ?? null,
            sirResult: (job.result.safety_inspection as never) ?? null,
            rawResult: job.result.final_response ?? "",
            status: "done",
          });
          return;
        }
        if (job.status === "error") throw new Error(job.error ?? "파이프라인 오류");
      }

      throw new Error("처리 시간이 초과되었습니다. (최대 10분)");
    } catch (err: unknown) {
      const message =
        err instanceof DocumentApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : "알 수 없는 오류";
      set({ errorMsg: message, status: "error" });
    }
  },
});
