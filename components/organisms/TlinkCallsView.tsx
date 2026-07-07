"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Phone, PhoneIncoming, PhoneOutgoing, AlertCircle, Trash2, FileText, X } from "lucide-react";

import {
  listTlinkCalls,
  getTlinkCall,
  deleteTlinkCall,
  type TlinkCallSummary,
  type TlinkCallDetail,
} from "../../lib/api/tlinkCalls";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function formatDuration(sec: number | null): string {
  if (!sec || sec <= 0) return "0초";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}분 ${s}초` : `${s}초`;
}

/** stage → 한글 라벨 + 색상 */
function stageBadge(stage: string): { label: string; color: string } {
  switch (stage) {
    case "fetched": return { label: "수집됨", color: "var(--muted)" };
    case "classified_candidate": return { label: "분류: 후보", color: "var(--primary)" };
    case "classified_skip": return { label: "분류: 제외", color: "var(--muted)" };
    case "grouped": return { label: "묶음", color: "var(--primary)" };
    case "triggered": return { label: "보고서 생성됨", color: "var(--green)" };
    case "failed": return { label: "실패", color: "var(--red)" };
    default: return { label: stage, color: "var(--muted)" };
  }
}

const DOC_TYPE_LABEL: Record<string, string> = {
  ncr: "부적합 보고서(NCR)",
  defect_report: "결함 보고서",
  car: "시정조치(CAR)",
  safety_inspect: "안전점검",
  quality_inspect: "품질검사",
  material_inspect: "자재검사",
  risk_assess: "위험성평가",
};

export function TlinkCallsView() {
  const [items, setItems] = useState<TlinkCallSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<TlinkCallDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await listTlinkCalls(100));
    } catch (e) {
      setError(e instanceof Error ? e.message : "조회 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    try {
      setSelected(await getTlinkCall(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "상세 조회 실패");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const handleDelete = useCallback(async (id: number, name: string | null) => {
    if (!window.confirm(`${name || "이 통화"} 내역을 삭제할까요?`)) return;
    try {
      await deleteTlinkCall(id);
      setItems((prev) => prev.filter((it) => it.id !== id));
      setSelected((cur) => (cur?.id === id ? null : cur));
    } catch (e) {
      alert(e instanceof Error ? e.message : "삭제 실패");
    }
  }, []);

  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <Phone size={20} strokeWidth={2} />
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>전화 내역</h1>
        <button
          type="button"
          onClick={() => void load()}
          style={btnGhost}
          aria-label="새로고침"
        >
          <RefreshCw size={15} /> 새로고침
        </button>
      </header>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 0, marginBottom: 18 }}>
        티링크 무전 녹음의 STT 변환 결과와, 그 텍스트로 생성된 보고서를 확인합니다.
      </p>

      {error && (
        <div style={errorBox}>
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: "var(--muted)", padding: 40, textAlign: "center" }}>불러오는 중…</div>
      ) : items.length === 0 ? (
        <div style={{ color: "var(--muted)", padding: 40, textAlign: "center" }}>
          전화 내역이 없습니다. (통화 후 STT 변환되면 표시됩니다)
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((it) => {
            const badge = stageBadge(it.stage);
            const isOut = it.call_type === "out";
            return (
              <button
                type="button"
                key={it.id}
                onClick={() => void openDetail(it.id)}
                style={cardBtn}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
                  {isOut ? <PhoneOutgoing size={16} color="var(--primary)" /> : <PhoneIncoming size={16} color="var(--green)" />}
                  <div style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <strong style={{ fontSize: 14 }}>{it.member_name || it.guest_num || "통화"}</strong>
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>{formatDuration(it.call_time_sec)}</span>
                      <span style={{ ...pill, background: badge.color }}>{badge.label}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {it.stt_preview || (it.has_stt ? "(STT 있음)" : "STT 대기/없음")}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                  {it.triggered_doc_type && (
                    <span style={{ ...pill, background: "var(--green)", display: "inline-flex", alignItems: "center", gap: 3 }}>
                      <FileText size={11} /> {DOC_TYPE_LABEL[it.triggered_doc_type] || it.triggered_doc_type}
                    </span>
                  )}
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>{formatDate(it.b_date)}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); void handleDelete(it.id, it.member_name); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); void handleDelete(it.id, it.member_name); } }}
                    style={delBtn}
                    aria-label="삭제"
                  >
                    <Trash2 size={14} />
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {(selected || detailLoading) && (
        <CallDetailModal
          detail={selected}
          loading={detailLoading}
          onClose={() => setSelected(null)}
          onDelete={(id, name) => void handleDelete(id, name)}
        />
      )}
    </div>
  );
}

function CallDetailModal({
  detail,
  loading,
  onClose,
  onDelete,
}: {
  detail: TlinkCallDetail | null;
  loading: boolean;
  onClose: () => void;
  onDelete: (id: number, name: string | null) => void;
}) {
  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>통화 상세</h2>
          <button type="button" onClick={onClose} style={btnGhost} aria-label="닫기"><X size={16} /></button>
        </div>

        {loading || !detail ? (
          <div style={{ color: "var(--muted)", padding: 30, textAlign: "center" }}>불러오는 중…</div>
        ) : (
          <>
            <dl style={metaGrid}>
              <Meta label="발신자" value={detail.member_name || detail.member_id || "—"} />
              <Meta label="상대 번호" value={detail.guest_num || "—"} />
              <Meta label="유형" value={detail.call_type === "out" ? "발신" : detail.call_type === "in" ? "수신" : "—"} />
              <Meta label="통화 시간" value={formatDuration(detail.call_time_sec)} />
              <Meta label="통화 시각" value={formatDate(detail.b_date)} />
              <Meta label="분류 단계" value={stageBadge(detail.stage).label} />
            </dl>

            {/* 목적①: STT 변환 결과 확인 */}
            <section style={{ marginTop: 16 }}>
              <h3 style={sectionTitle}>STT 변환 텍스트</h3>
              {detail.stt_summary ? (
                <div style={sttBox}>{detail.stt_summary}</div>
              ) : (
                <div style={{ ...sttBox, color: "var(--muted)" }}>STT 변환 텍스트가 없습니다.</div>
              )}
              {detail.transcript.length > 0 && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--primary)" }}>
                    발화 타임라인 ({detail.transcript.length})
                  </summary>
                  <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                    {detail.transcript.map((seg, i) => (
                      <div key={i} style={{ fontSize: 13, display: "flex", gap: 8 }}>
                        <span style={{ color: "var(--muted)", flexShrink: 0, minWidth: 42 }}>{seg.time || ""}</span>
                        <span>{seg.text}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </section>

            {/* 분류 근거 */}
            {detail.matched_keywords.length > 0 && (
              <section style={{ marginTop: 14 }}>
                <h3 style={sectionTitle}>분류 근거 키워드 {detail.classifier_score != null && `(점수 ${detail.classifier_score})`}</h3>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {detail.matched_keywords.map((kw) => (
                    <span key={kw} style={{ ...pill, background: "var(--primary)" }}>{kw}</span>
                  ))}
                </div>
              </section>
            )}

            {/* 목적②: 생성된 보고서 추적 */}
            <section style={{ marginTop: 14 }}>
              <h3 style={sectionTitle}>생성된 보고서</h3>
              {detail.triggered_doc_type ? (
                <a href="/progress" style={docLink}>
                  <FileText size={14} />
                  {DOC_TYPE_LABEL[detail.triggered_doc_type] || detail.triggered_doc_type}
                  <span style={{ color: "var(--muted)", fontSize: 12 }}>· 문서저장소에서 보기</span>
                </a>
              ) : (
                <div style={{ color: "var(--muted)", fontSize: 13 }}>
                  {detail.stage_reason || "보고서가 생성되지 않았습니다."}
                </div>
              )}
            </section>

            <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => onDelete(detail.id, detail.member_name)}
                style={{ ...btnGhost, color: "var(--red)" }}
              >
                <Trash2 size={14} /> 삭제
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt style={{ fontSize: 11, color: "var(--muted)" }}>{label}</dt>
      <dd style={{ fontSize: 14, margin: 0, fontWeight: 500 }}>{value}</dd>
    </div>
  );
}

// ── 인라인 스타일 ──
const btnGhost: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 5, background: "transparent", border: "1px solid var(--line)", borderRadius: 8, padding: "5px 10px", fontSize: 13, cursor: "pointer", color: "var(--muted-strong)" };
const cardBtn: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, width: "100%", padding: "12px 14px", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, cursor: "pointer" };
const pill: React.CSSProperties = { fontSize: 11, color: "#141419", padding: "2px 7px", borderRadius: 999, fontWeight: 600, whiteSpace: "nowrap" };
const delBtn: React.CSSProperties = { display: "inline-flex", padding: 5, color: "var(--muted-strong)", borderRadius: 6, cursor: "pointer" };
const errorBox: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, background: "var(--red-soft)", color: "var(--red)", border: "1px solid var(--red-soft)", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 14 };
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0, 0, 0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 100 };
const modal: React.CSSProperties = { background: "var(--surface)", borderRadius: 14, padding: 22, maxWidth: 560, width: "100%", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" };
const metaGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, margin: 0 };
const sectionTitle: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: "var(--muted-strong)", marginBottom: 8, marginTop: 0 };
const sttBox: React.CSSProperties = { background: "var(--surface-soft)", border: "1px solid var(--line)", borderRadius: 8, padding: "12px 14px", fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap" };
const docLink: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, color: "var(--green)", fontSize: 14, fontWeight: 600, textDecoration: "none" };
