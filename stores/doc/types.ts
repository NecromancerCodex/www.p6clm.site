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

// ── 품질 파이프라인 구조화 문서 (A4 뷰용) ──────────────────────────────────
export interface QualityCheckRow {
  item: string;
  criterion: string;
  result: string;
  judgement: "적합" | "부적합" | "확인필요" | "해당없음";
  note?: string;
}
export interface QualityInspectionDoc {
  document_number: string;
  report_title: string;
  site_name: string;
  construction_location?: string;
  contractor?: string;
  supervisor_org?: string;
  inspection_date: string;
  inspector: string;
  work_type: string;
  inspection_location: string;
  witness?: string;
  inspection_purpose: string;
  criteria_documents: string[];
  related_standards: string[];
  checklist: QualityCheckRow[];
  judgement: string;
  nonconformities: Array<{
    location: string; description: string; cause?: string; photo_ref?: string; required_action: string;
  }>;
  actions: Array<{ nonconformity: string; action: string; completed: string; reinspection_result: string }>;
  photo_captions: string[];
  overall_opinion: string;
  attachments: string[];
  author?: string;
  reviewer?: string;
  approver?: string;
}
export interface MaterialInspectionDoc {
  document_number: string;
  created_date: string;
  site_name: string;
  construction_name?: string;
  inspection_location?: string;
  inspection_date: string;
  inspector: string;
  witness?: string;
  cooperator?: string;
  supplier?: string;
  delivery_vehicle_no?: string;
  work_type: string;
  overview: Record<string, string>;
  checklist: QualityCheckRow[];
  judgement: string;
  disposition: string;
  ncr_number?: string;
  nonconformities: Array<Record<string, string>>;
  related_standards: string[];
  attachments: string[];
  inspection_opinion: string;
  inspector_sign?: string;
  site_manager_sign?: string;
  supervisor_sign?: string;
  cooperator_sign?: string;
}
export interface CARDoc {
  document_number: string;
  created_date: string;
  site_name?: string;
  construction_name?: string;
  author?: string;
  author_org?: string;
  author_title?: string;
  linked: Record<string, string>;
  nc_summary: Record<string, string>;
  cause: Record<string, unknown>;
  corrective: Record<string, string>;
  preventive: Record<string, string>;
  action_result: Record<string, string>;
  reinspection: Record<string, string>;
  closure_status: string;
  closure_opinion: string;
  attachments: string[];
  sign_action_responsible?: string;
  sign_quality_manager?: string;
  sign_site_manager?: string;
  sign_supervisor?: string;
  sign_client?: string;
}

// ── 자동 파생 NCR (품질/자재 부적합 → source-linked NCR) A4 뷰용 ──────────
export interface DerivedNCRItemDoc {
  item: string;
  required_value: string;
  actual_value: string;
  location?: string;
  evidence_photo?: string;
  immediate_action?: string;
}
export interface DerivedNCRDoc {
  ncr_number: string;
  source_document_type: string; // quality_inspection | material_inspection
  source_document_id: string;
  ncr_type: string;             // workmanship | material | test_result | other
  items: DerivedNCRItemDoc[];
  description: string;
  responsible_party?: string;
  due_date?: string;
  car_required?: boolean;
  status?: string;
  related_standards?: string[];
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
  // 품질 파이프라인 (Phase 5)
  qualityResult: QualityInspectionDoc | null;        // 품질검사 구조화 (A4 뷰)
  materialResult: MaterialInspectionDoc | null;      // 자재검수 구조화 (A4 뷰)
  judgement: string | null;                          // 품질: 적합/부적합/확인필요 · 자재: 적합/조건부 적합/부적합
  nonconformityDetected: boolean;                    // 부적합 → NCR 파생됨
  derivedNcr: Record<string, unknown> | null;        // 자동 파생 NCR
  carStatus: "idle" | "submitting" | "polling" | "done" | "error";
  carDoc: CARDoc | null;                             // CAR 구조화 (A4 뷰)
  carRaw: string;                                    // CAR 마크다운(fallback)
  generate: () => Promise<void>;
  generateCar: (ncr: Record<string, unknown>) => Promise<void>;  // [CAR 생성] 버튼
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
