"use client";

/**
 * 공정계획 위저드 — PM 4단계 + 휴먼인더루프 (md/strategy/pm_philosophy_4stages.md).
 *
 *   [1 입력·스코프] → P2 생성 → [2 Gate A: 액티비티 검토·수정] → P3+P4
 *   → [3 Gate B: 관계·기간 검토·수정] → S1 CPM → [4 Gate C: 간트 확인·확정] → P6 XML
 *
 * AI = 초안 제안, PM = 각 게이트에서 컨펌·수정 (사람이 진실원천).
 * 원샷 데모는 /schedule/generate (PoC 보존). 디자인 언어는 generate 와 동일(styled-jsx·slate).
 */
import { type FC, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  confirmPlan, getPlan, inferScheduleContext, planP6XmlUrl, savePlanActivities, savePlanLogic, startPlan,
  type GanttTask, type GenWorkUnit, type PlanActivity, type PlanScopeWbs, type PlanStage, type PlanState,
} from "../../../../lib/api/schedule";
import { classifyIfcType, normStorey } from "../../../../lib/fourd/match";
import GanttChartRaw from "../../../../components/process/GanttChart";

const GanttChart = GanttChartRaw as unknown as FC<{ tasks: GanttTask[]; height?: number; viewMode?: string; fillWidth?: boolean }>;

let _ganttLoad: Promise<void> | null = null;
function loadFrappeGantt(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if ((window as unknown as { Gantt?: unknown }).Gantt) return Promise.resolve();
  if (_ganttLoad) return _ganttLoad;
  _ganttLoad = new Promise<void>((resolve, reject) => {
    if (!document.querySelector("link[data-frappe-gantt]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet"; link.href = "/libs/frappe-gantt.css"; link.setAttribute("data-frappe-gantt", "1");
      document.head.appendChild(link);
    }
    const s = document.createElement("script");
    s.src = "/libs/frappe-gantt.umd.js"; s.onload = () => resolve(); s.onerror = () => reject(new Error("gantt 로드 실패"));
    document.body.appendChild(s);
  });
  return _ganttLoad;
}

const STEPS = [
  { n: "P1·P2", t: "입력·스코프" },
  { n: "Gate A", t: "액티비티 검토" },
  { n: "Gate B", t: "관계·기간 검토" },
  { n: "Gate C", t: "스케줄 확정" },
] as const;

const stageStep = (st: PlanStage): number =>
  st === "running_p2" ? 1 : st === "activities_ready" ? 1
  : st === "running_p34" ? 2 : st === "logic_ready" ? 2
  : st === "running_s1" || st === "scheduled" || st === "done" ? 3 : 0;

const OP_KO: Record<string, string> = { FT: "기초", CR: "코어/골조", MD: "슬래브/모듈", PR: "마감" };
const PH_KO: Record<string, string> = { RB: "철근", FM: "거푸집", CN: "콘크리트", IN: "설치" };

export default function SchedulePlanWizard() {
  // ── 1단계: 입력 폼 ──
  const [buildingType, setBuildingType] = useState("");
  const [scope, setScope] = useState("");
  const [structureType, setStructureType] = useState("");
  const [startDate, setStartDate] = useState("");
  const [durationMonths, setDurationMonths] = useState("");
  const [wdpw, setWdpw] = useState(6);
  const [towerCranes, setTowerCranes] = useState(2);
  const [workCrews, setWorkCrews] = useState(3);
  const [constraints, setConstraints] = useState("");
  const [workUnits, setWorkUnits] = useState<GenWorkUnit[]>([]);
  const [zones, setZones] = useState<string[]>([]);
  const [storeys, setStoreys] = useState<string[]>([]);
  const [bimName, setBimName] = useState<string | null>(null);
  const [bimBusy, setBimBusy] = useState(false);
  const [inferReason, setInferReason] = useState<string | null>(null);

  // ── 계획 상태 ──
  const [planId, setPlanId] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanState | null>(null);
  const [scopeWbs, setScopeWbs] = useState<PlanScopeWbs | null>(null);
  const [acts, setActs] = useState<PlanActivity[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ganttReady, setGanttReady] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stage: PlanStage | null = plan?.stage ?? null;
  const step = planId ? stageStep(stage ?? "running_p2") : 0;
  const running = stage === "running_p2" || stage === "running_p34" || stage === "running_s1";

  const refresh = useCallback(async (id: string) => {
    try {
      const p = await getPlan(id);
      setPlan(p);
      if (p.payload.scope) setScopeWbs(p.payload.scope);
      const serverActs = p.payload.activities_user ?? p.payload.activities;
      if (serverActs && !dirty) setActs(serverActs);
      if (p.stage === "error") setErr(p.payload.error ?? p.progress ?? "오류");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [dirty]);

  useEffect(() => {
    if (!planId) return;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => { void refresh(planId); }, 3000);
    void refresh(planId);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [planId, refresh]);

  useEffect(() => {
    if (stage === "scheduled" || stage === "done")
      loadFrappeGantt().then(() => setGanttReady(true)).catch(() => setGanttReady(false));
  }, [stage]);

  // ── BIM 업로드 (generate 와 동일 집계 — 4D 매칭 표기 일치) ──
  const onBim = async (file: File) => {
    setBimBusy(true); setErr(null);
    try {
      const { parseIfc } = await import("../../../../lib/fourd/ifc");
      const parsed = await parseIfc(await file.arrayBuffer());
      const agg = new Map<string, GenWorkUnit>();
      const zoneSet = new Set<string>(); const storeySet = new Set<string>();
      const typeCount = new Map<string, number>();
      for (const el of parsed.elements) {
        typeCount.set(el.ifcType, (typeCount.get(el.ifcType) ?? 0) + 1);
        const zone = el.zone ?? "-";
        const storey = el.storey4d ?? normStorey(el.storeyName) ?? "-";
        const cat = classifyIfcType(el.ifcType, el.name);
        if (el.zone) zoneSet.add(el.zone);
        if (storey !== "-") storeySet.add(storey);
        const key = `${zone}|${storey}|${cat}`;
        const u = agg.get(key) ?? { zone, storey, element_type: cat, count: 0, volume_m3: 0, area_m2: 0 };
        u.count = (u.count ?? 0) + 1;
        if (el.volM3) u.volume_m3 = (u.volume_m3 ?? 0) + el.volM3;
        if (el.areaM2) u.area_m2 = (u.area_m2 ?? 0) + el.areaM2;
        agg.set(key, u);
      }
      setWorkUnits([...agg.values()]);
      setZones([...zoneSet]); setStoreys([...storeySet]);
      setBimName(`${file.name} — ${parsed.elements.length.toLocaleString()}부재 → ${agg.size} 워크패키지`);
      void inferScheduleContext({
        storeys: [...storeySet], zones: [...zoneSet],
        element_summary: [...typeCount.entries()].sort((a, b) => b[1] - a[1]).map(([type, count]) => ({ type, count })),
        total_count: parsed.elements.length,
      }).then((ctx) => {
        if (ctx.building_type && !buildingType) setBuildingType(ctx.building_type);
        if (ctx.scope && !scope) setScope(ctx.scope);
        if (ctx.structure_type) setStructureType(ctx.structure_type);
        if (ctx.reason) setInferReason(ctx.reason);
      });
    } catch (e) {
      setErr(`BIM 파싱 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBimBusy(false); }
  };

  const onStart = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await startPlan({
        building_type: buildingType.trim(), scope: scope.trim() || undefined,
        structure_type: structureType.trim() || undefined,
        zones, storeys, work_units: workUnits, methods: [],
        start_date: startDate, duration_months: durationMonths ? Number(durationMonths) : undefined,
        work_days_per_week: wdpw, tower_cranes: towerCranes, work_crews: workCrews,
        constraints: constraints.trim() || undefined,
      });
      setScopeWbs(r.scope);
      setPlanId(r.plan_id);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const onSaveActs = async () => {
    if (!planId) return;
    setBusy(true);
    try { await savePlanActivities(planId, acts); setDirty(false); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const onSaveLogic = async () => {
    if (!planId) return;
    setBusy(true);
    try {
      await savePlanLogic(planId, {
        relations: Object.fromEntries(acts.map((a) => [a.code, a.predecessors ?? []])),
        durations: Object.fromEntries(acts.map((a) => [a.code, a.duration_days])),
      });
      setDirty(false);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const onConfirm = async () => {
    if (!planId) return;
    setBusy(true); setErr(null);
    try {
      if (dirty) { if (stage === "activities_ready") await onSaveActs(); else if (stage === "logic_ready") await onSaveLogic(); }
      await confirmPlan(planId);
      await refresh(planId);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const ganttTasks: GanttTask[] = useMemo(() => {
    const tasks = (plan?.payload.schedule?.tasks ?? []) as Array<Record<string, unknown>>;
    const bump = (s: string, e: string) => {
      if (e > s) return e;
      const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + 1);
      return d.toISOString().slice(0, 10);
    };
    return tasks.filter((t) => t.start && t.end).map((t) => ({
      id: String(t.code), activity_code: String(t.code), name: String(t.name),
      wbs_code: String(t.wbs ?? "").split(/\s*>\s*/).filter(Boolean).join("."),
      start: String(t.start).slice(0, 10), end: bump(String(t.start).slice(0, 10), String(t.end).slice(0, 10)),
      progress: 0, is_cp: false, total_float_hr_cnt: null, status: "",
      dependencies: ((t.predecessors as string[]) ?? []).filter((p) => p !== t.code),
    })) as GanttTask[];
  }, [plan]);

  const editAct = (i: number, patch: Partial<PlanActivity>) => {
    setActs((prev) => prev.map((a, j) => (j === i ? { ...a, ...patch } : a)));
    setDirty(true);
  };
  const removeAct = (i: number) => { setActs((prev) => prev.filter((_, j) => j !== i)); setDirty(true); };

  // ════════════════ 렌더 ════════════════
  return (
    <div style={{ padding: 20, height: "100%", overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>공정계획 위저드</h1>
        <p style={{ fontSize: 13, color: "#64748b", margin: "4px 0 0" }}>
          PM 4단계 — 플래닝(스코프 → 액티비티 → 관계 → 기간) → 스케줄링. AI가 초안을 만들고,
          <b> 각 게이트에서 PM이 검토·수정 후 진행</b>합니다. (원샷 데모: 자동생성기)
        </p>
      </div>

      {/* 스텝 인디케이터 */}
      <div className="wz-steps">
        {STEPS.map((s, i) => (
          <div key={s.n} className={`wz-step ${i === step ? "on" : i < step ? "done" : ""}`}>
            <span className="wz-step-badge">{i < step ? "✓" : i + 1}</span>
            <span>
              <b>{s.n}</b>
              <small>{s.t}</small>
            </span>
            {i < STEPS.length - 1 && <span className="wz-step-arrow">›</span>}
          </div>
        ))}
      </div>

      {err && (
        <div style={{ border: "1px solid #fecaca", background: "#fef2f2", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#b91c1c" }}>
          {err}
        </div>
      )}

      {running && (
        <div className="wz-stream">
          <div className="wz-stream-head">
            <span className="wz-dot" />
            <b>{stage === "running_p2" ? "P2 액티비티 정의 중" : "P3 관계 · P4 기간 산정 중"}</b>
            <span style={{ color: "#6366f1" }}>{plan?.progress ?? "AI 작업 중…"}</span>
          </div>
          <div className="wz-skel-rows">
            {[78, 62, 88, 54, 70].map((w, i) => (
              <div key={i} className="wz-skel-row">
                <div className="wz-skel-label" />
                <div className="wz-skel-bar" style={{ width: `${w}%`, animationDelay: `${i * 0.12}s` }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Step 1: 입력 ── */}
      {step === 0 && (
        <>
          <div className="wz-card">
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <label className="wz-bim">
                {bimBusy ? "BIM 분석 중…" : "📦 BIM(IFC) 업로드 — 워크패키지 자동 집계"}
                <input type="file" accept=".ifc" style={{ display: "none" }} disabled={bimBusy}
                       onChange={(e) => { const f = e.target.files?.[0]; if (f) void onBim(f); }} />
              </label>
              {bimName && <span style={{ fontSize: 12, color: "#475569" }}>{bimName}</span>}
            </div>
            {inferReason && <p style={{ fontSize: 12, color: "#7c3aed", margin: "8px 0 0" }}>🤖 AI 판정: {inferReason}</p>}
          </div>

          <div className="wz-card" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Field label="① 무엇을 — 건물유형 *">
              <input className="wz-in" value={buildingType} onChange={(e) => setBuildingType(e.target.value)} placeholder="예: 모듈러 공동주택" />
              <input className="wz-in" style={{ marginTop: 6 }} value={scope} onChange={(e) => setScope(e.target.value)} placeholder="범위 (예: 골조까지 / 마감 포함)" />
            </Field>
            <Field label="② 구조유형 — 공법 선택">
              <select className="wz-in" value={structureType} onChange={(e) => setStructureType(e.target.value)}>
                <option value="">자동 판정 (BIM 업로드 시)</option>
                <option value="RC">RC (철근콘크리트)</option>
                <option value="철골">철골</option>
                <option value="SRC">SRC</option>
                <option value="PC·모듈러">PC·모듈러</option>
                <option value="혼합">혼합 (RC코어 + 철골)</option>
              </select>
            </Field>
            <Field label="③ 언제 — 착공일 * / 목표공기">
              <div style={{ display: "flex", gap: 8 }}>
                <input type="date" className="wz-in" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                <input type="number" className="wz-in" style={{ width: 110 }} value={durationMonths}
                       onChange={(e) => setDurationMonths(e.target.value)} placeholder="개월" />
                <select className="wz-in" style={{ width: 100 }} value={wdpw} onChange={(e) => setWdpw(Number(e.target.value))}>
                  <option value={5}>주5일</option><option value={6}>주6일</option><option value={7}>주7일</option>
                </select>
              </div>
            </Field>
            <Field label="④ 자원 — 타워크레인 / 작업조">
              <div style={{ display: "flex", gap: 8 }}>
                <label className="wz-sub">크레인(대)
                  <input type="number" min={0} className="wz-in" value={towerCranes} onChange={(e) => setTowerCranes(Number(e.target.value))} /></label>
                <label className="wz-sub">작업조(조)
                  <input type="number" min={1} className="wz-in" value={workCrews} onChange={(e) => setWorkCrews(Number(e.target.value))} /></label>
              </div>
            </Field>
            <Field label="⑤ 제약 — 자유서술 (선택)">
              <input className="wz-in" value={constraints} onChange={(e) => setConstraints(e.target.value)} placeholder="예: 야간작업 불가, 동절기 타설 제한, 인접 민원" />
            </Field>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "flex-end", gap: 10 }}>
              {workUnits.length > 0 && (
                <span style={{ fontSize: 12, color: "#475569" }}>
                  📦 워크패키지 <b>{workUnits.length}</b> · 구역 {zones.length} · 층 {storeys.length}
                </span>
              )}
              <button className="wz-btn" disabled={!buildingType.trim() || !startDate || busy} onClick={() => void onStart()}>
                {busy ? "시작 중…" : "P1 스코프 확정 → P2 액티비티 생성"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* WBS 요약 (P1 산출) */}
      {scopeWbs && step >= 1 && (
        <details className="wz-card" style={{ background: "#f8fafc" }} open={step === 1 && running}>
          <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#334155" }}>
            P1 스코프 — WBS · 워크패키지 {scopeWbs.package_count} · 구역 {scopeWbs.zones.length}
          </summary>
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#475569" }}>
            {scopeWbs.wbs.map((d) => (
              <div key={d.discipline}>
                <b style={{ color: "#1e293b" }}>{d.discipline}</b> — {d.storeys.map((s) => `${s.storey}(${s.zones.length})`).join(" · ")}
              </div>
            ))}
          </div>
        </details>
      )}

      {/* ── Step 2: Gate A ── */}
      {stage === "activities_ready" && (
        <div className="wz-card">
          <div className="wz-gate-head">
            <div>
              <span className="wz-gate-badge">⏸ Gate A</span>
              <b style={{ fontSize: 14 }}> 액티비티 {acts.length}개 검토</b>
              {dirty && <em style={{ fontSize: 12, color: "#d97706", marginLeft: 8 }}>수정됨 · 미저장</em>}
              <p style={{ fontSize: 12, color: "#64748b", margin: "4px 0 0" }}>활동명을 직접 수정하거나 불필요한 활동을 삭제하세요. 컨펌하면 P3 선후행 · P4 기간 산정으로 진행합니다.</p>
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <button className="wz-btn ghost" disabled={!dirty || busy} onClick={() => void onSaveActs()}>수정 저장</button>
              <button className="wz-btn green" disabled={busy} onClick={() => void onConfirm()}>컨펌 → P3 관계 · P4 기간</button>
            </div>
          </div>
          <div className="wz-tablewrap">
            <table className="wz-table">
              <thead>
                <tr><th style={{ textAlign: "left" }}>활동명</th><th>구역</th><th>층</th><th>공종</th><th>단계</th><th>MS</th><th /></tr>
              </thead>
              <tbody>
                {acts.map((a, i) => (
                  <tr key={a.code}>
                    <td><input className="wz-cell" value={a.name} onChange={(e) => editAct(i, { name: e.target.value })} /></td>
                    <td className="c">{a.fd_zone ?? "—"}</td>
                    <td className="c">{a.fd_storey ?? "—"}</td>
                    <td className="c">{a.fd_op ? OP_KO[a.fd_op] ?? a.fd_op : "—"}</td>
                    <td className="c">{a.fd_phase ? PH_KO[a.fd_phase] ?? a.fd_phase : "—"}</td>
                    <td className="c">{a.milestone ? "◆" : ""}</td>
                    <td className="c"><button className="wz-del" onClick={() => removeAct(i)}>삭제</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Step 3: Gate B ── */}
      {stage === "logic_ready" && (
        <div className="wz-card">
          <div className="wz-gate-head">
            <div>
              <span className="wz-gate-badge">⏸ Gate B</span>
              <b style={{ fontSize: 14 }}> 선후행 · 기간 검토</b>
              {dirty && <em style={{ fontSize: 12, color: "#d97706", marginLeft: 8 }}>수정됨 · 미저장</em>}
              <p style={{ fontSize: 12, color: "#64748b", margin: "4px 0 0" }}>기간(일)과 선행 활동을 수정하세요. 컨펌하면 CPM 날짜 계산(S1 스케줄링)으로 진행합니다.</p>
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <button className="wz-btn ghost" disabled={!dirty || busy} onClick={() => void onSaveLogic()}>수정 저장</button>
              <button className="wz-btn green" disabled={busy} onClick={() => void onConfirm()}>컨펌 → S1 스케줄링 (CPM)</button>
            </div>
          </div>
          <div className="wz-tablewrap">
            <table className="wz-table">
              <thead>
                <tr><th style={{ textAlign: "left" }}>활동</th><th style={{ width: 90 }}>기간(일)</th><th style={{ textAlign: "left" }}>선행 (code, 쉼표 구분)</th></tr>
              </thead>
              <tbody>
                {acts.map((a, i) => (
                  <tr key={a.code}>
                    <td style={{ fontSize: 12, color: "#1e293b" }}>{a.name} <span style={{ color: "#94a3b8" }}>({a.code})</span></td>
                    <td className="c">
                      <input type="number" min={0} className="wz-cell c" style={{ width: 64 }} value={a.duration_days}
                             onChange={(e) => editAct(i, { duration_days: Number(e.target.value) })} disabled={a.milestone} />
                    </td>
                    <td>
                      <input className="wz-cell" value={(a.predecessors ?? []).map((p) => p.code).join(", ")}
                             onChange={(e) => editAct(i, { predecessors: e.target.value.split(/[\s,]+/).filter(Boolean).map((c) => ({ code: c, type: "FS", lag_days: 0 })) })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Step 4: Gate C ── */}
      {(stage === "scheduled" || stage === "done") && (
        <div className="wz-card">
          <div className="wz-gate-head">
            <div>
              <span className="wz-gate-badge" style={stage === "done" ? { background: "#dcfce7", color: "#15803d" } : undefined}>
                {stage === "done" ? "✅ 확정 완료" : "⏸ Gate C"}
              </span>
              <b style={{ fontSize: 14 }}> {stage === "done" ? "공정계획이 확정되었습니다" : "스케줄 최종 검토"}</b>
              <p style={{ fontSize: 12, color: "#64748b", margin: "4px 0 0" }}>
                CPM 으로 계산된 날짜입니다. {stage === "scheduled" ? "간트를 검토하고 확정하세요." : "P6 XML 을 다운로드해 Primavera 에서 사용하세요."}
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              {stage === "scheduled" && (
                <button className="wz-btn green" disabled={busy} onClick={() => void onConfirm()}>최종 확정</button>
              )}
              {planId && (
                <a className="wz-btn ghost" style={{ textDecoration: "none" }} href={planP6XmlUrl(planId)}>P6 XML 다운로드</a>
              )}
            </div>
          </div>
          {ganttReady && ganttTasks.length > 0 ? (
            <GanttChart tasks={ganttTasks} height={520} viewMode="Week" fillWidth />
          ) : (
            <div style={{ fontSize: 13, color: "#94a3b8", padding: 20 }}>간트 렌더링 준비 중… (활동 {ganttTasks.length}개)</div>
          )}
        </div>
      )}

      <style jsx>{`
        .wz-steps { display: flex; gap: 0; align-items: stretch; }
        .wz-step { flex: 1; display: flex; align-items: center; gap: 9px; padding: 10px 14px; border: 1px solid #e2e8f0;
                   background: #fff; color: #94a3b8; position: relative; }
        .wz-step:first-child { border-radius: 10px 0 0 10px; }
        .wz-step:last-child { border-radius: 0 10px 10px 0; }
        .wz-step + .wz-step { border-left: none; }
        .wz-step b { display: block; font-size: 12px; line-height: 1.2; }
        .wz-step small { display: block; font-size: 11px; }
        .wz-step.on { background: #eff6ff; border-color: #bfdbfe; color: #1d4ed8; }
        .wz-step.done { background: #f0fdf4; color: #15803d; }
        .wz-step-badge { width: 22px; height: 22px; border-radius: 50%; background: #e2e8f0; color: #64748b;
                         display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0; }
        .wz-step.on .wz-step-badge { background: #2563eb; color: #fff; }
        .wz-step.done .wz-step-badge { background: #22c55e; color: #fff; }
        .wz-step-arrow { position: absolute; right: -6px; top: 50%; transform: translateY(-50%); color: #cbd5e1; font-size: 16px; z-index: 1; }
        .wz-card { border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; background: #fff; }
        .wz-in { width: 100%; padding: 7px 9px; border: 1px solid #cbd5e1; border-radius: 7px; font-size: 13px; box-sizing: border-box; background: #fff; }
        .wz-sub { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: #64748b; flex: 1; }
        .wz-bim { display: inline-block; padding: 9px 14px; border: 1px dashed #94a3b8; border-radius: 8px; font-size: 12.5px;
                  cursor: pointer; color: #475569; background: #f8fafc; }
        .wz-bim:hover { border-color: #2563eb; color: #2563eb; }
        .wz-btn { padding: 8px 16px; background: #2563eb; color: #fff; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; }
        .wz-btn:disabled { background: #cbd5e1; cursor: not-allowed; }
        .wz-btn.green { background: #16a34a; }
        .wz-btn.green:disabled { background: #cbd5e1; }
        .wz-btn.ghost { background: #fff; color: #334155; border: 1px solid #cbd5e1; }
        .wz-btn.ghost:disabled { color: #cbd5e1; }
        .wz-gate-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
        .wz-gate-badge { display: inline-block; padding: 3px 10px; border-radius: 13px; background: #fef3c7; color: #b45309;
                         font-size: 12px; font-weight: 700; margin-right: 6px; }
        .wz-tablewrap { max-height: 480px; overflow: auto; border: 1px solid #e2e8f0; border-radius: 8px; }
        .wz-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .wz-table thead th { position: sticky; top: 0; background: #f1f5f9; color: #475569; font-size: 11px;
                             padding: 8px; border-bottom: 1px solid #e2e8f0; z-index: 1; }
        .wz-table td { padding: 4px 6px; border-bottom: 1px solid #f1f5f9; color: #475569; }
        .wz-table td.c { text-align: center; }
        .wz-table tbody tr:hover { background: #f8fafc; }
        .wz-cell { width: 100%; padding: 4px 7px; border: 1px solid transparent; border-radius: 5px; font-size: 12px;
                   background: transparent; box-sizing: border-box; }
        .wz-cell.c { text-align: center; }
        .wz-cell:hover { border-color: #cbd5e1; background: #fff; }
        .wz-cell:focus { border-color: #2563eb; background: #fff; outline: none; }
        .wz-del { background: none; border: none; color: #ef4444; font-size: 11px; cursor: pointer; }
        .wz-del:hover { text-decoration: underline; }
        .wz-stream { border: 1px solid #e0e7ff; background: #f5f7ff; border-radius: 10px; padding: 14px; }
        .wz-stream-head { display: flex; align-items: center; gap: 8px; font-size: 13px; margin-bottom: 12px; }
        .wz-dot { width: 9px; height: 9px; border-radius: 50%; background: #6366f1; animation: wz-pulse 1s ease-in-out infinite; }
        @keyframes wz-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .4; transform: scale(.7); } }
        .wz-skel-rows { display: flex; flex-direction: column; gap: 9px; }
        .wz-skel-row { display: flex; align-items: center; gap: 10px; }
        .wz-skel-label { width: 130px; height: 13px; border-radius: 4px; background: linear-gradient(90deg,#e2e8f0 25%,#eef2f7 50%,#e2e8f0 75%); background-size: 200% 100%; animation: wz-shim 1.4s linear infinite; flex-shrink: 0; }
        .wz-skel-bar { height: 16px; border-radius: 4px; background: linear-gradient(90deg,#c7d2fe 25%,#e0e7ff 50%,#c7d2fe 75%); background-size: 200% 100%; animation: wz-shim 1.4s linear infinite; }
        @keyframes wz-shim { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>{label}</label>
      {children}
    </div>
  );
}
