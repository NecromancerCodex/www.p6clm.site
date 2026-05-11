/**
 * docStore — 문서 자동 작성 상태 (Zustand)
 *
 * 관리 항목:
 *   - activeCat / activeDoc : 선택된 카테고리 & 문서 유형
 *   - context / imageFile   : 사용자 입력
 *   - status / result       : 생성 진행 상태 & 결과
 *
 * 성능 최적화:
 *   - generate 로직을 스토어로 격리 → 컴포넌트는 UI만 담당
 *   - 컴포넌트는 필요한 슬라이스만 구독
 */
import { create } from "zustand";

/* ── 도메인 타입 ─────────────────────────────────────────────────── */

export interface NCRDocument {
  document_number: string;
  reporter: string;
  report_date: string;
  title: string;
  author: string;
  action_department: string;
  location: string;
  company: string;
  nc_type: string;
  attachment: string;
  action_manager: string;
  specification: string;
  description: string;
  immediate_action: string;
  disposition: string[];
  action_responsible: string;
  action_deadline: string;
  verification: string;
  completion_date: string;
  notes: string;
}

export interface SafetyCheckItem {
  target: string;        // 점검 대상 (장비 안전, 추락/전도, 보호구 등)
  item_name: string;     // 점검 항목
  status: "P" | "F" | "N/A";  // Pass / Fail / Not Applicable
  findings: string;      // 지적 및 조치 요구 사항
}

export interface SafetyInspectionDocument {
  document_number: string;
  construction_name: string;   // 공사명
  inspection_date: string;     // 점검 일시
  inspector: string;           // 점검자
  inspection_zone: string;     // 점검 구역
  yolo_detections_summary: string;
  checklist: SafetyCheckItem[];
  photo_guidance: string;      // Before/After 사진 안내
  violated_regulations: string[];
  action_deadline: string;     // 조치 기한
  action_responsible: string;  // 조치 책임자
  reinspection_opinion: string; // 재점검 의견
  risk_level: string;
  notes?: string;
}

export type CategoryId = "design" | "process" | "construction" | "quality" | "safety";
export type DocStatus = "idle" | "submitting" | "polling" | "done" | "error";

/* ── 설정 상수 ───────────────────────────────────────────────────── */

const API_BASE = "/api/clm";
const POLL_INTERVAL_MS = 2500;
const POLL_MAX_ATTEMPTS = 240;

/* ── 상태 & 액션 타입 ────────────────────────────────────────────── */

interface DocState {
  activeCat: CategoryId;
  activeDoc: string | null;
  context: string;
  status: DocStatus;
  ncrResult: NCRDocument | null;
  sirResult: SafetyInspectionDocument | null;
  rawResult: string;
  errorMsg: string;
  imageFile: File | null;
  imagePreview: string | null;
  stepsLog: string[];
}

interface DocActions {
  setActiveCat: (cat: CategoryId) => void;
  setActiveDoc: (doc: string | null) => void;
  setContext: (ctx: string) => void;
  setImage: (file: File, preview: string) => void;
  clearImage: () => void;
  reset: () => void;
  generate: () => Promise<void>;
}

/* ── 초기 상태 ───────────────────────────────────────────────────── */

const INITIAL: DocState = {
  activeCat: "quality",
  activeDoc: "defect_report",
  context: "",
  status: "idle",
  ncrResult: null,
  sirResult: null,
  rawResult: "",
  errorMsg: "",
  imageFile: null,
  imagePreview: null,
  stepsLog: [],
};

/* ── 스토어 ──────────────────────────────────────────────────────── */

export const useDocStore = create<DocState & DocActions>((set, get) => ({
  ...INITIAL,

  setActiveCat: (activeCat) =>
    set({ activeCat, activeDoc: null, status: "idle", ncrResult: null, sirResult: null, rawResult: "", errorMsg: "", imageFile: null, imagePreview: null, stepsLog: [] }),

  setActiveDoc: (activeDoc) =>
    set({ activeDoc, status: "idle", ncrResult: null, sirResult: null, rawResult: "", errorMsg: "" }),

  setContext: (context) => set({ context }),

  setImage: (imageFile, imagePreview) => set({ imageFile, imagePreview }),

  clearImage: () => set({ imageFile: null, imagePreview: null }),

  reset: () => set({ ...INITIAL }),

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
}));
