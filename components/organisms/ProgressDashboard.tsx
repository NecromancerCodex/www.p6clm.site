"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, FileText, AlertCircle } from "lucide-react";

import type { CategoryId, NCRDocument, SafetyInspectionDocument } from "../../stores/docStore";
import { DOC_CATEGORIES, docLabelForType, resolveItemCategory } from "../../lib/docCategories";
import { CategoryTab } from "../molecules/CategoryTab";
import { ProgressInsights } from "../molecules/ProgressInsights";
import { NcrFormView, SirFormView } from "../documents/DocumentFormViews";

const API_BASE = "/api/clm";

export interface DocumentHistoryItem {
  id: number;
  session_id: string;
  doc_type: string;
  doc_category: string | null;
  project_name: string | null;
  title: string | null;
  status: string;
  created_at: string;
  document_json?: Record<string, unknown> | null;
  preview_text?: string | null;
}

interface HistoryResponse {
  items: DocumentHistoryItem[];
  total_returned: number;
}

function dayKeyLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("ko-KR", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
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

  const s = (v: unknown) => (v == null ? "" : String(v));

  return {
    document_number: s(j.document_number),
    reporter: s(j.reporter),
    report_date: s(j.report_date),
    title: s(j.title),
    author: s(j.author),
    action_department: s(j.action_department),
    location: s(j.location),
    company: s(j.company),
    nc_type: s(j.nc_type),
    attachment: s(j.attachment),
    action_manager: s(j.action_manager),
    specification: s(j.specification),
    description: s(j.description),
    immediate_action: s(j.immediate_action),
    disposition,
    action_responsible: s(j.action_responsible),
    action_deadline: s(j.action_deadline),
    verification: s(j.verification),
    completion_date: s(j.completion_date),
    notes: s(j.notes),
  };
}

function sirFromJson(j: Record<string, unknown>): SafetyInspectionDocument {
  const raw = Array.isArray(j.checklist) ? j.checklist : [];
  const checklist = raw.map((row) => {
    const o = row as Record<string, unknown>;
    const st = String(o.status ?? "N/A").toUpperCase();
    let status: "P" | "F" | "N/A" = "N/A";
    if (st === "F" || st === "FAIL") status = "F";
    else if (st === "P" || st === "PASS") status = "P";
    return {
      target: String(o.target ?? ""),
      item_name: String(o.item_name ?? ""),
      status,
      findings: String(o.findings ?? ""),
    };
  });

  const regs = j.violated_regulations;
  const violated_regulations = Array.isArray(regs) ? regs.map(String) : [];

  const s = (v: unknown) => (v == null ? "" : String(v));

  return {
    document_number: s(j.document_number),
    construction_name: s(j.construction_name),
    inspection_date: s(j.inspection_date),
    inspector: s(j.inspector),
    inspection_zone: s(j.inspection_zone),
    yolo_detections_summary: s(j.yolo_detections_summary) || "자동 탐지 결과 없음 — 이미지 육안 분석 기반",
    checklist,
    photo_guidance: s(j.photo_guidance),
    violated_regulations,
    action_deadline: s(j.action_deadline),
    action_responsible: s(j.action_responsible),
    reinspection_opinion: s(j.reinspection_opinion),
    risk_level: s(j.risk_level) || "Medium",
    notes: j.notes != null ? s(j.notes) : undefined,
  };
}

function ProgressDocumentPreview({
  row,
  projectName,
}: {
  row: DocumentHistoryItem;
  projectName: string;
}) {
  const dj = row.document_json;

  if (dj && typeof dj === "object" && !Array.isArray(dj)) {
    if (row.doc_type === "defect_report" && isNcrPayload(dj)) {
      return (
        <NcrFormView ncr={ncrFromJson(dj)} stepsLog={[]} projectName={projectName} showPipeline={false} />
      );
    }
    if (row.doc_type === "safety_inspect" && isSirPayload(dj)) {
      return <SirFormView sir={sirFromJson(dj)} stepsLog={[]} showPipeline={false} />;
    }
    if (isSirPayload(dj)) {
      return <SirFormView sir={sirFromJson(dj)} stepsLog={[]} showPipeline={false} />;
    }
    if (isNcrPayload(dj)) {
      return (
        <NcrFormView ncr={ncrFromJson(dj)} stepsLog={[]} projectName={projectName} showPipeline={false} />
      );
    }
  }

  const text = row.preview_text?.trim() || row.title || "(저장된 본문이 없습니다.)";

  return (
    <div className="progress-a4-paper progress-a4-paper--text">
      <header className="progress-a4-text-head">
        <span className="progress-a4-text-label">{docLabelForType(row.doc_type)}</span>
        <time dateTime={row.created_at}>{formatDate(row.created_at)}</time>
      </header>
      <pre className="progress-a4-text-body">{text}</pre>
    </div>
  );
}

export function ProgressDashboard() {
  const [items, setItems] = useState<DocumentHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCat, setActiveCat] = useState<CategoryId>("quality");
  const [activeDocType, setActiveDocType] = useState<string | null>("defect_report");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filterDayKey, setFilterDayKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/documents/history?limit=200`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(body.detail ?? `HTTP ${res.status}`);
      }
      const data: HistoryResponse = await res.json();
      setItems(data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "불러오기 실패");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const itemsInCategory = useMemo(
    () =>
      items.filter((it) => resolveItemCategory(it.doc_type, it.doc_category) === activeCat),
    [items, activeCat],
  );

  useEffect(() => {
    setFilterDayKey(null);
  }, [activeCat]);

  const categoryDef = DOC_CATEGORIES.find((c) => c.id === activeCat)!;

  const docTypeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of itemsInCategory) {
      const k = it.doc_type || "unknown";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [itemsInCategory]);

  const prevCatRef = useRef(activeCat);
  useEffect(() => {
    const catChanged = prevCatRef.current !== activeCat;
    if (catChanged) prevCatRef.current = activeCat;

    setActiveDocType((prev) => {
      const ids = categoryDef.documents.map((d) => d.id);
      const prevOk = prev != null && ids.includes(prev);
      if (prevOk && !catChanged) return prev;
      const firstWith = categoryDef.documents.find((d) => (docTypeCounts.get(d.id) ?? 0) > 0);
      return firstWith?.id ?? categoryDef.documents[0]?.id ?? null;
    });
    if (catChanged) setSelectedId(null);
  }, [activeCat, categoryDef.documents, docTypeCounts]);

  const historyRows = useMemo(() => {
    if (!activeDocType) return [];
    let rows = itemsInCategory.filter((it) => (it.doc_type || "unknown") === activeDocType);
    if (filterDayKey) {
      rows = rows.filter((it) => dayKeyLocal(it.created_at) === filterDayKey);
    }
    return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [itemsInCategory, activeDocType, filterDayKey]);

  useEffect(() => {
    if (selectedId == null) return;
    if (!historyRows.some((r) => r.id === selectedId)) setSelectedId(null);
  }, [historyRows, selectedId]);

  const selected = selectedId != null ? items.find((i) => i.id === selectedId) : undefined;
  const projectName = selected?.project_name?.trim() || "POSCO CONSTRUCTION";

  if (loading) {
    return (
      <div className="progress-loading">
        <RefreshCw size={22} className="progress-spin" strokeWidth={1.6} />
        <span>NeonDB에서 문서 이력을 불러오는 중…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="progress-error">
        <AlertCircle size={22} strokeWidth={1.6} />
        <div>
          <strong>이력을 불러오지 못했습니다.</strong>
          <p>{error}</p>
          <p className="progress-hint">
            백엔드(기본 <code>http://localhost:8002</code>)가 실행 중인지, Alembic 마이그레이션
            <code>005</code>이 적용되었는지 확인하세요.
          </p>
          <button type="button" className="progress-retry" onClick={() => void load()}>
            다시 시도
          </button>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="progress-empty">
        <FileText size={40} strokeWidth={1} />
        <span>아직 NeonDB에 저장된 문서 이력이 없습니다.</span>
        <span className="progress-hint">문서 작성 탭에서 생성하면 여기에 표시됩니다.</span>
      </div>
    );
  }

  return (
    <div className="progress-shell">
      <div className="progress-toolbar">
        <span className="progress-count">총 {items.length}건 · {categoryDef.label} 중심으로 필터</span>
        <button type="button" className="progress-retry" onClick={() => void load()}>
          <RefreshCw size={14} strokeWidth={2} />
          새로고침
        </button>
      </div>

      <p className="progress-intro">
        설계·공정·시공·품질·안전 5개 구역과 동일한 기준으로 이력을 묶었습니다. 보고서 종류를 고른 뒤 항목을 누르면
        문서 작성 화면과 같은 A4 양식으로 미리보기됩니다.
      </p>

      <div className="progress-cat-row">
        {DOC_CATEGORIES.map((cat) => (
          <CategoryTab
            key={cat.id}
            id={cat.id}
            label={cat.label}
            icon={cat.icon}
            color={cat.color}
            active={activeCat === cat.id}
            onClick={() => setActiveCat(cat.id)}
          />
        ))}
      </div>

      <ProgressInsights
        items={items}
        itemsInCategory={itemsInCategory}
        activeCat={activeCat}
        filterDayKey={filterDayKey}
        onFilterDayKey={setFilterDayKey}
      />

      <div className="progress-split">
        <aside className="progress-doc-types">
          <p className="progress-aside-title">보고서 종류</p>
          <p className="progress-aside-desc">{categoryDef.description}</p>
          <ul className="progress-doc-type-list">
            {categoryDef.documents.map((doc) => {
              const n = docTypeCounts.get(doc.id) ?? 0;
              const active = activeDocType === doc.id;
              return (
                <li key={doc.id}>
                  <button
                    type="button"
                    className={`progress-doc-type-btn${active ? " is-active" : ""}`}
                    onClick={() => {
                      setActiveDocType(doc.id);
                      setSelectedId(null);
                    }}
                  >
                    <span className="progress-doc-type-label">{doc.label}</span>
                    <span className={`progress-doc-type-count${n > 0 ? " has-items" : ""}`}>{n}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <div className="progress-list-col">
          <h3 className="progress-list-heading">
            {activeDocType ? docLabelForType(activeDocType) : "문서"} 이력
          </h3>
          {historyRows.length === 0 ? (
            <div className="progress-list-empty">이 구역·보고서 유형에 해당하는 저장 건이 없습니다.</div>
          ) : (
            <ul className="progress-history-list">
              {historyRows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className={`progress-history-row${selectedId === row.id ? " is-selected" : ""}`}
                    onClick={() => setSelectedId(row.id)}
                  >
                    <div className="progress-history-main">
                      <span className="progress-history-title">{row.title || "(제목 없음)"}</span>
                      {row.project_name ? (
                        <span className="progress-history-meta">프로젝트: {row.project_name}</span>
                      ) : null}
                    </div>
                    <div className="progress-history-side">
                      <time dateTime={row.created_at}>{formatDate(row.created_at)}</time>
                      <span className={`progress-status progress-status--${row.status}`}>{row.status}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="progress-preview-col">
          <div className="progress-preview-header">A4 미리보기</div>
          <div className="progress-preview-scroll">
            {!selected ? (
              <div className="progress-preview-placeholder">
                왼쪽 목록에서 문서를 선택하면 여기에 인쇄용과 동일한 양식이 표시됩니다.
              </div>
            ) : (
              <div className="progress-a4-host">
                <ProgressDocumentPreview row={selected} projectName={projectName} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
