"use client";

/**
 * DocumentDetail — 페더레이트 문서 단건 뷰/편집 UI.
 *
 * mode="view" : 읽기 전용 A4
 * mode="edit" : A4 자체가 인라인 편집 폼 (pickDocumentForm 에 editable=true)
 *               → 위에 별도 폼 없음. 셀 직접 수정 → [저장] = raw_document patch.
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

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  deleteDocument,
  getDocument,
  patchDocument,
  DocumentApiError,
  type DocumentPatchBody,
  type DocumentRead,
} from "../../lib/api/documents";
import { docLabelForType } from "../../lib/docCategories";
import { pickDocumentForm } from "./DocumentFormViews";

type Mode = "view" | "edit";

interface Props {
  id: string;
  mode: Mode;
}

export function DocumentDetail({ id, mode }: Props) {
  const router = useRouter();
  const [doc, setDoc] = useState<DocumentRead | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 편집 모드에서 직접 변경되는 document_json 사본 (A4 인라인 편집 대상)
  const [editedJson, setEditedJson] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await getDocument(id);
      setDoc(d);
      // 편집 시작 시점의 스냅샷
      const dj = d.document_json;
      setEditedJson(
        dj && typeof dj === "object" && !Array.isArray(dj)
          ? (JSON.parse(JSON.stringify(dj)) as Record<string, unknown>)
          : null,
      );
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
    if (!doc || !editedJson) return;
    setSaving(true);
    setSaveError(null);
    try {
      // raw_document 통째 교체 + (있다면) 메타 필드 동기화
      const patch: DocumentPatchBody = { raw_document: editedJson };
      const newTitle = typeof editedJson.title === "string" ? editedJson.title : undefined;
      if (newTitle != null && newTitle !== doc.title) patch.title = newTitle;
      const newProject =
        typeof editedJson.project_name === "string" ? editedJson.project_name : undefined;
      if (newProject != null && newProject !== doc.project_name) patch.project_name = newProject;

      const updated = await patchDocument(doc.id, patch);
      setDoc(updated);
      const dj = updated.document_json;
      setEditedJson(
        dj && typeof dj === "object" && !Array.isArray(dj)
          ? (JSON.parse(JSON.stringify(dj)) as Record<string, unknown>)
          : null,
      );
      router.replace(`/document/${encodeURIComponent(doc.id)}`);
    } catch (e) {
      setSaveError(
        e instanceof DocumentApiError ? e.detail : e instanceof Error ? e.message : "저장 실패",
      );
    } finally {
      setSaving(false);
    }
  }, [doc, editedJson, router]);

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

  const projectName = doc.project_name?.trim() || "현장 미지정";
  const isEdit = mode === "edit";
  // 편집 모드: editedJson 사용 (인라인 변경 반영). view 모드: 원본 document_json.
  const showJson: Record<string, unknown> | null | undefined = isEdit
    ? editedJson
    : (doc.document_json as Record<string, unknown> | null | undefined);

  return (
    <div className="docdetail-shell">
      <header className="docdetail-toolbar">
        <button
          type="button"
          className="docdetail-btn docdetail-btn--ghost"
          onClick={() => router.push("/progress")}
          aria-label="문서저장소로 돌아가기"
        >
          <ArrowLeft size={14} strokeWidth={1.8} />
          문서저장소
        </button>

        <div className="docdetail-title">
          <span className="docdetail-doc-type">{docLabelForType(doc.doc_type)}</span>
          <h2>{doc.title || "(제목 없음)"}</h2>
          <span className="docdetail-meta">
            ID {doc.id} · 프로젝트 {projectName}
            {doc.updated_at ? ` · 수정 ${new Date(doc.updated_at).toLocaleString("ko-KR")}` : ""}
            {isEdit && " · ✏️ 편집 모드 — A4 셀 직접 클릭해서 수정"}
          </span>
        </div>

        <div className="docdetail-actions">
          {!isEdit ? (
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
                disabled={saving || !editedJson}
                title={!editedJson ? "구조화 JSON이 없는 옛 문서는 인라인 편집 미지원" : ""}
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

      {saveError && (
        <div className="docdetail-save-error">
          <AlertCircle size={14} strokeWidth={1.8} />
          {saveError}
        </div>
      )}
      {isEdit && !editedJson && (
        <div className="docdetail-save-error">
          <AlertCircle size={14} strokeWidth={1.8} />
          이 문서는 구조화 JSON 본문이 없어 인라인 편집을 지원하지 않습니다. 옛 문서는 progress 페이지의
          삭제 후 재생성을 고려하세요.
        </div>
      )}

      <section className="docdetail-preview">
        <div className="docdetail-a4-host">
          {pickDocumentForm({
            docType: doc.doc_type,
            json: showJson,
            projectName,
            editable: isEdit && !!editedJson,
            onChange: (next) => setEditedJson(next),
          }) ?? (
            <div className="docdetail-md sch-md">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {doc.preview_text || "_(저장된 본문이 없습니다.)_"}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
