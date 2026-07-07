"use client";

/**
 * 토공/지반 — 시추주상도(NH 11공) 보간 3D 지층 모델 + 층별 토공 물량.
 *  · IDW 보간 입체 슬랩(층별 색) + 시추공 기둥.
 *  · 층별 체적(m³) = 격자 적분. 토사/풍화/암반 그룹 소계.
 */
import { Layers, Mountain, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { EarthworkViewer } from "../../../components/earthwork/EarthworkViewer";
import { EarthworkSection } from "../../../components/earthwork/EarthworkSection";
import { EarthworkDataEditor } from "../../../components/earthwork/EarthworkDataEditor";
import { CadImportPanel } from "../../../components/earthwork/CadImportPanel";
import {
  BOREHOLES, LAYERS, TERRAIN_PRESETS, buildGridModel, generateContours, layerVolumes, makeTerrainPreset,
  parseEarthworkCsv, polygonArea, prepare,
  type Borehole, type TerrainPt, type PileItem, type WallLine,
} from "../../../lib/earthwork/model";
import { loadEarthwork, saveEarthwork } from "../../../lib/api/earthwork";

/** 가장 멀리 떨어진 두 시추공 = 대표 단면 기본값. */
function Chip({ label, c }: { label: string; c: string }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: "#fff", background: c, padding: "3px 9px", borderRadius: 999 }}>
      {label}
    </span>
  );
}

function StatBox({ title, color, rows }: { title: string; color: string; rows: [string, string][] }) {
  return (
    <div style={{ border: "1px solid #eef1f6", borderRadius: 10, padding: 12, background: "#fbfcfe" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: 3, background: color, display: "inline-block" }} />
        <span style={{ fontWeight: 700, fontSize: 13, color: "#1e293b" }}>{title}</span>
      </div>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12, color: "#475569", padding: "2px 0" }}>
          <span>{k}</span>
          <strong style={{ color: "#334155" }}>{v}</strong>
        </div>
      ))}
    </div>
  );
}

/** 배열을 kind별 개수로 집계 → [["CIP","190개"], ...] */
function kindRows(arr: { kind: string }[]): [string, string][] {
  const m: Record<string, number> = {};
  for (const a of arr) m[a.kind] = (m[a.kind] ?? 0) + 1;
  return Object.entries(m).map(([k, n]) => [k, `${n}개`]);
}

function farthestPair(bores: Borehole[]): readonly [string, string] {
  if (bores.length < 2) return [bores[0]?.id ?? "", bores[0]?.id ?? ""] as const;
  let a = 0, b = 1, best = -1;
  for (let i = 0; i < bores.length; i++)
    for (let j = i + 1; j < bores.length; j++) {
      const d = Math.hypot(bores[i].x - bores[j].x, bores[i].y - bores[j].y);
      if (d > best) { best = d; a = i; b = j; }
    }
  return [bores[a].id, bores[b].id] as const;
}

const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;
const fmt = (n: number) => Math.round(n).toLocaleString();

export default function EarthworkPage() {
  const [boreholes, setBoreholes] = useState<Borehole[]>(BOREHOLES);
  const [source, setSource] = useState("샘플 (시추 11공)");
  const [extra, setExtra] = useState<{ terrain: TerrainPt[]; boundary: { x: number; y: number }[]; piles: PileItem[]; walls: WallLine[] }>(
    { terrain: [], boundary: [], piles: [], walls: [] },
  );
  const fileRef = useRef<HTMLInputElement>(null);

  const set = useMemo(() => prepare(boreholes), [boreholes]);
  const model = useMemo(() => buildGridModel(boreholes, 2, extra.boundary), [boreholes, extra.boundary]);
  // 대지경계선(로컬좌표) — 토공량 클리핑·면적용
  const clipLocal = useMemo(
    () => extra.boundary.map((p) => ({ x: p.x - model.minX, y: p.y - model.minY })),
    [extra.boundary, model.minX, model.minY],
  );
  const [clip, setClip] = useState(true);
  const useClip = clip && clipLocal.length >= 3;
  const vols = useMemo(() => layerVolumes(model, useClip ? clipLocal : undefined), [model, useClip, clipLocal]);
  // 등고선 생성 (표고점 → 마칭스퀘어). 끄면 미생성(성능).
  const [showContour, setShowContour] = useState(false);
  const [contourInterval, setContourInterval] = useState(1);
  // ##TERRAIN 있으면 그걸로, 없으면 시추공 지표고로 등고선 생성.
  const terrainForContour = useMemo(
    () => (extra.terrain.length >= 3 ? extra.terrain : boreholes.map((b) => ({ x: b.x, y: b.y, z: b.el }))),
    [extra.terrain, boreholes],
  );
  const contours = useMemo(
    () => (showContour && terrainForContour.length >= 3 ? generateContours(terrainForContour, contourInterval) : []),
    [showContour, terrainForContour, contourInterval],
  );
  const [visible, setVisible] = useState<Record<string, boolean>>(
    () => Object.fromEntries(LAYERS.map((L) => [L.key, true])),
  );
  const [[secA, secB], setSec] = useState<readonly [string, string]>(() => farthestPair(BOREHOLES));
  const [showLabels, setShowLabels] = useState(true);

  const toggle = (key: string) => setVisible((v) => ({ ...v, [key]: !v[key] }));
  const bhA = boreholes.find((b) => b.id === secA) ?? boreholes[0];
  const bhB = boreholes.find((b) => b.id === secB) ?? boreholes[1];

  // 마운트 시 저장 모델 복원 — 시추 + extra(경계·Pile·흙막이·지형) 모두 DB(네온). localStorage 는 오프라인 폴백.
  useEffect(() => {
    let cached: { boreholes?: Borehole[]; extra?: typeof extra } | null = null;
    try {
      const raw = localStorage.getItem("earthwork-model");
      if (raw) cached = JSON.parse(raw);
    } catch { /* 무시 */ }

    void loadEarthwork().then(({ boreholes: saved, extra: dbExtra }) => {
      const dbHas = !!(dbExtra && ((dbExtra.boundary as unknown[])?.length || (dbExtra.piles as unknown[])?.length
        || (dbExtra.walls as unknown[])?.length || (dbExtra.terrain as unknown[])?.length));
      const ex = (dbHas ? dbExtra : cached?.extra) as typeof extra | undefined;
      if (ex) setExtra(ex);
      const bh = saved.length >= 2 ? saved : (cached?.boreholes ?? []);
      if (bh.length >= 2) {
        setBoreholes(bh);
        setSec(farthestPair(bh));
        const tags: string[] = [];
        if (ex?.boundary?.length) tags.push(`경계 ${ex.boundary.length}점`);
        if (ex?.piles?.length) tags.push(`Pile ${ex.piles.length}`);
        if (ex?.walls?.length) tags.push(`흙막이 ${ex.walls.length}`);
        setSource(`저장됨 (시추 ${bh.length}공${tags.length ? ` + ${tags.join(", ")}` : ""})`);
      }
    });
  }, []);

  // CSV 텍스트 → 3D·물량·단면 재구성 (파일 업로드 / CAD 추출 공용).
  const applyCsvText = async (text: string, label: string) => {
    const data = parseEarthworkCsv(text);
    const parsed = data.boreholes;
    const nothing = parsed.length < 2 && !data.boundary.length && !data.piles.length && !data.walls.length && !data.terrain.length;
    if (nothing) {
      alert("유효한 데이터가 없습니다. CSV 헤더/좌표(X,Y 또는 X_cad) 또는 ##섹션을 확인하세요.");
      return;
    }
    const newExtra = { terrain: data.terrain, boundary: data.boundary, piles: data.piles, walls: data.walls };
    setExtra(newExtra);
    if (parsed.length >= 2) { setBoreholes(parsed); setSec(farthestPair(parsed)); }
    const bhForCache = parsed.length >= 2 ? parsed : boreholes;
    try { localStorage.setItem("earthwork-model", JSON.stringify({ boreholes: bhForCache, extra: newExtra })); } catch { /* 용량초과 무시 */ }

    const ex: string[] = [];
    if (data.terrain.length) ex.push(`지형 ${data.terrain.length}점`);
    if (data.boundary.length) ex.push(`경계 ${data.boundary.length}점`);
    if (data.piles.length) ex.push(`Pile ${data.piles.length}`);
    if (data.walls.length) ex.push(`흙막이 ${data.walls.length}`);
    const suffix = ex.length ? ` + ${ex.join(", ")}` : "";

    if (parsed.length < 2) {
      // CAD 추출 등 시추공 위치가 없거나 부족 — extra 만 반영, 지층 두께는 시추표 수동입력.
      setSource(`${label}${suffix} · 시추공 지층 두께 입력 필요`);
      return;
    }
    // DB(네온) 저장 — 시추+extra 기존 교체(최신만, owner 개인화). 백엔드 미가동이면 화면만.
    try {
      const n = await saveEarthwork(parsed, newExtra);
      setSource(`${label} (저장됨 ${n}공${suffix})`);
    } catch {
      setSource(`${label} (시추 ${parsed.length}공${suffix} · 저장 실패-화면만)`);
    }
  };

  // CSV 업로드 → 그 데이터로 3D·물량·단면 전부 재구성.
  const onCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) e.target.value = "";
    if (!f) return;
    await applyCsvText(await f.text(), f.name);
  };

  // 그룹 소계 + 총계
  const groupTotal: Record<string, number> = {};
  let grand = 0;
  for (const v of vols) {
    groupTotal[v.group] = (groupTotal[v.group] ?? 0) + v.volume;
    grand += v.volume;
  }

  const CARD: React.CSSProperties = {
    background: "#fff", border: "1px solid #e8ecf2", borderRadius: 14,
    boxShadow: "0 1px 3px rgba(16,24,40,0.05)", padding: 16, marginBottom: 16,
  };

  return (
    <div className="ws-inner-pad" style={{ maxWidth: "none" }}>
      <div className="ws-section-title">
        <Mountain size={18} strokeWidth={1.8} />
        토공 / 지반
      </div>
      <p className="ws-section-desc">
        시추 {boreholes.length}공을 IDW 보간한 3D 지층 모델·층별 토공 물량·단면도입니다.
        부지 약 {Math.round(model.width)}×{Math.round(model.depthY)}m.
      </p>

      {/* ── 컨트롤 카드 ── */}
      <div style={CARD}>
        {/* 업로드 + 상태 + 가져온 데이터 */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <input ref={fileRef} type="file" accept=".csv" onChange={onCsv} style={{ display: "none" }} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px", borderRadius: 10,
              border: "none", background: "linear-gradient(180deg,#3b82f6,#2563eb)", color: "#fff",
              fontSize: 14, fontWeight: 600, cursor: "pointer", boxShadow: "0 1px 2px rgba(37,99,235,0.4)",
            }}
          >
            <Upload size={15} strokeWidth={2.2} />
            CSV 업로드
          </button>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 13, color: "#334155", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {source}
            </span>
            <span style={{ fontSize: 11, color: "#94a3b8" }}>시추 CSV · add 통합 CSV(##섹션) 지원</span>
          </div>
          {(extra.terrain.length > 0 || extra.boundary.length > 0 || extra.piles.length > 0 || extra.walls.length > 0) && (
            <span style={{ display: "flex", gap: 6, flexWrap: "wrap", marginLeft: "auto" }}>
              {extra.terrain.length > 0 && <Chip label={`지형 ${extra.terrain.length}점`} c="#0e7490" />}
              {extra.boundary.length > 0 && <Chip label={`경계 ${extra.boundary.length}점`} c="#15803d" />}
              {extra.piles.length > 0 && <Chip label={`Pile ${extra.piles.length}`} c="#b45309" />}
              {extra.walls.length > 0 && <Chip label={`흙막이 ${extra.walls.length}`} c="#be123c" />}
            </span>
          )}
        </div>

        {/* CAD(DXF) 멀티 임포트 → 의미기반 추출 → CSV 생성·적용 */}
        <CadImportPanel onGenerated={applyCsvText} />

        {/* 프리셋 + 옵션 */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 14, paddingTop: 14, borderTop: "1px solid #f1f5f9" }}>
          <span style={{ fontSize: 12, color: "#64748b", fontWeight: 700 }}>지형 프리셋</span>
          {TERRAIN_PRESETS.map((p) => (
            <button
              key={p.kind}
              type="button"
              title={p.desc}
              onClick={() => {
                const bh = makeTerrainPreset(p.kind);
                setBoreholes(bh);
                setSec(farthestPair(bh));
                setSource(`프리셋: ${p.label} (가상 ${bh.length}공)`);
              }}
              style={{ padding: "6px 13px", borderRadius: 999, border: "1px solid #d8dee8", background: "#fff", color: "#475569", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
            >
              {p.label}
            </button>
          ))}

          {clipLocal.length >= 3 && (
            <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#334155", cursor: "pointer", marginLeft: 4 }}>
              <input type="checkbox" checked={clip} onChange={(e) => setClip(e.target.checked)} />
              경계 내부만 ({fmt(polygonArea(clipLocal))}㎡)
            </label>
          )}
          {terrainForContour.length >= 3 && (
            <label
              style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#334155", cursor: "pointer" }}
              title={extra.terrain.length >= 3 ? "지형 표고점 기반" : "지형 데이터 없음 → 시추공 지표고 기반(평탄하면 간격 0.1m)"}
            >
              <input type="checkbox" checked={showContour} onChange={(e) => setShowContour(e.target.checked)} />
              등고선
              <input
                type="number" min={0.1} step={0.5} value={contourInterval}
                onChange={(e) => setContourInterval(Math.max(0.1, Number(e.target.value) || 1))}
                style={{ width: 50, padding: "2px 5px", fontSize: 12, border: "1px solid #d8dee8", borderRadius: 6 }}
              />
              m{showContour ? ` · ${contours.length}선` : ""}
            </label>
          )}
        </div>
      </div>

      {/* ── 3D 뷰어 카드 (상단 컨트롤바 + 뷰어) ── */}
      <div style={{ ...CARD, padding: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center", padding: "10px 14px", borderBottom: "1px solid #eef1f6", background: "#fafbfd" }}>
          <button
            type="button"
            onClick={() => setShowLabels((v) => !v)}
            style={{
              padding: "4px 11px", borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: "pointer",
              border: "1px solid " + (showLabels ? "#2563eb" : "#d8dee8"),
              background: showLabels ? "#2563eb" : "#fff",
              color: showLabels ? "#fff" : "#64748b",
            }}
            title="시추공 공번 라벨 표시/숨김"
          >
            🏷 시추공 라벨 {showLabels ? "ON" : "OFF"}
          </button>
          <span style={{ width: 1, height: 16, background: "#e2e8f0", margin: "0 2px" }} />
          <Layers size={14} strokeWidth={1.8} style={{ color: "#94a3b8" }} />
          {LAYERS.map((L) => (
            <button
              key={L.key}
              type="button"
              onClick={() => toggle(L.key)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px",
                borderRadius: 999, border: "1px solid #e2e8f0", fontSize: 11.5, fontWeight: 600,
                background: visible[L.key] ? "#fff" : "#f1f5f9",
                color: visible[L.key] ? "#334155" : "#a8b3c2", cursor: "pointer",
                opacity: visible[L.key] ? 1 : 0.55,
              }}
              title={visible[L.key] ? "숨기기" : "표시"}
            >
              <span style={{ width: 11, height: 11, borderRadius: 3, background: hex(L.color), display: "inline-block" }} />
              {L.label}
            </button>
          ))}
        </div>
        <div style={{ position: "relative", height: "60vh", minHeight: 420 }}>
          <EarthworkViewer
            model={model}
            visible={visible}
            boreholes={boreholes}
            showLabels={showLabels}
            terrain={extra.terrain}
            boundary={extra.boundary}
            piles={extra.piles}
            walls={extra.walls}
            contours={contours}
          />
        </div>
      </div>

      {/* ── 가져온 CAD 데이터 (CSV ##섹션 전체) ── */}
      {(extra.boundary.length >= 3 || extra.piles.length > 0 || extra.walls.length > 0 || extra.terrain.length > 0) && (
        <div style={CARD}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1e293b", margin: "0 0 12px" }}>가져온 CAD 데이터</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
            {extra.boundary.length >= 3 && (
              <StatBox title="대지경계선" color="#15803d" rows={[["꼭짓점", `${extra.boundary.length}점`], ["면적", `${fmt(polygonArea(clipLocal))} ㎡`]]} />
            )}
            {extra.piles.length > 0 && (
              <StatBox title="Pile" color="#b45309" rows={[["총", `${extra.piles.length}개`], ...kindRows(extra.piles)]} />
            )}
            {extra.walls.length > 0 && (
              <StatBox title="흙막이 벽" color="#be123c" rows={[["벽 수", `${extra.walls.length}개`], ...kindRows(extra.walls)]} />
            )}
            {extra.terrain.length > 0 && (
              <StatBox title="지형 표고점" color="#0e7490" rows={[["점", `${extra.terrain.length}개`]]} />
            )}
          </div>
          <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 10, marginBottom: 0 }}>
            CSV ##섹션에서 읽은 값 · 3D에 함께 표시됨 (검수용)
          </p>
        </div>
      )}

      {/* ── 하단 2단: 물량표 + 단면도 ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(440px, 1fr))", gap: 16, alignItems: "start" }}>
        {/* 물량표 카드 */}
        <div style={CARD}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1e293b", margin: "0 0 12px" }}>층별 토공 물량</h3>
          <div style={{ overflowX: "auto", border: "1px solid #eef1f6", borderRadius: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f8fafc", color: "#475569" }}>
                  <th style={th()}>구분</th>
                  <th style={th()}>지층</th>
                  <th style={th(true)}>물량 (m³)</th>
                  <th style={th(true)}>비율</th>
                </tr>
              </thead>
              <tbody>
                {(["토사", "풍화", "암반"] as const).map((grp) => {
                  const rows = vols.filter((v) => v.group === grp);
                  return rows.map((v, i) => (
                    <tr key={v.key} style={{ borderTop: "1px solid #f1f5f9" }}>
                      {i === 0 && (
                        <td rowSpan={rows.length} style={{ ...td(), fontWeight: 700, color: "#334155", verticalAlign: "top", background: "#fbfcfe" }}>
                          {grp}
                          <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 500 }}>
                            {fmt(groupTotal[grp])} m³
                          </div>
                        </td>
                      )}
                      <td style={td()}>
                        <span style={{ width: 10, height: 10, borderRadius: 2, background: hex(v.color), display: "inline-block", marginRight: 6 }} />
                        {v.label}
                      </td>
                      <td style={td(true)}>{fmt(v.volume)}</td>
                      <td style={td(true)}>{grand ? ((v.volume / grand) * 100).toFixed(1) : "0"}%</td>
                    </tr>
                  ));
                })}
                <tr style={{ borderTop: "2px solid #cbd5e1", background: "#f8fafc", fontWeight: 700 }}>
                  <td style={td()} colSpan={2}>합계</td>
                  <td style={td(true)}>{fmt(grand)}</td>
                  <td style={td(true)}>100%</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 10, marginBottom: 0 }}>
            ※ IDW 보간 추정치. {clipLocal.length >= 3 && clip ? "대지경계선 내부 기준." : "전체 격자 기준."} 외곽·심부는 오차가 큽니다.
          </p>
        </div>

        {/* 단면도 카드 */}
        <div style={CARD}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1e293b", margin: 0 }}>지질 단면도</h3>
            <select value={secA} onChange={(e) => setSec([e.target.value, secB])} style={selStyle}>
              {boreholes.map((b) => <option key={b.id} value={b.id}>{b.id}</option>)}
            </select>
            <span style={{ color: "#94a3b8" }}>→</span>
            <select value={secB} onChange={(e) => setSec([secA, e.target.value])} style={selStyle}>
              {boreholes.map((b) => <option key={b.id} value={b.id}>{b.id}</option>)}
            </select>
            <span style={{ fontSize: 11, color: "#94a3b8" }}>지하수위 ─ ─ 청색</span>
          </div>
          {bhA && bhB && (
            <EarthworkSection set={set} boreholes={boreholes} ax={bhA.x} ay={bhA.y} bx={bhB.x} by={bhB.y} aLabel={bhA.id} bLabel={bhB.id} />
          )}
        </div>
      </div>

      {/* ── 시추공 편집 카드 ── */}
      <div style={CARD}>
        <EarthworkDataEditor
          key={source}
          boreholes={boreholes}
          extra={extra}
          onApply={(bh, ex) => {
            setBoreholes(bh); setExtra(ex);
            if (bh.length >= 2) setSec(farthestPair(bh));
            setSource(`편집 적용 (${bh.length}공)`);
          }}
          onSave={async (bh, ex) => {
            setBoreholes(bh); setExtra(ex);
            if (bh.length >= 2) setSec(farthestPair(bh));
            try { const n = await saveEarthwork(bh, ex); setSource(`저장됨 (${n}공)`); }
            catch { setSource(`${bh.length}공 · 저장 실패-화면만`); }
          }}
        />
      </div>
    </div>
  );
}

const selStyle: React.CSSProperties = {
  padding: "4px 8px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, background: "#fff", color: "#1e293b",
};

function th(right?: boolean): React.CSSProperties {
  return { padding: "8px 12px", textAlign: right ? "right" : "left", fontWeight: 600, whiteSpace: "nowrap" };
}
function td(right?: boolean): React.CSSProperties {
  return { padding: "7px 12px", textAlign: right ? "right" : "left" };
}
