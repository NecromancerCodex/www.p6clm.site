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
  judgement: null,
  nonconformityDetected: false,
  derivedNcr: null,
  carStatus: "idle" as const,
  carResult: null,
  carRaw: "",
};

async function pollJob(jobId: string) {
  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    try {
      const job = await getJob(jobId);
      if (job.status === "done" && job.result) return job;
      if (job.status === "error") throw new Error(job.error ?? "파이프라인 오류");
    } catch (pollErr) {
      if (pollErr instanceof DocumentApiError && pollErr.status >= 500) continue;
      if (pollErr instanceof Error && pollErr.message === "파이프라인 오류") throw pollErr;
      continue;
    }
  }
  throw new Error("처리 시간이 초과되었습니다. (최대 10분)");
}

export const createGenerateSlice: StateCreator<DocStore, [], [], GenerateSlice> = (set, get) => ({
  ...INITIAL_RESULT,

  reset: () =>
    set({
      ...INITIAL_RESULT,
      activeCat: "quality",
      activeDoc: "quality_inspect",
      context: "",
      imageFile: null,
      imagePreview: null,
    }),

  generate: async () => {
    const { activeCat, activeDoc, context, imageFile } = get();
    if (!activeDoc) return;

    set({ ...INITIAL_RESULT, status: "submitting" });

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
      const job = await pollJob(created.job_id);
      const r = job.result!;

      set({
        stepsLog: r.steps_taken ?? [],
        ncrResult: (r.ncr as never) ?? null,
        sirResult: (r.safety_inspection as never) ?? null,
        rawResult: r.final_response ?? "",
        judgement: r.quality_judgement ?? null,
        nonconformityDetected: !!r.nonconformity_detected,
        derivedNcr: r.derived_ncr ?? null,
        status: "done",
      });
    } catch (err: unknown) {
      const message =
        err instanceof DocumentApiError ? err.detail : err instanceof Error ? err.message : "알 수 없는 오류";
      set({ errorMsg: message, status: "error" });
    }
  },

  // NCR 화면 [CAR 생성] — 대상 NCR 데이터를 백엔드 linked_ncr 로 전달
  generateCar: async (ncr) => {
    set({ carStatus: "submitting", carResult: null, carRaw: "" });
    try {
      const created = await createDocument({
        category: "quality",
        doc_type: "car",
        context: "",
        project_name: "POSCO CONSTRUCTION",
        linked_ncr: ncr,
      });
      set({ carStatus: "polling" });
      const job = await pollJob(created.job_id);
      const r = job.result!;
      set({ carResult: r.car ?? null, carRaw: r.final_response ?? "", carStatus: "done" });
    } catch (err: unknown) {
      const message =
        err instanceof DocumentApiError ? err.detail : err instanceof Error ? err.message : "CAR 생성 오류";
      set({ errorMsg: message, carStatus: "error" });
    }
  },
});
