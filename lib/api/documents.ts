/**
 * CLM Documents REST API 클라이언트.
 *
 * Backend: /api/v1/documents (api/v1/documents.py)
 * Frontend API base: /api/clm (next.config.ts rewrite → CLM 서비스)
 *
 * 페더레이트 ID 규칙:
 *   - "ncr:<int>"     → ncr_documents
 *   - "safety:<int>"  → safety_documents
 *   - "clm:<int>"     → clm_analysis_records
 */

const API_BASE = "/api/clm";

// ── 타입 ─────────────────────────────────────────────────────────────────────

export type DocumentSource =
  | "ncr_documents"
  | "safety_documents"
  | "clm_analysis_records";

export interface DocumentRead {
  id: string;
  source: DocumentSource;
  session_id: string;
  doc_type: string;
  doc_category: string | null;
  project_name: string | null;
  title: string | null;
  status: string;
  document_number: string | null;
  document_json: Record<string, unknown> | null;
  preview_text: string | null;
  created_at: string;
  updated_at: string | null;
  updated_by: string | null;
  deleted_at: string | null;
}

export interface DocumentListResponse {
  items: DocumentRead[];
  total_returned: number;
  next_offset: number | null;
}

export interface DocumentListFilters {
  limit?: number;
  offset?: number;
  doc_type?: string;
  source?: DocumentSource;
  project?: string;
  q?: string;
  include_deleted?: boolean;
}

export interface DocumentPatchBody {
  title?: string;
  project_name?: string;
  description?: string;
  immediate_action?: string;
  raw_document?: Record<string, unknown>;
  final_response?: string;
  status?: string;
}

export interface DocumentCreateBody {
  category: string;
  doc_type: string;
  context?: string;
  project_name?: string;
  image_base64?: string;
}

export interface JobCreatedResponse {
  job_id: string;
  status: "pending";
  poll_url: string;
}

export interface DocumentDeleteResponse {
  id: string;
  deleted_at: string;
}

// ── 공통 fetch 래퍼 ──────────────────────────────────────────────────────────

class DocumentApiError extends Error {
  constructor(public status: number, public detail: string) {
    super(detail);
    this.name = "DocumentApiError";
  }
}

async function request<T>(
  path: string,
  init?: RequestInit & { userId?: string | null },
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (init?.userId) {
    headers.set("X-User-Id", init.userId);
  }

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail =
      (body && (body.detail ?? body.error)) || `${res.status} ${res.statusText}`;
    throw new DocumentApiError(res.status, String(detail));
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ── 엔드포인트 ────────────────────────────────────────────────────────────────

export function listDocuments(filters: DocumentListFilters = {}): Promise<DocumentListResponse> {
  const params = new URLSearchParams();
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  if (filters.offset !== undefined) params.set("offset", String(filters.offset));
  if (filters.doc_type) params.set("doc_type", filters.doc_type);
  if (filters.source) params.set("source", filters.source);
  if (filters.project) params.set("project", filters.project);
  if (filters.q) params.set("q", filters.q);
  if (filters.include_deleted) params.set("include_deleted", "true");

  const qs = params.toString();
  return request<DocumentListResponse>(`/documents${qs ? `?${qs}` : ""}`);
}

export function getDocument(id: string): Promise<DocumentRead> {
  return request<DocumentRead>(`/documents/${encodeURIComponent(id)}`);
}

export function patchDocument(
  id: string,
  body: DocumentPatchBody,
  opts: { userId?: string | null } = {},
): Promise<DocumentRead> {
  return request<DocumentRead>(`/documents/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    userId: opts.userId ?? null,
  });
}

export function deleteDocument(
  id: string,
  opts: { userId?: string | null } = {},
): Promise<DocumentDeleteResponse> {
  return request<DocumentDeleteResponse>(`/documents/${encodeURIComponent(id)}`, {
    method: "DELETE",
    userId: opts.userId ?? null,
  });
}

export function createDocument(body: DocumentCreateBody): Promise<JobCreatedResponse> {
  return request<JobCreatedResponse>(`/documents`, {
    method: "POST",
    body: JSON.stringify({
      category: body.category,
      doc_type: body.doc_type,
      context: body.context ?? "",
      project_name: body.project_name ?? "POSCO CONSTRUCTION",
      image_base64: body.image_base64 ?? null,
    }),
  });
}

export function createDocumentWithFile(
  body: Omit<DocumentCreateBody, "image_base64">,
  file: File | null,
): Promise<JobCreatedResponse> {
  const form = new FormData();
  form.append("category", body.category);
  form.append("doc_type", body.doc_type);
  form.append("context", body.context ?? "");
  form.append("project_name", body.project_name ?? "POSCO CONSTRUCTION");
  if (file) form.append("file", file);
  return request<JobCreatedResponse>(`/documents/upload`, {
    method: "POST",
    body: form,
  });
}

export interface JobStatusResponse {
  job_id: string;
  status: "pending" | "running" | "done" | "error";
  result?: {
    ncr?: Record<string, unknown> | null;
    safety_inspection?: Record<string, unknown> | null;
    final_response?: string;
    steps_taken?: string[];
  };
  error?: string;
}

export function getJob(jobId: string): Promise<JobStatusResponse> {
  return request<JobStatusResponse>(`/job/${encodeURIComponent(jobId)}`);
}

export { DocumentApiError };
