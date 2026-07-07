"use client";

/**
 * 토공 물량 요약 패널 — 저장된 시추공(DB)로 지층별 토공량 계산해 표시.
 * 자원 계획 등 다른 페이지에서 재사용 (물량 기반 보고서 연계용).
 */
import { Mountain } from "lucide-react";
import { useEffect, useState } from "react";

import { loadBoreholes } from "../../lib/api/earthwork";
import { buildGridModel, layerVolumes, type LayerVolume } from "../../lib/earthwork/model";

const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;
const fmt = (n: number) => Math.round(n).toLocaleString();

export function EarthworkVolumePanel() {
  const [vols, setVols] = useState<LayerVolume[] | null>(null);
  const [count, setCount] = useState(0);

  useEffect(() => {
    void loadBoreholes().then((bh) => {
      if (bh.length >= 2) {
        setCount(bh.length);
        setVols(layerVolumes(buildGridModel(bh, 2)));
      } else {
        setVols([]);
      }
    });
  }, []);

  const groupTotal: Record<string, number> = {};
  let grand = 0;
  for (const v of vols ?? []) {
    groupTotal[v.group] = (groupTotal[v.group] ?? 0) + v.volume;
    grand += v.volume;
  }

  return (
    <div style={{ marginBottom: 20 }}>
      <h3 style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>
        <Mountain size={16} strokeWidth={1.8} /> 토공 물량 (지층별)
        {count > 0 && <span style={{ color: "var(--muted)", fontWeight: 500, fontSize: 12 }}>· 시추 {count}공 기반</span>}
      </h3>

      {vols === null ? (
        <div style={{ color: "var(--muted)", fontSize: 13 }}>불러오는 중…</div>
      ) : vols.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--muted)", background: "var(--surface-soft)", border: "1px solid var(--line)", borderRadius: 8, padding: "10px 14px" }}>
          저장된 토공 데이터가 없습니다. <a href="/earthwork" style={{ color: "var(--primary)", fontWeight: 600 }}>토공 / 지반</a> 페이지에서
          시추 CSV를 올리고 <strong>DB 저장</strong>하면 여기 물량이 표시됩니다.
        </div>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid var(--line)", borderRadius: 8, maxWidth: 560 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--surface-soft)", color: "var(--muted-strong)" }}>
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
                  <tr key={v.key} style={{ borderTop: "1px solid var(--surface-soft)" }}>
                    {i === 0 && (
                      <td rowSpan={rows.length} style={{ ...td(), fontWeight: 700, color: "var(--muted-strong)", verticalAlign: "top", background: "var(--surface-soft)" }}>
                        {grp}
                        <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>{fmt(groupTotal[grp])} m³</div>
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
              <tr style={{ borderTop: "2px solid var(--line-strong)", background: "var(--surface-soft)", fontWeight: 700 }}>
                <td style={td()} colSpan={2}>합계</td>
                <td style={td(true)}>{fmt(grand)}</td>
                <td style={td(true)}>100%</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function th(right?: boolean): React.CSSProperties {
  return { padding: "8px 12px", textAlign: right ? "right" : "left", fontWeight: 600, whiteSpace: "nowrap" };
}
function td(right?: boolean): React.CSSProperties {
  return { padding: "7px 12px", textAlign: right ? "right" : "left" };
}
