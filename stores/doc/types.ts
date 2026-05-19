/**
 * docStore 공통 타입
 *
 * 슬라이스(selectionSlice / inputSlice / generateSlice / crudSlice)가 공유하는
 * 도메인 모델 및 통합 스토어 타입.
 */
import type {
  DocumentListFilters,
  DocumentPatchBody,
  DocumentRead,
} from "../../lib/api/documents";

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
  target: string;
  item_name: string;
  status: "P" | "F" | "N/A";
  findings: string;
}

export interface SafetyInspectionDocument {
  document_number: string;
  construction_name: string;
  inspection_date: string;
  inspector: string;
  inspection_zone: string;
  yolo_detections_summary: string;
  checklist: SafetyCheckItem[];
  photo_guidance: string;
  violated_regulations: string[];
  action_deadline: string;
  action_responsible: string;
  reinspection_opinion: string;
  risk_level: string;
  notes?: string;
}

export type CategoryId = "design" | "process" | "construction" | "quality" | "safety";
export type DocStatus = "idle" | "submitting" | "polling" | "done" | "error";

export interface SelectionSlice {
  activeCat: CategoryId;
  activeDoc: string | null;
  setActiveCat: (cat: CategoryId) => void;
  setActiveDoc: (doc: string | null) => void;
}

export interface InputSlice {
  context: string;
  imageFile: File | null;
  imagePreview: string | null;
  setContext: (ctx: string) => void;
  setImage: (file: File, preview: string) => void;
  clearImage: () => void;
}

export interface GenerateSlice {
  status: DocStatus;
  ncrResult: NCRDocument | null;
  sirResult: SafetyInspectionDocument | null;
  rawResult: string;
  errorMsg: string;
  stepsLog: string[];
  generate: () => Promise<void>;
  reset: () => void;
}

export type CrudLoadStatus = "idle" | "loading" | "ready" | "error";

export interface CrudSlice {
  items: DocumentRead[];
  loadStatus: CrudLoadStatus;
  loadError: string;
  lastNextOffset: number | null;
  selected: DocumentRead | null;
  loadList: (filters?: DocumentListFilters) => Promise<void>;
  loadOne: (id: string) => Promise<DocumentRead | null>;
  patch: (id: string, body: DocumentPatchBody) => Promise<DocumentRead | null>;
  remove: (id: string) => Promise<boolean>;
  clearSelected: () => void;
}

export type DocStore = SelectionSlice & InputSlice & GenerateSlice & CrudSlice;
