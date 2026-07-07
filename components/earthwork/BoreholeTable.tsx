"use client";

/**
 * 시추공 편집 테이블 — CAD 팔레트처럼 셀 직접 수정 + 행 추가/삭제.
 *  · 편집은 내부 draft(rows) — 키 입력마다 3D 재빌드 안 함(성능).
 *  · [적용] → 3D·물량·단면 갱신, [DB 저장] → 영속(최신만 유지).
 */
import { useState } from "react";

import { LAYERS, type Borehole } from "../../lib/earthwork/model";

interface Props {
  boreholes: Borehole[];
  onApply: (bh: Borehole[]) => void;
  onSave: (bh: Borehole[]) => void | Promise<void>;
}

const emptyT = () => Object.fromEntries(LAYERS.map((l) => [l.key, 0]));

export function BoreholeTable({ boreholes, onApply, onSave }: Props) {
  // 초기 draft = boreholes 복제. 외부 데이터 변경(CSV·로드·적용)은 부모의 key 로 리마운트 동기.
  const [rows, setRows] = useState<Borehole[]>(() => boreholes.map((b) => ({ ...b, t: { ...b.t } })));
  const [busy, setBusy] = useState(false);

  const setCell = (i: number, field: keyof Borehole, val: string | number) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: val } : r)));
  const setLayer = (i: number, key: string, val: number) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, t: { ...r.t, [key]: val } } : r)));
  const addRow = () =>
    setRows((prev) => [...prev, { id: "NH-?", x: 0, y: 0, el: 0, depth: 0, gwl: 0, t: emptyT() }]);
  const delRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));

  const valid = () => rows.filter((r) => Number.isFinite(r.x) && Number.isFinite(r.y) && !(r.x === 0 && r.y === 0));

  const apply = () => {
    const v = valid();
    if (v.length < 2) { alert("좌표(X,Y) 있는 시추공이 2개 이상 필요합니다."); return; }
    onApply(v);
  };
  const save = async () => {
    const v = valid();
    if (v.length < 2) { alert("좌표(X,Y) 있는 시추공이 2개 이상 필요합니다."); return; }
    setBusy(true);
    try { await onSave(v); } finally { setBusy(false); }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
          시추공 데이터 편집 <span style={{ color: "var(--muted)", fontWeight: 500 }}>({rows.length})</span>
        </h3>
        <button type="button" onClick={addRow} style={btn("var(--surface)", "var(--muted-strong)", "var(--line-strong)")}>+ 행 추가</button>
        <button type="button" onClick={apply} style={btn("var(--primary)", "var(--surface)")}>적용 (3D·물량 갱신)</button>
        <button type="button" onClick={save} disabled={busy} style={btn(busy ? "var(--muted)" : "var(--green)", "var(--surface)")}>
          {busy ? "저장 중…" : "DB 저장"}
        </button>
      </div>

      <div style={{ overflowX: "auto", border: "1px solid var(--line)", borderRadius: 8 }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12.5, whiteSpace: "nowrap" }}>
          <thead>
            <tr style={{ background: "var(--surface-soft)", color: "var(--muted-strong)" }}>
              <Th>공번</Th><Th>X</Th><Th>Y</Th><Th>지표고</Th><Th>심도</Th><Th>지하수</Th>
              {LAYERS.map((l) => <Th key={l.key}>{l.label}</Th>)}
              <Th w={40} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderTop: "1px solid var(--surface-soft)" }}>
                <Td><Txt v={r.id} w={66} onCh={(x) => setCell(i, "id", x)} /></Td>
                <Td><Num v={r.x} w={84} onCh={(x) => setCell(i, "x", x)} /></Td>
                <Td><Num v={r.y} w={84} onCh={(x) => setCell(i, "y", x)} /></Td>
                <Td><Num v={r.el} onCh={(x) => setCell(i, "el", x)} /></Td>
                <Td><Num v={r.depth} onCh={(x) => setCell(i, "depth", x)} /></Td>
                <Td><Num v={r.gwl} onCh={(x) => setCell(i, "gwl", x)} /></Td>
                {LAYERS.map((l) => (
                  <Td key={l.key}><Num v={r.t[l.key] ?? 0} onCh={(x) => setLayer(i, l.key, x)} /></Td>
                ))}
                <td style={{ padding: "2px 4px", textAlign: "center" }}>
                  <button type="button" onClick={() => delRow(i)} title="삭제" style={delBtn}></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
        좌표(X,Y) 없는 행은 3D에서 제외됩니다. 편집 후 <strong>적용</strong>으로 갱신, <strong>DB 저장</strong>으로 영속.
      </p>
    </div>
  );
}

function Th({ children, w }: { children?: React.ReactNode; w?: number }) {
  return <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 600, width: w }}>{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: "2px 4px" }}>{children}</td>;
}
function Txt({ v, w, onCh }: { v: string; w?: number; onCh: (v: string) => void }) {
  return <input value={v} onChange={(e) => onCh(e.target.value)} style={inp(w ?? 56)} />;
}
function Num({ v, w, onCh }: { v: number; w?: number; onCh: (v: number) => void }) {
  return (
    <input
      value={String(v)}
      inputMode="decimal"
      onChange={(e) => onCh(Number(e.target.value) || 0)}
      style={{ ...inp(w ?? 52), textAlign: "right" }}
    />
  );
}
function inp(w: number): React.CSSProperties {
  return { width: w, padding: "4px 6px", border: "1px solid var(--line)", borderRadius: 5, fontSize: 12.5, background: "var(--surface)" };
}
function btn(bg: string, color: string, border?: string): React.CSSProperties {
  return {
    padding: "6px 12px", borderRadius: 8, border: border ? `1px solid ${border}` : "none",
    background: bg, color, fontSize: 13, fontWeight: 600, cursor: "pointer",
  };
}
const delBtn: React.CSSProperties = {
  border: "none", background: "transparent", color: "var(--muted-strong)", cursor: "pointer", fontSize: 13, fontWeight: 700,
};
