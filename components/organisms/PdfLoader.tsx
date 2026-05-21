"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileUp, RefreshCw, ExternalLink, CheckCircle2, XCircle, Clock, AlertCircle } from "lucide-react";

interface PdfRow {
  id: number;
  filename: string;
  file_size_kb: number;
  page_count: number | null;
  source: string;
  status: "pending" | "failed" | "approved" | "rejected" | string;
  doc_type_hint: string | null;
  doc_type_confidence: number | null;
  extraction_method: string | null;
  promoted_doc_type: string | null;
  promoted_table_id: number | null;
  reject_reason: string | null;
  created_at: string | null;
}

const BACKEND_LIST = "/api/clm/admin/pdf-uploads/api/list";
const BACKEND_UPLOAD = "/api/clm/admin/pdf-uploads/upload";
const ADMIN_LOGIN = "/api/clm/admin/keys";
const REVIEW_BASE = "/api/clm/admin/pdf-uploads";

const POLL_INTERVAL_MS = 5000;

export function PdfLoader() {
  const [rows, setRows] = useState<PdfRow[]>([]);
  const [authNeeded, setAuthNeeded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUploadId, setLastUploadId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchList = useCallback(async () => {
    try {
      const res = await fetch(BACKEND_LIST, { credentials: "include" });
      if (res.status === 401) {
        setAuthNeeded(true);
        setRows([]);
        return;
      }
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      setRows(data);
      setAuthNeeded(false);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // 초기 로드 + 5초 폴링
  useEffect(() => {
    fetchList();
    const t = setInterval(fetchList, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [fetchList]);

  const handleUpload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(BACKEND_UPLOAD, {
        method: "POST",
        body: form,
        credentials: "include",
        redirect: "manual",  // 백엔드가 303 redirect 하지만 우리는 follow 안 함
      });
      if (res.status === 401) {
        setAuthNeeded(true);
        return;
      }
      // 303 또는 0 (opaqueredirect) 면 성공
      if (res.status !== 303 && res.status !== 0 && !res.ok) {
        const txt = await res.text();
        throw new Error(`업로드 실패 (${res.status}): ${txt}`);
      }
      await fetchList();
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setError(String(err));
    } finally {
      setUploading(false);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleUpload(f);
  };

  const counts = rows.reduce<Record<string, number>>(
    (acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }),
    {},
  );

  return (
    <div className="pdf-loader">
      <header className="pdf-header">
        <div>
          <h1>PDF 로더</h1>
          <p>현장에서 작성한 PDF 를 업로드하면 AI 가 텍스트 추출 + 문서 종류 파악 → 운영자 검토 후 DB 저장.</p>
        </div>
        <button
          type="button"
          className="pdf-refresh"
          onClick={fetchList}
          disabled={loading}
          aria-label="새로고침"
        >
          <RefreshCw size={16} strokeWidth={2} className={loading ? "spin" : ""} />
        </button>
      </header>

      {authNeeded && (
        <div className="pdf-banner pdf-banner-warn">
          <AlertCircle size={18} strokeWidth={2} />
          <div style={{ flex: 1 }}>
            <strong>어드민 로그인 필요</strong>
            <div style={{ fontSize: 12, opacity: 0.8 }}>
              PDF 업로드는 운영자 권한이 필요합니다. 새 탭에서 로그인 후 이 페이지로 돌아오세요.
            </div>
          </div>
          <a href={ADMIN_LOGIN} target="_blank" rel="noopener" className="pdf-btn pdf-btn-primary">
            로그인 페이지 열기 <ExternalLink size={14} strokeWidth={2} />
          </a>
        </div>
      )}

      {error && (
        <div className="pdf-banner pdf-banner-err">
          <XCircle size={18} strokeWidth={2} />
          <div style={{ flex: 1 }}>{error}</div>
        </div>
      )}

      {!authNeeded && (
        <section className="pdf-card">
          <h2>업로드</h2>
          <label className={`pdf-drop ${uploading ? "is-uploading" : ""}`}>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              onChange={onFileChange}
              disabled={uploading}
              hidden
            />
            <FileUp size={28} strokeWidth={1.8} />
            <strong>
              {uploading ? "업로드 중..." : "PDF 파일을 클릭하거나 끌어다 놓으세요"}
            </strong>
            <span className="pdf-hint">최대 20MB · 50페이지 · application/pdf</span>
          </label>
          <p className="pdf-flow-hint">
            업로드 → AI 텍스트 추출 → 문서 종류 분류 → 어드민 검토 큐 (pending) → 운영자 승인 시
            <code> ncr_documents</code> / <code>safety_documents</code> 에 INSERT.
          </p>
        </section>
      )}

      <section className="pdf-card">
        <div className="pdf-stats">
          <div className="pdf-stat pdf-stat-pending">
            <span className="pdf-stat-lbl">Pending</span>
            <span className="pdf-stat-val">{counts.pending || 0}</span>
          </div>
          <div className="pdf-stat pdf-stat-failed">
            <span className="pdf-stat-lbl">Failed</span>
            <span className="pdf-stat-val">{counts.failed || 0}</span>
          </div>
          <div className="pdf-stat pdf-stat-approved">
            <span className="pdf-stat-lbl">Approved</span>
            <span className="pdf-stat-val">{counts.approved || 0}</span>
          </div>
          <div className="pdf-stat pdf-stat-rejected">
            <span className="pdf-stat-lbl">Rejected</span>
            <span className="pdf-stat-val">{counts.rejected || 0}</span>
          </div>
        </div>
      </section>

      <section className="pdf-card">
        <h2>최근 업로드 ({rows.length})</h2>
        {rows.length === 0 && !loading && (
          <div className="pdf-empty">아직 업로드 없음.</div>
        )}
        {rows.length > 0 && (
          <table className="pdf-table">
            <thead>
              <tr>
                <th>#</th>
                <th>파일</th>
                <th>크기/페이지</th>
                <th>status</th>
                <th>doc_type 추천</th>
                <th>method</th>
                <th>업로드</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={lastUploadId === r.id ? "row-highlight" : ""}>
                  <td>{r.id}</td>
                  <td>
                    <code>{r.filename}</code>
                    {r.source && <div className="pdf-sub">{r.source}</div>}
                  </td>
                  <td>
                    {r.file_size_kb} KB
                    {r.page_count ? ` / ${r.page_count}p` : ""}
                  </td>
                  <td>
                    <StatusPill status={r.status} />
                  </td>
                  <td>
                    {r.doc_type_hint ? (
                      <>
                        <code>{r.doc_type_hint}</code>
                        {typeof r.doc_type_confidence === "number" && (
                          <ConfidenceBar v={r.doc_type_confidence} />
                        )}
                      </>
                    ) : (
                      <span className="pdf-sub">—</span>
                    )}
                  </td>
                  <td className="pdf-sub">{r.extraction_method || "—"}</td>
                  <td className="pdf-sub">
                    {r.created_at ? new Date(r.created_at).toLocaleString("ko-KR", {
                      month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
                    }) : "—"}
                  </td>
                  <td>
                    <a
                      className="pdf-btn pdf-btn-ghost"
                      href={`${REVIEW_BASE}/${r.id}`}
                      target="_blank"
                      rel="noopener"
                    >
                      {r.status === "pending" ? "검토" :
                       r.status === "failed" ? "진단" : "보기"}
                      <ExternalLink size={12} strokeWidth={2} />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <style jsx>{`
        .pdf-loader {
          max-width: 1100px;
          margin: 0 auto;
          padding: 24px 16px 48px;
        }
        .pdf-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 16px;
        }
        .pdf-header h1 { margin: 0; font-size: 22px; font-weight: 600; }
        .pdf-header p { margin: 4px 0 0; color: var(--muted, #6b7280); font-size: 13px; max-width: 720px; }
        .pdf-refresh {
          background: transparent; border: 1px solid #e5e7eb; border-radius: 8px;
          padding: 8px; cursor: pointer; color: #6b7280;
        }
        .pdf-refresh:hover { background: #f3f4f6; }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

        .pdf-banner {
          display: flex; gap: 12px; padding: 12px 14px; border-radius: 8px;
          margin-bottom: 12px; align-items: center;
        }
        .pdf-banner-warn { background: #fffbeb; color: #92400e; border: 1px solid #fde68a; }
        .pdf-banner-err  { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }

        .pdf-card {
          background: white; border: 1px solid #e5e7eb; border-radius: 12px;
          padding: 18px 20px; margin-bottom: 12px;
        }
        .pdf-card h2 { margin: 0 0 12px; font-size: 14px; color: #0ea5e9; font-weight: 600; }

        .pdf-drop {
          display: flex; flex-direction: column; align-items: center; gap: 6px;
          padding: 32px; border: 2px dashed #cbd5e1; border-radius: 10px;
          background: #f8fafc; cursor: pointer; transition: border-color .15s;
          color: #475569;
        }
        .pdf-drop:hover { border-color: #0ea5e9; background: #f0f9ff; }
        .pdf-drop.is-uploading { opacity: 0.6; cursor: wait; }
        .pdf-drop strong { font-size: 14px; }
        .pdf-hint { font-size: 11px; color: #94a3b8; }
        .pdf-flow-hint { margin: 12px 0 0; font-size: 12px; color: #94a3b8; }
        .pdf-flow-hint code { background: #f1f5f9; padding: 1px 5px; border-radius: 3px; font-size: 11px; }

        .pdf-stats { display: flex; gap: 12px; flex-wrap: wrap; }
        .pdf-stat {
          flex: 1; min-width: 130px;
          padding: 10px 14px; border-radius: 8px;
          display: flex; flex-direction: column;
        }
        .pdf-stat-lbl { font-size: 11px; text-transform: uppercase; letter-spacing: .5px; opacity: 0.7; }
        .pdf-stat-val { font-size: 22px; font-weight: 600; margin-top: 2px; }
        .pdf-stat-pending  { background: #f3e8ff; color: #6b21a8; }
        .pdf-stat-failed   { background: #fee2e2; color: #991b1b; }
        .pdf-stat-approved { background: #dcfce7; color: #166534; }
        .pdf-stat-rejected { background: #f1f5f9; color: #475569; }

        .pdf-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .pdf-table th, .pdf-table td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
        .pdf-table th { color: #94a3b8; font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
        .pdf-table code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 12px; word-break: break-all; }
        .row-highlight { background: #fef9c3; transition: background 1s; }

        .pdf-sub { font-size: 11px; color: #94a3b8; }
        .pdf-empty { padding: 32px; text-align: center; color: #94a3b8; font-size: 13px; }

        .pdf-btn {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 6px 10px; border-radius: 6px; font-size: 12px; font-weight: 500;
          text-decoration: none; border: 0; cursor: pointer;
        }
        .pdf-btn-primary { background: #0ea5e9; color: white; }
        .pdf-btn-primary:hover { background: #0284c7; }
        .pdf-btn-ghost { background: #f1f5f9; color: #475569; }
        .pdf-btn-ghost:hover { background: #e2e8f0; }
      `}</style>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; icon: React.ReactNode }> = {
    pending:  { bg: "#f3e8ff", fg: "#6b21a8", icon: <Clock size={11} strokeWidth={2.5} /> },
    failed:   { bg: "#fee2e2", fg: "#991b1b", icon: <XCircle size={11} strokeWidth={2.5} /> },
    approved: { bg: "#dcfce7", fg: "#166534", icon: <CheckCircle2 size={11} strokeWidth={2.5} /> },
    rejected: { bg: "#f1f5f9", fg: "#475569", icon: <XCircle size={11} strokeWidth={2.5} /> },
  };
  const c = map[status] || { bg: "#f1f5f9", fg: "#475569", icon: null };
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        background: c.bg, color: c.fg,
        padding: "2px 8px", borderRadius: 999,
        fontSize: 11, fontWeight: 500,
      }}
    >
      {c.icon}
      {status}
    </span>
  );
}

function ConfidenceBar({ v }: { v: number }) {
  const pct = Math.round(v * 100);
  const color = v >= 0.7 ? "#22c55e" : v >= 0.5 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
      <span style={{ display: "inline-block", width: 60, height: 5, background: "#e5e7eb", borderRadius: 3, overflow: "hidden" }}>
        <span style={{ display: "block", height: "100%", width: `${pct}%`, background: color }} />
      </span>
      <span style={{ fontSize: 10, color: "#94a3b8" }}>{pct}%</span>
    </div>
  );
}
