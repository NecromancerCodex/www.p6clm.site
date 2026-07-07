"use client";

/**
 * 자원 계획 — 공정표 활동 ↔ 물량 ↔ 장비 매핑 (액티비티 중심).
 *
 *  · 생성된 공정계획(플랜) 선택 → 활동별로 공정(op)·예정일·물량(내역서)·장비를 매핑 표시.
 *  · 물량 = 내역서(BOQ) op별, 장비 = 자원계획(예측 장비)에서 op 관련만.
 *  · 토공 3D 물량은 EarthworkVolumePanel(보조).
 *  Backend: /schedule/plan/list, /schedule/plan/{id}/resource-map.
 */
import { useEffect, useMemo, useState } from "react";

import { listPlans, getResourceMap, deletePlan, type PlanListItem, type ResourceRow } from "../../../../lib/api/schedule";
import { EarthworkVolumePanel } from "../../../../components/earthwork/EarthworkVolumePanel";

const fmt = (n: number) => n.toLocaleString();
const dt = (s: string | null) => (s ? s.slice(0, 10) : "—");

const th: React.CSSProperties = { padding: "6px 8px", fontWeight: 600, fontSize: 11.5 };
const thR: React.CSSProperties = { ...th, textAlign: "right" };
const td: React.CSSProperties = { padding: "6px 8px", verticalAlign: "top" };
const tdR: React.CSSProperties = { ...td, textAlign: "right", fontWeight: 600 };
const opChip: React.CSSProperties = { background: "var(--primary-soft)", color: "var(--primary-deep)", borderRadius: 4, padding: "1px 6px", fontSize: 11, whiteSpace: "nowrap" };
const eqChip: React.CSSProperties = { display: "inline-block", background: "var(--amber-soft)", color: "var(--primary-deep)", borderRadius: 4, padding: "1px 5px", fontSize: 10.5, marginRight: 4, marginBottom: 2 };
const CARD: React.CSSProperties = {
  background: "var(--surface)", border: "1px solid var(--surface-muted)", borderRadius: 14,
  boxShadow: "0 1px 3px rgba(16,24,40,0.05)", padding: 16, marginBottom: 16,
};

export default function ResourcePlanPage() {
  const [plans, setPlans] = useState<PlanListItem[]>([]);
  const [planId, setPlanId] = useState("");
  const [rows, setRows] = useState<ResourceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [err, setErr] = useState("");

  // 플랜 목록 로드 + 최신 자동 선택
  useEffect(() => {
    void listPlans()
      .then((ps) => { setPlans(ps); if (ps.length) setPlanId((id) => id || ps[0].id); })
      .catch((e) => setErr(e instanceof Error ? e.message : "플랜 목록 로드 실패"));
  }, []);

  // 선택 플랜의 자원 매핑 로드
  useEffect(() => {
    if (!planId) return;
    setLoading(true); setErr("");
    void getResourceMap(planId)
      .then((r) => setRows(r.activities ?? []))
      .catch((e) => { setErr(e instanceof Error ? e.message : "자원 매핑 로드 실패"); setRows([]); })
      .finally(() => setLoading(false));
  }, [planId, reloadKey]);

  // 저장 공정계획 삭제 (누적 정리) — 확인 후 하드 삭제, 목록 갱신 + 다음 플랜 자동 선택.
  const onDelete = async () => {
    const cur = plans.find((p) => p.id === planId);
    if (!cur || !window.confirm(`공정계획 삭제\n\n"${cur.project_name} · ${dt(cur.created)}"\n되돌릴 수 없습니다. 삭제할까요?`)) return;
    setLoading(true); setErr("");
    try {
      await deletePlan(planId);
      const rest = plans.filter((p) => p.id !== planId);
      setPlans(rest);
      setPlanId(rest.length ? rest[0].id : "");
      setRows([]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "삭제 실패");
    } finally {
      setLoading(false);
    }
  };

  // 전체 삭제 — 누적된 테스트 플랜 일괄 정리. 파괴적이라 이중 확인(개수 명시).
  const onDeleteAll = async () => {
    if (!plans.length) return;
    if (!window.confirm(`공정계획 전체 삭제\n\n저장된 ${plans.length}개를 모두 삭제합니다. 되돌릴 수 없습니다.`)) return;
    if (!window.confirm(`정말로 ${plans.length}개 전부 삭제할까요? (마지막 확인)`)) return;
    setLoading(true); setErr("");
    let failed = 0;
    for (const p of plans) {
      try { await deletePlan(p.id); } catch { failed += 1; }
    }
    if (failed) setErr(`${failed}개 삭제 실패 — 새로고침 후 재시도하세요`);
    const rest = failed ? await listPlans().catch(() => []) : [];
    setPlans(rest);
    setPlanId(rest.length ? rest[0].id : "");
    setRows([]);
    setLoading(false);
  };

  const byDisc = useMemo(() => {
    const g: Record<string, ResourceRow[]> = {};
    for (const r of rows) (g[r.discipline] ??= []).push(r);
    return g;
  }, [rows]);

  // 장비 총 집계 (최대 동시 동원)
  const equipTotal = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) for (const e of r.equip) m[e.name] = Math.max(m[e.name] ?? 0, e.count);
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  return (
    <div className="ws-inner-pad" style={{ maxWidth: "none" }}>
      <div className="ws-section-title">자원 계획</div>
      <p className="ws-section-desc">
        생성한 공정표의 <b>활동별로 물량·장비를 매핑</b>합니다. 어느 활동에 무슨 물량(내역서)·장비가 드는지 한눈에.
      </p>

      {/* 플랜 선택 */}
      <div style={{ ...CARD, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--muted-strong)" }}>공정계획</span>
        <select className="wz-in" style={{ minWidth: 280 }} value={planId} onChange={(e) => setPlanId(e.target.value)}>
          {plans.length === 0 && <option value="">생성된 공정계획 없음 — 공정표 빌더에서 먼저 생성</option>}
          {plans.map((p) => (
            <option key={p.id} value={p.id}>{p.project_name} · {p.stage} · {dt(p.created)}</option>
          ))}
        </select>
        <button className="wz-btn" disabled={!planId || loading} onClick={() => setReloadKey((k) => k + 1)} title="새로고침">
          {loading ? "로딩…" : "새로고침"}
        </button>
        <button className="wz-btn" disabled={!planId || loading}
                style={{ color: "var(--red)", borderColor: "var(--red-soft)" }}
                onClick={() => void onDelete()} title="이 공정계획 삭제">
          삭제
        </button>
        <button className="wz-btn" disabled={!plans.length || loading}
                style={{ color: "var(--red)", borderColor: "var(--red-soft)" }}
                onClick={() => void onDeleteAll()} title="저장된 공정계획 전부 삭제">
          전체 삭제 ({plans.length})
        </button>
        {err && <span style={{ color: "var(--red)", fontSize: 12 }}>{err}</span>}
      </div>

      {/* 장비 동원 요약 */}
      {equipTotal.length > 0 && (
        <div style={{ ...CARD, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--primary-deep)" }}>장비 동원(최대 동시)</span>
          {equipTotal.map(([name, n]) => (
            <span key={name} style={{ background: "var(--amber-soft)", color: "var(--primary-deep)", borderRadius: 6, padding: "2px 8px", fontSize: 12 }}>
              {name} <b>{n}대</b>
            </span>
          ))}
        </div>
      )}

      {/* 활동 ↔ 물량 ↔ 장비 매핑 */}
      {rows.length > 0 ? (
        Object.entries(byDisc).map(([disc, list]) => (
          <div key={disc} style={CARD}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", margin: "0 0 10px" }}>
              {disc} <span style={{ color: "var(--muted)", fontWeight: 400 }}>· {list.length}개 활동</span>
            </h3>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 720 }}>
                <thead>
                  <tr style={{ background: "var(--surface-soft)", textAlign: "left", color: "var(--muted-strong)" }}>
                    <th style={th}>공정</th><th style={th}>활동</th><th style={th}>구역/층</th>
                    <th style={thR}>물량</th><th style={thR} title="생산성 1조 1일 작업량">생산성</th><th style={thR} title="투입 작업조 수">투입조</th><th style={thR} title="작업일수(W.D)">기간</th>
                    <th style={th}>예정(착수~완료)</th><th style={th}>장비</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.code} style={{ borderTop: "1px solid var(--surface-soft)" }}>
                      <td style={td}><span style={opChip}>{r.op}</span></td>
                      <td style={{ ...td, fontWeight: 600, color: "var(--muted-strong)" }}>{r.name}</td>
                      <td style={{ ...td, color: "var(--muted)" }}>{[r.zone, r.storey].filter(Boolean).join(" / ") || "—"}</td>
                      <td style={{ ...tdR, color: r.qty ? "var(--primary-deep)" : "var(--line-strong)" }}>
                        {r.qty ? `${fmt(r.qty)} ${r.unit}` : "—"}
                      </td>
                      <td style={{ ...tdR, color: r.productivity ? "var(--muted-strong)" : "var(--line-strong)" }} title={r.daily ? `일작업량 ${r.daily} ${r.unit}/일` : ""}>
                        {r.productivity ? `${fmt(r.productivity)}${r.unit ? ` ${r.unit}/일` : ""}` : "—"}
                      </td>
                      <td style={{ ...tdR, color: r.crew ? "var(--muted-strong)" : "var(--line-strong)" }}>{r.crew ? `${r.crew}조` : "—"}</td>
                      <td style={{ ...tdR, color: r.duration ? "var(--muted-strong)" : "var(--line-strong)", fontWeight: 600 }}>{r.duration ? `${r.duration}일` : "—"}</td>
                      <td style={{ ...td, color: "var(--muted)", whiteSpace: "nowrap" }}>{dt(r.start)} ~ {dt(r.end)}</td>
                      <td style={td}>
                        {r.equip.length
                          ? r.equip.map((e) => <span key={e.name} style={eqChip}>{e.name} {e.count}</span>)
                          : <span style={{ color: "var(--muted-strong)" }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      ) : (
        !loading && planId && <div style={{ ...CARD, color: "var(--muted)", textAlign: "center" }}>이 플랜에 활동이 없습니다.</div>
      )}

      {/* 토공 3D 물량 (보조) */}
      <EarthworkVolumePanel />
    </div>
  );
}
