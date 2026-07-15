"use client";

/**
 * P6 수정 에이전트 — XER + 엑셀 대조 → Claude 수정안 + 선후행 제약 진단.
 *
 * 만든 이유(현장 페인포인트): 거래처 엑셀로 P6 날짜를 손수 고칠 때, 어떤 날짜는 선후행(CPM) 때문에
 * 안 바뀌는데 P6 는 "어떤 선후행이 막는지"를 안 알려줌. 이 도구가 그 막는 선행을 짚어준다.
 */
import { useState } from "react";

import { p6Edit, ScheduleApiError, type P6EditItem, type P6EditResult } from "../../../../lib/api/schedule";

const CARD: React.CSSProperties = {
  background: "var(--surface)", border: "1px solid var(--surface-muted)", borderRadius: 14,
  boxShadow: "0 1px 3px rgba(16,24,40,0.05)", padding: 16, marginBottom: 16,
};
const th: React.CSSProperties = { padding: "7px 10px", fontWeight: 600, fontSize: 12, textAlign: "left", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "7px 10px", verticalAlign: "top", fontSize: 12.5 };

export default function P6EditPage() {
  const [xerFile, setXerFile] = useState<File | null>(null);
  const [dataFile, setDataFile] = useState<File | null>(null);
  const [mode, setMode] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [err, setErr] = useState("");
  const [result, setResult] = useState<P6EditResult | null>(null);

  const run = async () => {
    if (!xerFile || !dataFile) return;
    setBusy(true); setErr(""); setResult(null); setStatus("");
    try {
      setResult(await p6Edit(xerFile, dataFile, mode, setStatus));
    } catch (e) {
      setErr(e instanceof ScheduleApiError ? e.message : e instanceof Error ? e.message : "처리 실패");
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    if (!result) return;
    const bin = atob(result.xer_b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url; a.download = result.filename; a.click();
    URL.revokeObjectURL(url);
  };

  const applied = result?.edits.filter((e) => !e.blocked) ?? [];
  const blocked = result?.edits.filter((e) => e.blocked) ?? [];

  return (
    <div className="ws-inner-pad" style={{ maxWidth: "none" }}>
      <div className="ws-section-title">P6 수정</div>
      <p className="ws-section-desc">
        <b>XER + 거래처 엑셀</b>을 올리면 활동을 대조해 <b>날짜·진행률·원가 수정안</b>을 만들고,
        <b> 어떤 선후행(CPM) 때문에 날짜가 안 바뀌는지</b>까지 짚어줍니다. 검토 후 수정된 XER을 내려받으세요.
      </p>

      {/* 업로드 */}
      <div style={{ ...CARD, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ fontSize: 13 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>① P6 공정표 (.xer)</div>
          <input type="file" accept=".xer" onChange={(e) => setXerFile(e.target.files?.[0] ?? null)} />
          {xerFile && <div style={{ color: "var(--green)", fontSize: 11.5, marginTop: 2 }}>{xerFile.name} ({Math.round(xerFile.size / 1024)}KB)</div>}
        </label>
        <label style={{ fontSize: 13 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>② 갱신 자료 (.xlsx/.csv)</div>
          <input type="file" accept=".xlsx,.xlsm,.xls,.csv" onChange={(e) => setDataFile(e.target.files?.[0] ?? null)} />
          {dataFile && <div style={{ color: "var(--green)", fontSize: 11.5, marginTop: 2 }}>{dataFile.name} ({Math.round(dataFile.size / 1024)}KB)</div>}
        </label>
        <label style={{ fontSize: 13 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>③ 갱신 방식 (거래처별)</div>
          <select className="wz-in" value={mode} onChange={(e) => setMode(e.target.value)} style={{ padding: "6px 8px" }}>
            <option value="auto">자동 감지</option>
            <option value="date">날짜</option>
            <option value="progress">진행률 (Units % Complete)</option>
            <option value="cost">원가 (Actual / At Completion Cost)</option>
          </select>
        </label>
        <button className="wz-btn" disabled={!xerFile || !dataFile || busy}
                style={{ background: "var(--primary)", color: "var(--surface)", fontWeight: 700, padding: "9px 18px" }}
                onClick={() => void run()}>
          {busy ? (status || "AI 대조 중…") + " (2~3분)" : "대조 · 수정안 생성"}
        </button>
        {err && <span style={{ color: "var(--red)", fontSize: 12.5 }}>{err}</span>}
      </div>

      {result && (
        <>
          {/* 요약 + 다운로드 */}
          <div style={{ ...CARD, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13 }}>
              <b>{result.summary}</b>
              <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 3 }}>
                활동 {result.task_count}개 · 반영 <b style={{ color: "var(--green)" }}>{result.applied}건</b>
                {result.blocked > 0 && <> · 선후행에 막힘 <b style={{ color: "var(--red)" }}>{result.blocked}건</b></>}
              </div>
            </div>
            <button className="wz-btn" onClick={download} disabled={!result.applied}
                    style={{ marginLeft: "auto", background: "var(--primary-deep)", color: "var(--surface)", fontWeight: 700 }}>
              ⬇ 수정된 XER 다운로드
            </button>
          </div>

          {/* 반영되는 수정 — 변경 전→후 대조표 */}
          {applied.length > 0 && (
            <div style={CARD}>
              <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 8px", color: "var(--green)" }}>
                ✓ 반영되는 수정 {applied.length}건 (다운로드 XER에 포함)
              </h3>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                  <thead>
                    <tr style={{ background: "var(--surface-soft)", color: "var(--muted-strong)" }}>
                      <th style={th}>활동코드</th><th style={th}>활동명</th><th style={th}>항목</th>
                      <th style={th}>변경 전</th><th style={th}>→</th><th style={th}>변경 후</th><th style={th}>엑셀 근거</th>
                    </tr>
                  </thead>
                  <tbody>
                    {applied.map((e, i) => <EditRow key={i} e={e} />)}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 선후행에 막힌 수정 — 어떤 선행이 막는지 */}
          {blocked.length > 0 && (
            <div style={{ ...CARD, border: "1px solid var(--red-soft)" }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px", color: "var(--red)" }}>
                ⚠ 선후행에 막혀 반영 안 되는 수정 {blocked.length}건
              </h3>
              <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 8px" }}>
                엑셀이 요청한 날짜지만 <b>아래 선행(CPM) 관계</b> 때문에 P6에서 그 날짜로 못 당깁니다. 선행 날짜나 관계를 먼저 조정하세요.
              </p>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                  <thead>
                    <tr style={{ background: "var(--surface-soft)", color: "var(--muted-strong)" }}>
                      <th style={th}>활동</th><th style={th}>요청 날짜</th><th style={th}>막는 선후행 (근본 원인)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {blocked.map((e, i) => (
                      <tr key={i} style={{ borderTop: "1px solid var(--surface-soft)" }}>
                        <td style={td}><code>{e.task_code}</code> {e.task_name}</td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>{e.field_ko} = {e.value}</td>
                        <td style={td}>
                          {(e.binding ?? []).map((b, j) => (
                            <div key={j} style={{ color: "var(--red)", marginBottom: 2 }}>
                              🔒 {b.note}
                              <span style={{ color: "var(--muted)" }}> — 선행 <code>{b.pred_code}</code></span>
                            </div>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result.edits.length === 0 && (
            <div style={{ ...CARD, color: "var(--muted)" }}>엑셀과 매칭되는 수정 활동을 찾지 못했습니다. 활동명이 대조 가능한 자료인지 확인하세요.</div>
          )}
        </>
      )}
    </div>
  );
}

function EditRow({ e }: { e: P6EditItem }) {
  return (
    <tr style={{ borderTop: "1px solid var(--surface-soft)" }}>
      <td style={td}><code>{e.task_code}</code></td>
      <td style={td}>{e.task_name}</td>
      <td style={{ ...td, whiteSpace: "nowrap" }}>{e.field_ko}</td>
      <td style={{ ...td, color: "var(--muted)", whiteSpace: "nowrap" }}>{e.old_value || "—"}</td>
      <td style={{ ...td, color: "var(--primary)" }}>→</td>
      <td style={{ ...td, fontWeight: 700, color: "var(--primary-deep)", whiteSpace: "nowrap" }}>{e.value}</td>
      <td style={{ ...td, color: "var(--muted-strong)" }}>{e.reason}</td>
    </tr>
  );
}
