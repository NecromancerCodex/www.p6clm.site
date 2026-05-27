"use client";

/**
 * DocumentDetail — 페더레이트 문서 단건 뷰/편집 UI.
 *
 * mode="view" : 읽기 전용 (양식 A4 미리보기 + 메타)
 * mode="edit" : title/project_name/description 등 부분 수정 폼 → PATCH /api/v1/documents/{id}
 *
 * 삭제는 progress 페이지에서 처리 — 이 컴포넌트는 view/edit만 책임.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
  X,
} from "lucide-react";

import {
  deleteDocument,
  getDocument,
  patchDocument,
  DocumentApiError,
  type DocumentPatchBody,
  type DocumentRead,
} from "../../lib/api/documents";
import { docLabelForType } from "../../lib/docCategories";
import type { NCRDocument, SafetyInspectionDocument } from "../../stores/docStore";
import { NcrFormView, SirFormView } from "./DocumentFormViews";

type Mode = "view" | "edit";

interface Props {
  id: string;
  mode: Mode;
}

interface EditableFields {
  title: string;
  project_name: string;
  description: string;
  immediate_action: string;
}

function asString(v: unknown): string {
  if (v == null) return "";
  return String(v);
}

function isNcrPayload(j: Record<string, unknown>): boolean {
  if (typeof j.document_number !== "string") return false;
  return "specification" in j || "description" in j || "immediate_action" in j;
}

function isSirPayload(j: Record<string, unknown>): boolean {
  return Array.isArray(j.checklist);
}

function ncrFromJson(j: Record<string, unknown>): NCRDocument {
  const disp = j.disposition;
  let disposition: string[] = [];
  if (Array.isArray(disp)) disposition = disp.map(String);
  else if (typeof disp === "string" && disp.trim()) disposition = [disp];
  return {
    document_number: asString(j.document_number),
    reporter: asString(j.reporter),
    report_date: asString(j.report_date),
    title: asString(j.title),
    author: asString(j.author),
    action_department: asString(j.action_department),
    location: asString(j.location),
    company: asString(j.company),
    nc_type: asString(j.nc_type),
    attachment: asString(j.attachment),
    action_manager: asString(j.action_manager),
    specification: asString(j.specification),
    description: asString(j.description),
    immediate_action: asString(j.immediate_action),
    disposition,
    action_responsible: asString(j.action_responsible),
    action_deadline: asString(j.action_deadline),
    verification: asString(j.verification),
    completion_date: asString(j.completion_date),
    notes: asString(j.notes),
  };
}

function sirFromJson(j: Record<string, unknown>): SafetyInspectionDocument {
  const raw = Array.isArray(j.checklist) ? j.checklist : [];
  const checklist = raw.map((row) => {
    const o = row as Record<string, unknown>;
    const st = String(o.status ?? "N/A").toUpperCase();
    const status: "P" | "F" | "N/A" =
      st === "F" || st === "FAIL" ? "F" : st === "P" || st === "PASS" ? "P" : "N/A";
    return {
      target: String(o.target ?? ""),
      item_name: String(o.item_name ?? ""),
      status,
      findings: String(o.findings ?? ""),
    };
  });
  const regs = j.violated_regulations;
  const violated_regulations = Array.isArray(regs) ? regs.map(String) : [];
  return {
    document_number: asString(j.document_number),
    construction_name: asString(j.construction_name),
    inspection_date: asString(j.inspection_date),
    inspector: asString(j.inspector),
    inspection_zone: asString(j.inspection_zone),
    yolo_detections_summary: asString(j.yolo_detections_summary) || "자동 탐지 결과 없음",
    checklist,
    photo_guidance: asString(j.photo_guidance),
    violated_regulations,
    action_deadline: asString(j.action_deadline),
    action_responsible: asString(j.action_responsible),
    reinspection_opinion: asString(j.reinspection_opinion),
    risk_level: asString(j.risk_level) || "Medium",
    notes: j.notes != null ? asString(j.notes) : undefined,
  };
}

function pickEditable(doc: DocumentRead): EditableFields {
  const dj = (doc.document_json ?? {}) as Record<string, unknown>;
  return {
    title: asString(doc.title ?? dj.title),
    project_name: asString(doc.project_name),
    description: asString(dj.description ?? doc.preview_text),
    immediate_action: asString(dj.immediate_action),
  };
}

function buildPatch(initial: EditableFields, current: EditableFields, doc: DocumentRead): DocumentPatchBody {
  const patch: DocumentPatchBody = {};
  if (current.title !== initial.title) patch.title = current.title;
  if (current.project_name !== initial.project_name) patch.project_name = current.project_name;

  // raw JSON 양식이 있는 경우 — description/immediate_action 변경 시 raw_document 통째로 교체
  const dj = doc.document_json;
  if (dj && typeof dj === "object" && !Array.isArray(dj)) {
    const nextRaw: Record<string, unknown> = { ...dj };
    let rawChanged = false;
    if (current.description !== initial.description) {
      nextRaw.description = current.description;
      rawChanged = true;
    }
    if (current.immediate_action !== initial.immediate_action) {
      nextRaw.immediate_action = current.immediate_action;
      rawChanged = true;
    }
    if (current.title !== initial.title) {
      nextRaw.title = current.title;
      rawChanged = true;
    }
    if (rawChanged) patch.raw_document = nextRaw;
  } else {
    // 일반 텍스트 문서 — clm_analysis_records의 final_response 갱신
    if (current.description !== initial.description) {
      patch.description = current.description;
    }
  }
  return patch;
}

export function DocumentDetail({ id, mode }: Props) {
  const router = useRouter();
  const [doc, setDoc] = useState<DocumentRead | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [initial, setInitial] = useState<EditableFields | null>(null);
  const [fields, setFields] = useState<EditableFields | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await getDocument(id);
      setDoc(d);
      const eds = pickEditable(d);
      setInitial(eds);
      setFields(eds);
    } catch (e) {
      const detail =
        e instanceof DocumentApiError ? e.detail : e instanceof Error ? e.message : "불러오기 실패";
      setError(detail);
      setDoc(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = useCallback(async () => {
    if (!doc || !fields || !initial) return;
    const patch = buildPatch(initial, fields, doc);
    if (Object.keys(patch).length === 0) {
      setSaveError("변경 사항이 없습니다.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await patchDocument(doc.id, patch);
      setDoc(updated);
      const eds = pickEditable(updated);
      setInitial(eds);
      setFields(eds);
      router.replace(`/document/${encodeURIComponent(doc.id)}`);
    } catch (e) {
      setSaveError(
        e instanceof DocumentApiError ? e.detail : e instanceof Error ? e.message : "저장 실패",
      );
    } finally {
      setSaving(false);
    }
  }, [doc, fields, initial, router]);

  const handleDelete = useCallback(async () => {
    if (!doc) return;
    if (!window.confirm(`"${doc.title || doc.id}" 문서를 삭제할까요? (soft delete)`)) return;
    try {
      await deleteDocument(doc.id);
      router.push("/progress");
    } catch (e) {
      window.alert(
        `삭제 실패: ${e instanceof DocumentApiError ? e.detail : e instanceof Error ? e.message : "오류"}`,
      );
    }
  }, [doc, router]);

  if (loading) {
    return (
      <div className="docdetail-loading">
        <RefreshCw size={22} className="progress-spin" strokeWidth={1.6} />
        <span>문서를 불러오는 중…</span>
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="docdetail-error">
        <AlertCircle size={22} strokeWidth={1.6} />
        <div>
          <strong>문서를 불러오지 못했습니다.</strong>
          <p>{error ?? "알 수 없는 오류"}</p>
          <button type="button" className="docdetail-btn" onClick={() => void load()}>
            다시 시도
          </button>
        </div>
      </div>
    );
  }

  const dj = doc.document_json;
  const projectName = doc.project_name?.trim() || "현장 미지정";

  return (
    <div className="docdetail-shell">
      <header className="docdetail-toolbar">
        <button
          type="button"
          className="docdetail-btn docdetail-btn--ghost"
          onClick={() => router.push("/progress")}
          aria-label="진행도로 돌아가기"
        >
          <ArrowLeft size={14} strokeWidth={1.8} />
          진행도
        </button>

        <div className="docdetail-title">
          <span className="docdetail-doc-type">{docLabelForType(doc.doc_type)}</span>
          <h2>{doc.title || "(제목 없음)"}</h2>
          <span className="docdetail-meta">
            ID {doc.id} · 프로젝트 {projectName}
            {doc.updated_at ? ` · 수정 ${new Date(doc.updated_at).toLocaleString("ko-KR")}` : ""}
          </span>
        </div>

        <div className="docdetail-actions">
          {mode === "view" ? (
            <>
              <button
                type="button"
                className="docdetail-btn docdetail-btn--primary"
                onClick={() => router.push(`/document/${encodeURIComponent(doc.id)}/edit`)}
              >
                <Pencil size={14} strokeWidth={1.8} />
                편집
              </button>
              <button
                type="button"
                className="docdetail-btn docdetail-btn--danger"
                onClick={() => void handleDelete()}
              >
                <Trash2 size={14} strokeWidth={1.8} />
                삭제
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="docdetail-btn docdetail-btn--primary"
                onClick={() => void handleSave()}
                disabled={saving}
              >
                <Save size={14} strokeWidth={1.8} />
                {saving ? "저장 중…" : "저장"}
              </button>
              <button
                type="button"
                className="docdetail-btn docdetail-btn--ghost"
                onClick={() => router.replace(`/document/${encodeURIComponent(doc.id)}`)}
                disabled={saving}
              >
                <X size={14} strokeWidth={1.8} />
                취소
              </button>
            </>
          )}
        </div>
      </header>

      {mode === "edit" && fields && (
        <section className="docdetail-edit-grid">
          <label className="docdetail-field">
            <span>제목</span>
            <input
              type="text"
              value={fields.title}
              onChange={(e) => setFields({ ...fields, title: e.target.value })}
            />
          </label>
          <label className="docdetail-field">
            <span>프로젝트</span>
            <input
              type="text"
              value={fields.project_name}
              onChange={(e) => setFields({ ...fields, project_name: e.target.value })}
            />
          </label>
          <label className="docdetail-field docdetail-field--full">
            <span>설명 / 본문</span>
            <textarea
              rows={6}
              value={fields.description}
              onChange={(e) => setFields({ ...fields, description: e.target.value })}
            />
          </label>
          <label className="docdetail-field docdetail-field--full">
            <span>즉시 조치</span>
            <textarea
              rows={4}
              value={fields.immediate_action}
              onChange={(e) => setFields({ ...fields, immediate_action: e.target.value })}
            />
          </label>
          {saveError && (
            <div className="docdetail-save-error">
              <AlertCircle size={14} strokeWidth={1.8} />
              {saveError}
            </div>
          )}
        </section>
      )}

      <section className="docdetail-preview">
        <h3 className="docdetail-preview-heading">A4 미리보기</h3>
        <div className="docdetail-a4-host">
          {dj && typeof dj === "object" && !Array.isArray(dj) ? (
            isNcrPayload(dj) ? (
              <NcrFormView
                ncr={ncrFromJson(dj)}
                stepsLog={[]}
                projectName={projectName}
                showPipeline={false}
              />
            ) : isSirPayload(dj) ? (
              <SirFormView sir={sirFromJson(dj)} stepsLog={[]} showPipeline={false} />
            ) : (
              <pre className="docdetail-raw-json">{JSON.stringify(dj, null, 2)}</pre>
            )
          ) : (
            <pre className="docdetail-raw-text">{doc.preview_text || "(저장된 본문이 없습니다.)"}</pre>
          )}
        </div>
      </section>
    </div>
  );
}
