"use client";

/**
 * 토공 데이터 편집기 — ##섹션 전체 CSV CRUD. 탭: 시추공·경계·파일·흙막이·지형.
 *  · 시추공/경계/파일/흙막이 = 행 CRUD.  지형 = 개수 표시 + 비우기(가져오기는 상단 CSV/CAD 임포트).
 *  · [CSV 내보내기] = 현재 상태 → ##섹션 CSV 다운로드.  [적용] = 3D·물량 갱신.  [DB 저장] = 영속.
 */
import { useState } from "react";

import { LAYERS, type Borehole, type TerrainPt, type PileItem, type WallLine } from "../../lib/earthwork/model";
import { earthworkToCsv } from "../../lib/earthwork/csvExport";

export interface Extra { terrain: TerrainPt[]; boundary: { x: number; y: number }[]; piles: PileItem[]; walls: WallLine[]; }
interface Props {
  boreholes: Borehole[];
  extra: Extra;
  onApply: (boreholes: Borehole[], extra: Extra) => void;
  onSave: (boreholes: Borehole[], extra: Extra) => void | Promise<void>;
}

type Tab = "boreholes" | "boundary" | "piles" | "walls" | "terrain";
const emptyT = () => Object.fromEntries(LAYERS.map((l) => [l.key, 0]));

export function EarthworkDataEditor({ boreholes, extra, onApply, onSave }: Props) {
  const [tab, setTab] = useState<Tab>("boreholes");
  const [rows, setRows] = useState<Borehole[]>(() => boreholes.map((b) => ({ ...b, t: { ...b.t } })));
  const [boundary, setBoundary] = useState(() => extra.boundary.map((p) => ({ ...p })));
  const [piles, setPiles] = useState(() => extra.piles.map((p) => ({ ...p })));
  const [walls, setWalls] = useState(() => extra.walls.map((w) => ({ kind: w.kind, points: w.points.map((p) => ({ ...p })) })));
  const [terrain, setTerrain] = useState(() => extra.terrain);
  const [busy, setBusy] = useState(false);

  const collect = () => {
    const validBores = rows.filter((r) => Number.isFinite(r.x) && Number.isFinite(r.y) && !(r.x === 0 && r.y === 0));
    return { boreholes: validBores, ex: { terrain, boundary, piles, walls } as Extra };
  };
  const hasAny = () => rows.length || boundary.length || piles.length || walls.length || terrain.length;

  const apply = () => {
    if (!hasAny()) { alert("편집할 데이터가 없습니다."); return; }
    const { boreholes: b, ex } = collect();
    onApply(b, ex);
  };
  const save = async () => {
    if (!hasAny()) { alert("저장할 데이터가 없습니다."); return; }
    const { boreholes: b, ex } = collect();
    setBusy(true);
    try { await onSave(b, ex); } finally { setBusy(false); }
  };
  const exportCsv = () => {
    const { boreholes: b, ex } = collect();
    const blob = new Blob([earthworkToCsv({ boreholes: b, ...ex })], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "토공데이터.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const TABS: { id: Tab; label: string; n: number }[] = [
    { id: "boreholes", label: "시추공", n: rows.length },
    { id: "boundary", label: "경계", n: boundary.length },
    { id: "piles", label: "파일", n: piles.length },
    { id: "walls", label: "흙막이", n: walls.length },
    { id: "terrain", label: "지형", n: terrain.length },
  ];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginRight: 4 }}>토공 데이터 편집</h3>
        <button type="button" onClick={exportCsv} style={btn("var(--surface)", "var(--muted-strong)", "var(--line-strong)")}>CSV 내보내기</button>
        <button type="button" onClick={apply} style={btn("var(--primary)", "var(--surface)")}>적용 (3D·물량 갱신)</button>
        <button type="button" onClick={save} disabled={busy} style={btn(busy ? "var(--muted)" : "var(--green)", "var(--surface)")}>
          {busy ? "저장 중…" : "DB 저장"}
        </button>
      </div>

      {/* 탭 */}
      <div style={{ display: "flex", gap: 4, marginBottom: 10, flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            style={{
              padding: "5px 12px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
              border: `1px solid ${tab === t.id ? "var(--primary)" : "var(--line)"}`,
              background: tab === t.id ? "var(--primary-soft)" : "var(--surface)", color: tab === t.id ? "var(--primary)" : "var(--muted)",
            }}>
            {t.label} <span style={{ opacity: 0.7 }}>{t.n}</span>
          </button>
        ))}
      </div>

      {tab === "boreholes" && <BoreholeTab rows={rows} setRows={setRows} />}
      {tab === "boundary" && <PointTab title="경계 꼭짓점" pts={boundary} setPts={setBoundary} />}
      {tab === "piles" && <PileTab piles={piles} setPiles={setPiles} />}
      {tab === "walls" && <WallTab walls={walls} setWalls={setWalls} />}
      {tab === "terrain" && <TerrainTab terrain={terrain} clear={() => setTerrain([])} />}

      <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>
        편집 후 <strong>적용</strong>으로 3D·물량 갱신, <strong>DB 저장</strong>으로 영속. <strong>CSV 내보내기</strong>로 ##섹션 CSV 파일 생성.
      </p>
    </div>
  );
}

/* ── 시추공 탭 ── */
function BoreholeTab({ rows, setRows }: { rows: Borehole[]; setRows: React.Dispatch<React.SetStateAction<Borehole[]>> }) {
  const setCell = (i: number, f: keyof Borehole, v: string | number) => setRows((p) => p.map((r, idx) => (idx === i ? { ...r, [f]: v } : r)));
  const setLayer = (i: number, k: string, v: number) => setRows((p) => p.map((r, idx) => (idx === i ? { ...r, t: { ...r.t, [k]: v } } : r)));
  const add = () => setRows((p) => [...p, { id: "NH-?", x: 0, y: 0, el: 0, depth: 0, gwl: 0, t: emptyT() }]);
  const del = (i: number) => setRows((p) => p.filter((_, idx) => idx !== i));
  return (
    <>
      <AddBar onAdd={add} label="+ 시추공 추가" />
      <Scroll>
        <table style={tbl}>
          <thead><tr style={thr}>
            <Th>공번</Th><Th>X</Th><Th>Y</Th><Th>지표고</Th><Th>심도</Th><Th>지하수</Th>
            {LAYERS.map((l) => <Th key={l.key}>{l.label}</Th>)}<Th w={36} />
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={trb}>
                <Td><Txt v={r.id} w={64} onCh={(x) => setCell(i, "id", x)} /></Td>
                <Td><Num v={r.x} w={82} onCh={(x) => setCell(i, "x", x)} /></Td>
                <Td><Num v={r.y} w={82} onCh={(x) => setCell(i, "y", x)} /></Td>
                <Td><Num v={r.el} onCh={(x) => setCell(i, "el", x)} /></Td>
                <Td><Num v={r.depth} onCh={(x) => setCell(i, "depth", x)} /></Td>
                <Td><Num v={r.gwl} onCh={(x) => setCell(i, "gwl", x)} /></Td>
                {LAYERS.map((l) => <Td key={l.key}><Num v={r.t[l.key] ?? 0} onCh={(x) => setLayer(i, l.key, x)} /></Td>)}
                <Td><Del onClick={() => del(i)} /></Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Scroll>
    </>
  );
}

/* ── 경계 탭 (점 목록) ── */
function PointTab({ title, pts, setPts }: { title: string; pts: { x: number; y: number }[]; setPts: React.Dispatch<React.SetStateAction<{ x: number; y: number }[]>> }) {
  const set = (i: number, f: "x" | "y", v: number) => setPts((p) => p.map((q, idx) => (idx === i ? { ...q, [f]: v } : q)));
  const add = () => setPts((p) => [...p, { x: 0, y: 0 }]);
  const del = (i: number) => setPts((p) => p.filter((_, idx) => idx !== i));
  return (
    <>
      <AddBar onAdd={add} label={`+ ${title} 추가`} />
      <Scroll>
        <table style={tbl}>
          <thead><tr style={thr}><Th w={40}>#</Th><Th>X</Th><Th>Y</Th><Th w={36} /></tr></thead>
          <tbody>
            {pts.map((p, i) => (
              <tr key={i} style={trb}>
                <Td><span style={{ fontSize: 12, color: "var(--muted)", padding: "0 6px" }}>{i + 1}</span></Td>
                <Td><Num v={p.x} w={110} onCh={(x) => set(i, "x", x)} /></Td>
                <Td><Num v={p.y} w={110} onCh={(x) => set(i, "y", x)} /></Td>
                <Td><Del onClick={() => del(i)} /></Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Scroll>
    </>
  );
}

/* ── 파일 탭 ── */
function PileTab({ piles, setPiles }: { piles: PileItem[]; setPiles: React.Dispatch<React.SetStateAction<PileItem[]>> }) {
  const set = (i: number, f: keyof PileItem, v: string | number) => setPiles((p) => p.map((q, idx) => (idx === i ? { ...q, [f]: v } : q)));
  const add = () => setPiles((p) => [...p, { kind: "Pile", x: 0, y: 0, dia: 0, length: 0 }]);
  const del = (i: number) => setPiles((p) => p.filter((_, idx) => idx !== i));
  return (
    <>
      <AddBar onAdd={add} label="+ 파일 추가" />
      <Scroll>
        <table style={tbl}>
          <thead><tr style={thr}><Th>종류</Th><Th>X</Th><Th>Y</Th><Th>지름(m)</Th><Th>길이(m)</Th><Th w={36} /></tr></thead>
          <tbody>
            {piles.map((p, i) => (
              <tr key={i} style={trb}>
                <Td><Txt v={p.kind} w={90} onCh={(x) => set(i, "kind", x)} /></Td>
                <Td><Num v={p.x} w={100} onCh={(x) => set(i, "x", x)} /></Td>
                <Td><Num v={p.y} w={100} onCh={(x) => set(i, "y", x)} /></Td>
                <Td><Num v={p.dia} onCh={(x) => set(i, "dia", x)} /></Td>
                <Td><Num v={p.length} onCh={(x) => set(i, "length", x)} /></Td>
                <Td><Del onClick={() => del(i)} /></Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Scroll>
    </>
  );
}

/* ── 흙막이 탭 (벽별 점 목록) ── */
function WallTab({ walls, setWalls }: { walls: WallLine[]; setWalls: React.Dispatch<React.SetStateAction<WallLine[]>> }) {
  const addWall = () => setWalls((p) => [...p, { kind: "Wall", points: [{ x: 0, y: 0 }, { x: 0, y: 0 }] }]);
  const delWall = (wi: number) => setWalls((p) => p.filter((_, idx) => idx !== wi));
  const setKind = (wi: number, v: string) => setWalls((p) => p.map((w, idx) => (idx === wi ? { ...w, kind: v } : w)));
  const setPt = (wi: number, pi: number, f: "x" | "y", v: number) =>
    setWalls((p) => p.map((w, idx) => (idx === wi ? { ...w, points: w.points.map((q, j) => (j === pi ? { ...q, [f]: v } : q)) } : w)));
  const addPt = (wi: number) => setWalls((p) => p.map((w, idx) => (idx === wi ? { ...w, points: [...w.points, { x: 0, y: 0 }] } : w)));
  const delPt = (wi: number, pi: number) => setWalls((p) => p.map((w, idx) => (idx === wi ? { ...w, points: w.points.filter((_, j) => j !== pi) } : w)));
  return (
    <>
      <AddBar onAdd={addWall} label="+ 흙막이 벽 추가" />
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {walls.map((w, wi) => (
          <div key={wi} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>벽 {wi + 1}</span>
              <Txt v={w.kind} w={110} onCh={(x) => setKind(wi, x)} />
              <span style={{ fontSize: 11, color: "var(--muted)" }}>{w.points.length}점</span>
              <button type="button" onClick={() => addPt(wi)} style={{ ...btn("var(--surface)", "var(--muted-strong)", "var(--line-strong)"), padding: "3px 8px", fontSize: 12 }}>+ 점</button>
              <button type="button" onClick={() => delWall(wi)} style={{ marginLeft: "auto", ...btn("var(--surface)", "var(--red)", "var(--red-soft)"), padding: "3px 8px", fontSize: 12 }}>벽 삭제</button>
            </div>
            <Scroll>
              <table style={tbl}>
                <thead><tr style={thr}><Th w={40}>#</Th><Th>X</Th><Th>Y</Th><Th w={36} /></tr></thead>
                <tbody>
                  {w.points.map((p, pi) => (
                    <tr key={pi} style={trb}>
                      <Td><span style={{ fontSize: 12, color: "var(--muted)", padding: "0 6px" }}>{pi + 1}</span></Td>
                      <Td><Num v={p.x} w={100} onCh={(x) => setPt(wi, pi, "x", x)} /></Td>
                      <Td><Num v={p.y} w={100} onCh={(x) => setPt(wi, pi, "y", x)} /></Td>
                      <Td><Del onClick={() => delPt(wi, pi)} /></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Scroll>
          </div>
        ))}
        {walls.length === 0 && <Empty label="흙막이 벽이 없습니다." />}
      </div>
    </>
  );
}

/* ── 지형 탭 (개수 + 비우기) ── */
function TerrainTab({ terrain, clear }: { terrain: TerrainPt[]; clear: () => void }) {
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "16px 18px" }}>
      <div style={{ fontSize: 14, color: "var(--muted-strong)" }}>
        지형 표고점 <strong style={{ color: "var(--teal)" }}>{terrain.length.toLocaleString()}</strong>개
      </div>
      <p style={{ fontSize: 12, color: "var(--muted)", margin: "6px 0 12px" }}>
        지형은 점 수가 많아 행 편집 대신 <strong>가져오기(상단 CSV/CAD 임포트)</strong>와 <strong>비우기</strong>만 제공합니다.
      </p>
      <button type="button" onClick={clear} disabled={terrain.length === 0} style={btn(terrain.length ? "var(--surface)" : "var(--surface-soft)", terrain.length ? "var(--red)" : "var(--line-strong)", "var(--red-soft)")}>
        지형 비우기
      </button>
    </div>
  );
}

/* ── 공용 UI ── */
function AddBar({ onAdd, label }: { onAdd: () => void; label: string }) {
  return <div style={{ marginBottom: 8 }}><button type="button" onClick={onAdd} style={btn("var(--surface)", "var(--muted-strong)", "var(--line-strong)")}>{label}</button></div>;
}
function Empty({ label }: { label: string }) {
  return <div style={{ fontSize: 13, color: "var(--muted)", padding: "12px 4px" }}>{label}</div>;
}
function Scroll({ children }: { children: React.ReactNode }) {
  return <div style={{ overflowX: "auto", border: "1px solid var(--line)", borderRadius: 8 }}>{children}</div>;
}
function Th({ children, w }: { children?: React.ReactNode; w?: number }) {
  return <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 600, width: w }}>{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) { return <td style={{ padding: "2px 4px" }}>{children}</td>; }
function Txt({ v, w, onCh }: { v: string; w?: number; onCh: (v: string) => void }) {
  return <input value={v} onChange={(e) => onCh(e.target.value)} style={inp(w ?? 56)} />;
}
function Num({ v, w, onCh }: { v: number; w?: number; onCh: (v: number) => void }) {
  return <input value={String(v)} inputMode="decimal" onChange={(e) => onCh(Number(e.target.value) || 0)} style={{ ...inp(w ?? 52), textAlign: "right" }} />;
}
function Del({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} title="삭제" style={{ border: "none", background: "transparent", color: "var(--line-strong)", cursor: "pointer", fontSize: 13, fontWeight: 700 }}></button>;
}
function inp(w: number): React.CSSProperties {
  return { width: w, padding: "4px 6px", border: "1px solid var(--line)", borderRadius: 5, fontSize: 12.5, background: "var(--surface)" };
}
function btn(bg: string, color: string, border?: string): React.CSSProperties {
  return { padding: "6px 12px", borderRadius: 8, border: border ? `1px solid ${border}` : "none", background: bg, color, fontSize: 13, fontWeight: 600, cursor: "pointer" };
}
const tbl: React.CSSProperties = { borderCollapse: "collapse", fontSize: 12.5, whiteSpace: "nowrap" };
const thr: React.CSSProperties = { background: "var(--surface-soft)", color: "var(--muted-strong)" };
const trb: React.CSSProperties = { borderTop: "1px solid var(--surface-soft)" };
