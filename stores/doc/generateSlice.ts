import type { StateCreator } from "zustand";

import type { DocStore, GenerateSlice } from "./types";

const API_BASE = "/api/clm";
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
      let res: Response;

      if (imageFile) {
        const form = new FormData();
        form.append("category", activeCat);
        form.append("doc_type", activeDoc);
        form.append("context", context);
        form.append("project_name", "POSCO CONSTRUCTION");
        form.append("file", imageFile);
        res = await fetch(`${API_BASE}/doc-generate/async/upload`, { method: "POST", body: form });
      } else {
        res = await fetch(`${API_BASE}/doc-generate/async`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category: activeCat, doc_type: activeDoc, context, project_name: "POSCO CONSTRUCTION" }),
        });
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail ?? "서버 오류");
      }

      const { job_id } = await res.json();
      set({ status: "polling" });

      for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        const pollRes = await fetch(`${API_BASE}/job/${job_id}`);
        if (!pollRes.ok) continue;
        const job = await pollRes.json();

        if (job.status === "done" && job.result) {
          set({
            stepsLog: job.result.steps_taken ?? [],
            ncrResult: job.result.ncr ?? null,
            sirResult: job.result.safety_inspection ?? null,
            rawResult: job.result.final_response ?? "",
            status: "done",
          });
          return;
        }
        if (job.status === "error") throw new Error(job.error ?? "파이프라인 오류");
      }

      throw new Error("처리 시간이 초과되었습니다. (최대 10분)");
    } catch (err: unknown) {
      set({
        errorMsg: err instanceof Error ? err.message : "알 수 없는 오류",
        status: "error",
      });
    }
  },
});
