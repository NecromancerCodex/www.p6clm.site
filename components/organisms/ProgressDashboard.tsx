"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, FileText, AlertCircle, Pencil, Trash2 } from "lucide-react";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { CategoryId } from "../../stores/docStore";
import { DOC_CATEGORIES, docLabelForType, resolveItemCategory } from "../../lib/docCategories";
import { createDocument, deleteDocument, getJob, listDocuments } from "../../lib/api/documents";
import { CategoryTab } from "../molecules/CategoryTab";
import { ProgressInsights } from "../molecules/ProgressInsights";
import { pickDocumentForm } from "../documents/DocumentFormViews";

export interface DocumentHistoryItem {
  id: string;
  source: string;
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

function ProgressDocumentPreview({
  row,
  projectName,
}: {
  row: DocumentHistoryItem;
  projectName: string;
}) {
  // 통합 라우터(pickDocumentForm) — DocAutoGen/DocumentDetail 과 *동일한* A4 폼뷰.
  const form = pickDocumentForm({
    docType: row.doc_type,
    json: row.document_json,
    projectName,
  });
  if (form) return <>{form}</>;

  // 구조화 JSON 없는 옛 문서(json=N) — 마크다운 렌더.
  const text = row.preview_text?.trim() || row.title || "_(저장된 본문이 없습니다.)_";

  return (
    <div className="progress-a4-paper progress-a4-paper--text">
      <header className="progress-a4-text-head">
        <span className="progress-a4-text-label">{docLabelForType(row.doc_type)}</span>
        <time dateTime={row.created_at}>{formatDate(row.created_at)}</time>
      </header>
      <div className="progress-a4-text-body sch-md">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      </div>
    </div>
  );
}

function isValidCategoryId(s: string | null): s is CategoryId {
  return s != null && DOC_CATEGORIES.some((c) => c.id === s);
}

/**
 * 초기 URL 쿼리를 SSR-safe 하게 읽음.
 *
 * Next.js `useSearchParams` hook 은 첫 render / hydration 직전에 null 을 줄 수
 * 있어 `useState` 초기값으로 부적합. mount 시점에 `window.location.search` 를
 * 직접 파싱하여 *반드시* 정확한 값을 얻는다.
 */
function readInitialQuery(): { cat: CategoryId | null; jobId: string | null } {
  if (typeof window === "undefined") return { cat: null, jobId: null };
  const params = new URLSearchParams(window.location.search);
  const rawCat = params.get("cat");
  return {
    cat: isValidCategoryId(rawCat) ? rawCat : null,
    jobId: params.get("job"),
  };
}

export function ProgressDashboard() {
  // cbot TriggeredJobCard 가 ?cat=&job= 으로 직접 이동하는 경우 초기 탭/문서 자동 점프.
  // lazy initializer — mount 시점 1회만 평가.
  const [initialQuery] = useState(readInitialQuery);

  const [items, setItems] = useState<DocumentHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCat, setActiveCat] = useState<CategoryId>(initialQuery.cat ?? "quality");
  const [activeDocType, setActiveDocType] = useState<string | null>("defect_report");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterDayKey, setFilterDayKey] = useState<string | null>(null);
  // NCR → CAR 생성 (저장폴더에서 후속 문서 생성)
  const [carBusy, setCarBusy] = useState(false);
  const [carError, setCarError] = useState<string | null>(null);

  // job 자동 적용 1회 flag — items 로딩 완료 후 한 번만 시도.
  const jobInitRef = useRef(false);
  // catChanged effect 에서 docType/selectedId reset 을 *한 사이클* 차단하는 flag.
  const jobApplyingRef = useRef(false);
  // 최초 진입 시 기본 탭 자동 결정 1회 flag (명시 ?cat=/?job= 없을 때 최근 문서 기준).
  const defaultCatRef = useRef(false);

  const router = useRouter();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listDocuments({ limit: 200 });
      setItems(
        (data.items ?? []).map((it) => ({
          id: it.id,
          source: it.source,
          session_id: it.session_id,
          doc_type: it.doc_type,
          doc_category: it.doc_category,
          project_name: it.project_name,
          title: it.title,
          status: it.status,
          created_at: it.created_at,
          document_json: it.document_json,
          preview_text: it.preview_text,
        })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "불러오기 실패");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleEdit = useCallback(
    (id: string) => {
      router.push(`/document/${encodeURIComponent(id)}/edit`);
    },
    [router],
  );

  const handleDelete = useCallback(
    async (id: string, title: string | null) => {
      const label = title?.trim() || id;
      if (!window.confirm(`"${label}" 문서를 삭제할까요?\n(soft delete — 이력은 보존됩니다)`)) return;
      const prev = items;
      setItems((cur) => cur.filter((it) => it.id !== id));
      if (selectedId === id) setSelectedId(null);
      try {
        await deleteDocument(id);
      } catch (e) {
        setItems(prev);
        window.alert(`삭제 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
      }
    },
    [items, selectedId],
  );

  // NCR → CAR 생성: 대상 NCR 의 document_json 을 linked_ncr 로 전달 → 폴링 → 목록 새로고침 후 새 CAR 선택.
  const handleGenerateCar = useCallback(
    async (row: DocumentHistoryItem) => {
      setCarBusy(true);
      setCarError(null);
      try {
        const created = await createDocument({
          category: "quality",
          doc_type: "car",
          context: "",
          project_name: row.project_name ?? "",
          linked_ncr: row.document_json ?? null,
        });
        // 폴링 (최대 ~10분)
        let done = false;
        for (let i = 0; i < 240 && !done; i++) {
          await new Promise((r) => setTimeout(r, 2500));
          try {
            const job = await getJob(created.job_id);
            if (job.status === "done") done = true;
            else if (job.status === "error") throw new Error(job.error ?? "CAR 생성 오류");
          } catch (pollErr) {
            if (pollErr instanceof Error && pollErr.message === "CAR 생성 오류") throw pollErr;
            // 일시 오류는 재시도
          }
        }
        if (!done) throw new Error("CAR 생성 시간이 초과되었습니다.");
        await load();
        // 새로 생성된 CAR 로 이동 (quality 카테고리 · car 유형)
        setActiveCat("quality");
        setActiveDocType("car");
        setSelectedId(null);
      } catch (e) {
        setCarError(e instanceof Error ? e.message : "CAR 생성 실패");
      } finally {
        setCarBusy(false);
      }
    },
    [load],
  );

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

    // job 자동 적용 직후의 cat 변경 사이클이면 docType/selectedId 보존 (1회만 차단).
    if (jobApplyingRef.current && catChanged) {
      jobApplyingRef.current = false;
      return;
    }

    setActiveDocType((prev) => {
      const ids = categoryDef.documents.map((d) => d.id);
      const prevOk = prev != null && ids.includes(prev);
      if (prevOk && !catChanged) return prev;
      const firstWith = categoryDef.documents.find((d) => (docTypeCounts.get(d.id) ?? 0) > 0);
      return firstWith?.id ?? categoryDef.documents[0]?.id ?? null;
    });
    if (catChanged) setSelectedId(null);
  }, [activeCat, categoryDef.documents, docTypeCounts]);

  // cbot 알림 클릭 → ?job=<job_id> 으로 진입 시 해당 row 자동 선택 (items 로딩 후 1회).
  useEffect(() => {
    const targetJobId = initialQuery.jobId;
    if (jobInitRef.current || !targetJobId || items.length === 0) return;
    const matched = items.find((it) => it.session_id === targetJobId);
    if (!matched) return;
    jobInitRef.current = true;
    jobApplyingRef.current = true;
    const cat = resolveItemCategory(matched.doc_type, matched.doc_category) as CategoryId;
    setActiveCat(cat);
    setActiveDocType(matched.doc_type);
    setSelectedId(matched.id);
  }, [items, initialQuery.jobId]);

  // 기본 탭 자동 결정 — 명시 ?cat=/?job= 없이 진입(사이드바 등)하면 *가장 최근 생성 문서*의
  // 카테고리로 점프. "품질관리 고정 디폴트" 불편 해소 (방금 만든 문서 탭으로 바로).
  useEffect(() => {
    if (defaultCatRef.current || items.length === 0) return;
    defaultCatRef.current = true;
    if (initialQuery.cat || initialQuery.jobId) return; // 명시 진입이면 그 로직 우선
    const latest = items.reduce((a, b) =>
      b.created_at.localeCompare(a.created_at) > 0 ? b : a,
    );
    setActiveCat(resolveItemCategory(latest.doc_type, latest.doc_category) as CategoryId);
  }, [items, initialQuery.cat, initialQuery.jobId]);

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
  const projectName = selected?.project_name?.trim() || "현장 미지정";

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
                <li key={row.id} className="progress-history-li">
                  <button
                    type="button"
                    className={`progress-history-row${selectedId === row.id ? " is-selected" : ""}`}
                    onClick={() => setSelectedId(row.id)}
                    title={row.title || "(제목 없음)"}
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
                  <div className="progress-history-actions">
                    <button
                      type="button"
                      className="progress-history-action"
                      title="편집"
                      aria-label={`${row.title || row.id} 편집`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEdit(row.id);
                      }}
                    >
                      <Pencil size={14} strokeWidth={1.8} />
                    </button>
                    <button
                      type="button"
                      className="progress-history-action progress-history-action--danger"
                      title="삭제"
                      aria-label={`${row.title || row.id} 삭제`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDelete(row.id, row.title);
                      }}
                    >
                      <Trash2 size={14} strokeWidth={1.8} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="progress-preview-col">
          <div className="progress-preview-header">
            <span>A4 미리보기</span>
            {selected?.doc_type === "defect_report" && (
              <button
                type="button"
                className="progress-car-btn"
                onClick={() => void handleGenerateCar(selected)}
                disabled={carBusy}
                title="이 NCR에 대한 시정조치 보고서(CAR) 생성"
              >
                {carBusy ? (
                  <>
                    <RefreshCw size={13} className="progress-spin" strokeWidth={2} /> CAR 생성 중…
                  </>
                ) : (
                  <>CAR 생성</>
                )}
              </button>
            )}
          </div>
          {carError && <div className="progress-car-error">CAR 생성 실패: {carError}</div>}
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
