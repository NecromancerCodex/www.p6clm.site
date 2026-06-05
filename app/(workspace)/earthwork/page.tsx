"use client";

/**
 * 토공/지반 — 시추주상도(NH 11공) 보간 3D 지층 모델 + 층별 토공 물량.
 *  · IDW 보간 입체 슬랩(층별 색) + 시추공 기둥.
 *  · 층별 체적(m³) = 격자 적분. 토사/풍화/암반 그룹 소계.
 */
import { Layers, Mountain } from "lucide-react";
import { useMemo, useState } from "react";

import { EarthworkViewer } from "../../../components/earthwork/EarthworkViewer";
import { BOREHOLES, LAYERS, buildGridModel, layerVolumes } from "../../../lib/earthwork/model";

const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;
const fmt = (n: number) => Math.round(n).toLocaleString();

export default function EarthworkPage() {
  const model = useMemo(() => buildGridModel(2), []);
  const vols = useMemo(() => layerVolumes(model), [model]);
  const [visible, setVisible] = useState<Record<string, boolean>>(
    () => Object.fromEntries(LAYERS.map((L) => [L.key, true])),
  );

  const toggle = (key: string) => setVisible((v) => ({ ...v, [key]: !v[key] }));

  // 그룹 소계 + 총계
  const groupTotal: Record<string, number> = {};
  let grand = 0;
  for (const v of vols) {
    groupTotal[v.group] = (groupTotal[v.group] ?? 0) + v.volume;
    grand += v.volume;
  }

  return (
    <div className="ws-inner-pad">
      <div className="ws-section-title">
        <Mountain size={18} strokeWidth={1.8} />
        토공 / 지반
      </div>
      <p className="ws-section-desc">
        시추주상도 {BOREHOLES.length}공(NH)을 IDW 보간한 3D 지층 모델과 층별 토공 물량입니다.
        부지 약 {Math.round(model.width)}×{Math.round(model.depthY)}m.
      </p>

      {/* 3D 뷰어 */}
      <div style={{ position: "relative", height: "56vh", minHeight: 380, marginBottom: 12 }}>
        <EarthworkViewer model={model} visible={visible} />
      </div>

      {/* 범례 + 토글 */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
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
    </div>
  );
}

function th(right?: boolean): React.CSSProperties {
  return { padding: "8px 12px", textAlign: right ? "right" : "left", fontWeight: 600, whiteSpace: "nowrap" };
}
function td(right?: boolean): React.CSSProperties {
  return { padding: "7px 12px", textAlign: right ? "right" : "left" };
}
