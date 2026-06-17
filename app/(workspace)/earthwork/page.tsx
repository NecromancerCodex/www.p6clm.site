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
import { BoreholeTable } from "../../../components/earthwork/BoreholeTable";
import {
  BOREHOLES, LAYERS, TERRAIN_PRESETS, buildGridModel, generateContours, layerVolumes, makeTerrainPreset,
  parseEarthworkCsv, polygonArea, prepare,
  type Borehole, type TerrainPt, type PileItem,
} from "../../../lib/earthwork/model";
import { loadBoreholes, saveBoreholes } from "../../../lib/api/earthwork";

/** 가장 멀리 떨어진 두 시추공 = 대표 단면 기본값. */
function Chip({ label, c }: { label: string; c: string }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: "#fff", background: c, padding: "3px 9px", borderRadius: 999 }}>
      {label}
    </span>
  );
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
  const [extra, setExtra] = useState<{ terrain: TerrainPt[]; boundary: { x: number; y: number }[]; piles: PileItem[] }>(
    { terrain: [], boundary: [], piles: [] },
  );
  const fileRef = useRef<HTMLInputElement>(null);

  const set = useMemo(() => prepare(boreholes), [boreholes]);
  const model = useMemo(() => buildGridModel(boreholes, 2), [boreholes]);
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
  const contours = useMemo(
    () => (showContour && extra.terrain.length >= 3 ? generateContours(extra.terrain, contourInterval) : []),
    [showContour, extra.terrain, contourInterval],
  );
  const [visible, setVisible] = useState<Record<string, boolean>>(
    () => Object.fromEntries(LAYERS.map((L) => [L.key, true])),
  );
  const [[secA, secB], setSec] = useState<readonly [string, string]>(() => farthestPair(BOREHOLES));
  const [showLabels, setShowLabels] = useState(true);

  const toggle = (key: string) => setVisible((v) => ({ ...v, [key]: !v[key] }));
  const bhA = boreholes.find((b) => b.id === secA) ?? boreholes[0];
  const bhB = boreholes.find((b) => b.id === secB) ?? boreholes[1];

  // 마운트 시 저장된 시추공 로드 (있으면 샘플 대신 사용).
  useEffect(() => {
    void loadBoreholes().then((saved) => {
      if (saved.length >= 2) {
        setBoreholes(saved);
        setSource(`저장됨 (시추 ${saved.length}공)`);
        setSec(farthestPair(saved));
      }
    });
  }, []);

  // CSV 업로드 → 그 데이터로 3D·물량·단면 전부 재구성.
  const onCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) e.target.value = "";
    if (!f) return;
    const data = parseEarthworkCsv(await f.text());
    const parsed = data.boreholes;
    if (parsed.length < 2) {
      alert("좌표(X,Y) 있는 시추공이 2개 이상 필요합니다. CSV 헤더/좌표 컬럼을 확인하세요.");
      return;
    }
    setBoreholes(parsed);
    setSec(farthestPair(parsed));
    setExtra({ terrain: data.terrain, boundary: data.boundary, piles: data.piles });
    // 통합 CSV(##섹션)에서 추가로 들어온 데이터 요약
    const ex: string[] = [];
    if (data.terrain.length) ex.push(`지형 ${data.terrain.length}점`);
    if (data.boundary.length) ex.push(`경계 ${data.boundary.length}점`);
    if (data.piles.length) ex.push(`Pile ${data.piles.length}`);
    const suffix = ex.length ? ` + ${ex.join(", ")}` : "";
    // DB 저장 (기존 데이터 교체 = 최신만 유지). 백엔드 미가동이면 화면만 갱신.
    try {
      const n = await saveBoreholes(parsed);
      setSource(`${f.name} (저장됨 ${n}공${suffix})`);
    } catch {
      setSource(`${f.name} (시추 ${parsed.length}공${suffix} · 저장 실패-화면만)`);
    }
  };

  // 그룹 소계 + 총계
  const groupTotal: Record<string, number> = {};
  let grand = 0;
  for (const v of vols) {
    groupTotal[v.group] = (groupTotal[v.group] ?? 0) + v.volume;
    grand += v.volume;
  }

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

      {/* CSV 업로드 (데이터 구동) */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "8px 0 14px" }}>
        <input ref={fileRef} type="file" accept=".csv" onChange={onCsv} style={{ display: "none" }} />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "#2563eb", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
        >
          <Upload size={15} strokeWidth={2} style={{ marginRight: 6, verticalAlign: "-2px" }} />
          시추 CSV 업로드
        </button>
        <span style={{ fontSize: 13, color: "#475569" }}>현재: <strong>{source}</strong></span>
        <span style={{ fontSize: 11, color: "#94a3b8" }}>
          시추 CSV 또는 add 통합 CSV(##섹션) 지원
        </span>
        {(extra.terrain.length > 0 || extra.boundary.length > 0 || extra.piles.length > 0) && (
          <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {extra.terrain.length > 0 && <Chip label={`지형 ${extra.terrain.length}점`} c="#0e7490" />}
            {extra.boundary.length > 0 && <Chip label={`경계 ${extra.boundary.length}점`} c="#15803d" />}
            {extra.piles.length > 0 && <Chip label={`Pile ${extra.piles.length}`} c="#b45309" />}
          </span>
        )}
        {clipLocal.length >= 3 && (
          <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#334155", cursor: "pointer" }}>
            <input type="checkbox" checked={clip} onChange={(e) => setClip(e.target.checked)} />
            대지경계선 내부만 산정 ({fmt(polygonArea(clipLocal))}㎡)
          </label>
        )}
        {extra.terrain.length >= 3 && (
          <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#334155", cursor: "pointer" }}>
            <input type="checkbox" checked={showContour} onChange={(e) => setShowContour(e.target.checked)} />
            등고선 생성
            <input
              type="number" min={0.1} step={0.5} value={contourInterval}
              onChange={(e) => setContourInterval(Math.max(0.1, Number(e.target.value) || 1))}
              style={{ width: 52, padding: "2px 4px", fontSize: 12, border: "1px solid #cbd5e1", borderRadius: 4 }}
            />
            m 간격{showContour && contours.length > 0 ? ` · ${contours.length}선` : ""}
          </label>
        )}
      </div>

      {/* 대표 지형 프리셋 (로컬 미리보기 — DB 저장 안 함) */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "0 0 14px" }}>
        <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>지형 프리셋:</span>
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
            style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#f8fafc", color: "#334155", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
          >
            {p.label}
          </button>
        ))}
        <span style={{ fontSize: 11, color: "#94a3b8" }}>형태 미리보기용 가상 지반 (저장하려면 CSV 업로드)</span>
      </div>

      {/* 3D 뷰어 */}
      <div style={{ position: "relative", height: "56vh", minHeight: 380, marginBottom: 12 }}>
        <EarthworkViewer
          model={model}
          visible={visible}
          boreholes={boreholes}
          showLabels={showLabels}
          terrain={extra.terrain}
          boundary={extra.boundary}
          piles={extra.piles}
          contours={contours}
        />
      </div>

      {/* 지질 단면도 */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1e293b" }}>지질 단면도</h3>
          <select value={secA} onChange={(e) => setSec([e.target.value, secB])} style={selStyle}>
            {boreholes.map((b) => <option key={b.id} value={b.id}>{b.id}</option>)}
          </select>
          <span style={{ color: "#94a3b8" }}>→</span>
          <select value={secB} onChange={(e) => setSec([secA, e.target.value])} style={selStyle}>
            {boreholes.map((b) => <option key={b.id} value={b.id}>{b.id}</option>)}
          </select>
          <span style={{ fontSize: 12, color: "#94a3b8" }}>두 시추공 단면 · 지하수위 ─ ─ 청색</span>
        </div>
        {bhA && bhB && (
          <EarthworkSection set={set} boreholes={boreholes} ax={bhA.x} ay={bhA.y} bx={bhB.x} by={bhB.y} aLabel={bhA.id} bLabel={bhB.id} />
        )}
      </div>

      {/* 범례 + 토글 */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
        <button
          type="button"
          onClick={() => setShowLabels((v) => !v)}
          style={{
            padding: "4px 12px", borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: "pointer",
            border: "1px solid " + (showLabels ? "#2563eb" : "#cbd5e1"),
            background: showLabels ? "#2563eb" : "#fff",
            color: showLabels ? "#fff" : "#64748b",
          }}
          title="시추공 공번 라벨 표시/숨김"
        >
          🏷️ 공번 {showLabels ? "ON" : "OFF"}
        </button>
        <span style={{ width: 1, height: 18, background: "#e2e8f0" }} />
        <Layers size={15} strokeWidth={1.8} style={{ color: "#64748b" }} />
        {LAYERS.map((L) => (
          <button
            key={L.key}
            type="button"
            onClick={() => toggle(L.key)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px",
              borderRadius: 999, border: "1px solid #cbd5e1", fontSize: 12, fontWeight: 600,
              background: visible[L.key] ? "#fff" : "#f1f5f9",
              color: visible[L.key] ? "#1e293b" : "#94a3b8", cursor: "pointer",
              opacity: visible[L.key] ? 1 : 0.6,
            }}
            title={visible[L.key] ? "숨기기" : "표시"}
          >
            <span style={{ width: 12, height: 12, borderRadius: 3, background: hex(L.color), display: "inline-block" }} />
            {L.label}
          </button>
        ))}
      </div>

      {/* 물량표 */}
      <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1e293b", marginBottom: 8 }}>층별 토공 물량</h3>
      <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 8, maxWidth: 560 }}>
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
      <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 8 }}>
        ※ IDW 보간 추정치. 시추공 11개 기반이라 외곽·심부는 오차가 큽니다. 굴착 레벨 지정 시 절토량 계산은 다음 단계.
      </p>

      {/* 시추공 편집 테이블 (CAD 팔레트처럼) */}
      <div style={{ height: 24 }} />
      <BoreholeTable
        key={source}
        boreholes={boreholes}
        onApply={(bh) => { setBoreholes(bh); setSec(farthestPair(bh)); setSource(`편집 적용 (${bh.length}공)`); }}
        onSave={async (bh) => {
          setBoreholes(bh);
          setSec(farthestPair(bh));
          try { const n = await saveBoreholes(bh); setSource(`저장됨 (${n}공)`); }
          catch { setSource(`${bh.length}공 · 저장 실패-화면만`); }
        }}
      />
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
