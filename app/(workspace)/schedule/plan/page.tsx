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
import { useRouter, useSearchParams } from "next/navigation";

import {
  confirmPlan, getPlan, inferScheduleContext, planP6XmlUrl, savePlanActivities, startPlan,
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

// 공정 플래닝 세부 5단계 (회사 노하우 — pm_philosophy_4stages.md)
const PLAN_SUBS = ["WBS 생성", "액티비티 정의", "액티비티 리스트", "릴레이션", "듀레이션"] as const;

/** 플래닝 서브스텝 진행수 — progress 의 "[n/5]" 를 파싱 (백엔드 노드가 정확히 표기) */
const subDone = (st: PlanStage | null, progress?: string | null): number => {
  if (!st) return 0;
  if (st !== "running_p2") return 5;                        // 플래닝 완료 이후
  const m = /\[(\d)\/5\]/.exec(progress ?? "");
  return m ? Math.max(0, Number(m[1]) - 1) : 1;             // [n/5] 진행 중 = n-1 완료
};

/** 대단계: 0=입력, 1=플래닝(진행·검토), 2=스케줄링 */
const bigStep = (st: PlanStage | null, hasPlan: boolean): number =>
  !hasPlan ? 0 : st === "scheduled" || st === "done" ? 2 : 1;

// 진행 중 계획 체크포인트 — 페이지 이동/새로고침 후 돌아와도 이어서 (URL ?plan= 과 이중 안전망)
const PLAN_CKPT = "clm.schedule.plan.active";

const OP_KO: Record<string, string> = { FT: "기초", CR: "코어/골조", MD: "슬래브/모듈", PR: "마감" };
const PH_KO: Record<string, string> = { RB: "철근", FM: "거푸집", CN: "콘크리트", IN: "설치" };

export default function SchedulePlanWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
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
  const [strategy, setStrategy] = useState("bottom_up");
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

  // 복구 — URL ?plan= 우선, 없으면 localStorage 체크포인트 (페이지 이동/새로고침 후 이어서)
  useEffect(() => {
    const q = searchParams.get("plan") || (typeof window !== "undefined" ? localStorage.getItem(PLAN_CKPT) : null);
    if (q && !planId) {
      setPlanId(q);
      router.replace(`?plan=${q}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stage: PlanStage | null = plan?.stage ?? null;
  const step = bigStep(stage, !!planId);
  const running = stage === "running_p2";   // 플래닝 그래프가 logic_ready 까지 한 번에 (p34/s1 상태 미사용)
  const subs = subDone(stage, plan?.progress);


  const refresh = useCallback(async (id: string) => {
    try {
      const p = await getPlan(id);
      setPlan(p);
      if (p.payload.scope) setScopeWbs(p.payload.scope);
      const serverActs = p.payload.activities_user ?? p.payload.activities;
      if (serverActs && !dirty) setActs(serverActs);
      if (p.stage === "error") setErr(p.payload.error ?? p.progress ?? "오류");
      // 체크포인트는 done 에도 유지 — '새 계획 시작' 누를 때까지 새로고침/이동 후 복원 보장.
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
      const typeNames = new Map<string, Set<string>>();  // 구조 판정 신호 — type별 대표 부재명
      for (const el of parsed.elements) {
        typeCount.set(el.ifcType, (typeCount.get(el.ifcType) ?? 0) + 1);
        if (el.name) {
          const ns = typeNames.get(el.ifcType) ?? new Set<string>();
          if (ns.size < 3) { ns.add(el.name.slice(0, 30)); typeNames.set(el.ifcType, ns); }
        }
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
        element_summary: [...typeCount.entries()].sort((a, b) => b[1] - a[1]).map(([type, count]) => ({ type, count, names: [...(typeNames.get(type) ?? [])] })),
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
        strategy,
      });
      setScopeWbs(r.scope);
      setPlanId(r.plan_id);
      router.replace(`?plan=${r.plan_id}`);   // 새로고침해도 이어서 (plan_id 영속)
      localStorage.setItem(PLAN_CKPT, r.plan_id);   // 페이지 이동 후 돌아와도 이어서
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
  const onConfirm = async () => {
    if (!planId) return;
    setBusy(true); setErr(null);
    try {
      if (dirty) await onSaveActs();   // 통합 테이블: 이름·기간·선행 전부 activities 로 저장
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
          <b>공정 플래닝</b>(WBS → 액티비티 정의 → 리스트 → 릴레이션 → 듀레이션) 이 끝나면 DB에 저장되고,
          <b> PM이 수정 또는 컨펌</b>하면 <b>공정 스케줄링</b>(베이스라인 생성)으로 넘어갑니다.
        </p>
      </div>

      {/* 대단계 인디케이터 — 공정 플래닝 / 공정 스케줄링 */}
      <div className="wz-steps">
        <div className={`wz-step big ${step === 1 ? "on" : step > 1 ? "done" : ""}`}>
          <span className="wz-step-badge">{step > 1 ? "✓" : "1"}</span>
          <span style={{ flex: 1 }}>
            <b>공정 플래닝</b>
            <span className="wz-substeps">
              {PLAN_SUBS.map((t, i) => (
                <span key={t} className={`wz-substep ${step >= 1 && i < subs ? "done" : step === 1 && i === subs ? "on" : ""}`}>
                  {step >= 1 && i < subs ? "✓" : `${i + 1}.`}{t}
                </span>
              ))}
            </span>
          </span>
          <span className="wz-step-arrow">›</span>
        </div>
        <div className={`wz-step big ${stage === "done" ? "done" : step === 2 ? "on" : ""}`}>
          <span className="wz-step-badge">{stage === "done" ? "✓" : "2"}</span>
          <span>
            <b>공정 스케줄링</b>
            <small>{stage === "done" ? "베이스라인 확정 완료" : "플래닝 기반 공정표 베이스라인 생성"}</small>
          </span>
        </div>
      </div>

      {err && (
        <div style={{ border: "1px solid #fecaca", background: "#fef2f2", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#b91c1c", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span>{err}</span>
          {stage === "error" && (
            <button className="wz-btn ghost" style={{ flexShrink: 0 }} onClick={() => {
              setPlanId(null); setPlan(null); setActs([]); setErr(null); setDirty(false);
              localStorage.removeItem(PLAN_CKPT);
              router.replace("?");
            }}>새 계획 시작</button>
          )}
        </div>
      )}

      {running && (
        <div className="wz-stream">
          <div className="wz-stream-head">
            <span className="wz-dot" />
            <b>공정 플래닝 진행 중</b>
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
            <Field label="② 구조유형 / 시공 전략 — BIM에 없는 정보는 직접 선택">
              <div style={{ display: "flex", gap: 8 }}>
                <select className="wz-in" value={structureType} onChange={(e) => setStructureType(e.target.value)}>
                  <option value="">구조: 자동 판정</option>
                  <option value="RC">RC (철근콘크리트)</option>
                  <option value="철골">철골</option>
                  <option value="SRC">SRC</option>
                  <option value="PC·모듈러">PC·모듈러</option>
                  <option value="혼합">혼합 (RC코어 + 철골)</option>
                </select>
                <select className="wz-in" value={strategy} onChange={(e) => setStrategy(e.target.value)}
                        title="굴착·골조 전략 — 발주·부지 조건으로 결정되는 정보(AI 추정 불가)">
                  <option value="bottom_up">순타·일괄 (전 구역 지하 → 지상)</option>
                  <option value="bottom_up_phased">순타·단계 (구역별 지하→지상 연속)</option>
                  <option value="top_down">역타 (지하·지상 병행)</option>
                </select>
              </div>
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
            <Field label="⑤ 현장 조건·제약 — BIM에 없는 정보를 알려주세요 (AI가 공정에 반영)">
              <input className="wz-in" value={constraints} onChange={(e) => setConstraints(e.target.value)} placeholder="예: 야간작업 불가, 동절기 타설 제한, 암반 굴착, 도심 반입 제한" />
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 6 }}>
                {["야간작업 불가", "동절기 타설 제한", "암반 굴착(발파)", "연약지반", "도심 자재반입 제한", "인접 민원 주의", "우기 집중 지역"].map((c) => (
                  <button key={c} type="button" className="wz-chip"
                          onClick={() => setConstraints((p) => (p.includes(c) ? p : (p ? p + ", " : "") + c))}>
                    + {c}
                  </button>
                ))}
              </div>
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
          <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 6, fontSize: 12, color: "#475569" }}>
            {scopeWbs.wbs.map((z) => (
              <div key={z.zone} style={{ border: "1px solid #f1f5f9", borderRadius: 8, padding: "6px 10px" }}>
                <b style={{ color: "#1e293b" }}>{z.zone}</b>
                <span style={{ color: "#94a3b8" }}> · {z.storeys.length}개 층</span>
                <div style={{ marginTop: 2, color: "#64748b" }}>
                  {z.storeys[0]?.storey} ~ {z.storeys[z.storeys.length - 1]?.storey}
                  {" — "}{[...new Set(z.storeys.flatMap((s) => s.discs))].join(" · ")}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* ── 플래닝 완료 — 검토·수정·컨펌 (회사 노하우: 플래닝 끝 → DB → 사람 수정/컨펌 → 스케줄링) ── */}
      {stage === "logic_ready" && (
        <div className="wz-card">
          <div className="wz-gate-head">
            <div>
              <span className="wz-gate-badge">⏸ 플래닝 완료</span>
              <b style={{ fontSize: 14 }}> 액티비티 {acts.length}개 — 검토 후 스케줄링으로</b>
              {plan?.payload.strategy && (
                <span style={{ marginLeft: 8, fontSize: 11.5, padding: "3px 10px", borderRadius: 12,
                               background: plan.payload.strategy === "top_down" ? "#fce7f3" : "#e0f2fe",
                               color: plan.payload.strategy === "top_down" ? "#be185d" : "#0369a1", fontWeight: 700 }}>
                  {plan.payload.strategy === "top_down" ? "역타 (지하·지상 병행)" : plan.payload.strategy === "bottom_up_phased" ? "순타·단계 (구역별 연속)" : "순타·일괄 (전 구역 지하 먼저)"}
                </span>
              )}
              {dirty && <em style={{ fontSize: 12, color: "#d97706", marginLeft: 8 }}>수정됨 · 미저장</em>}
              <p style={{ fontSize: 12, color: "#64748b", margin: "4px 0 0" }}>
                WBS → 액티비티 정의 → 리스트 → 릴레이션 → 듀레이션까지 완료됐습니다.
                활동명·기간·선행을 직접 수정하거나 삭제한 뒤 <b>컨펌하면 공정표 베이스라인을 생성</b>합니다.
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <button className="wz-btn ghost" disabled={!dirty || busy} onClick={() => void onSaveActs()}>수정 저장</button>
              <button className="wz-btn green" disabled={busy} onClick={() => void onConfirm()}>컨펌 → 공정 스케줄링 (베이스라인)</button>
            </div>
          </div>
          {plan?.payload.rationale && (
            <details className="wz-rat" open>
              <summary>🧠 AI 판단 근거 — 왜 이렇게 계획했는가</summary>
              <div className="wz-rat-body">
                {plan.payload.rationale.define && (
                  <p><b>액티비티 분해</b> — {plan.payload.rationale.define}</p>
                )}
                {plan.payload.rationale.relation && (
                  <p><b>선후행</b> — {plan.payload.rationale.relation}
                    {plan.payload.stats?.relation && (
                      <span className="wz-rat-stat"> (AI 판단 {plan.payload.stats.relation.llm ?? 0}활동 + 물리 백스톱 {plan.payload.stats.relation.backstop ?? 0}건)</span>
                    )}</p>
                )}
                {plan.payload.rationale.duration && (
                  <p><b>기간 산정</b> — {plan.payload.rationale.duration}
                    {plan.payload.stats?.duration && (
                      <span className="wz-rat-stat"> ({plan.payload.stats.duration.applied ?? 0}/{plan.payload.stats.duration.total ?? 0} 활동 산정)</span>
                    )}</p>
                )}
              </div>
            </details>
          )}
          <div className="wz-tablewrap">
            <table className="wz-table">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>활동명</th><th>구역</th><th>층</th><th>공종</th>
                  <th style={{ width: 80 }}>기간(일)</th>
                  <th style={{ width: 56 }} title="필요 타워크레인 (양중작업) — SGS 자원 평준화 입력">🏗️</th>
                  <th style={{ width: 56 }} title="필요 작업조 — SGS 자원 평준화 입력">👷</th>
                  <th style={{ textAlign: "left", width: "22%" }}>선행 (code, 쉼표)</th><th />
                </tr>
              </thead>
              <tbody>
                {acts.map((a, i) => (
                  <tr key={a.code}>
                    <td><input className="wz-cell" value={a.name} onChange={(e) => editAct(i, { name: e.target.value })} /></td>
                    <td className="c">{a.fd_zone ?? "—"}</td>
                    <td className="c">{a.fd_storey ?? "—"}</td>
                    <td className="c">{a.fd_op ? OP_KO[a.fd_op] ?? a.fd_op : a.milestone ? "◆MS" : "—"}</td>
                    <td className="c">
                      <input type="number" min={0} className="wz-cell c" style={{ width: 60 }} value={a.duration_days}
                             onChange={(e) => editAct(i, { duration_days: Number(e.target.value) })} disabled={a.milestone} />
                    </td>
                    <td className="c">
                      <input type="number" min={0} max={9} className="wz-cell c" style={{ width: 44 }} value={a.res_crane ?? 0}
                             onChange={(e) => editAct(i, { res_crane: Number(e.target.value) })} disabled={a.milestone} />
                    </td>
                    <td className="c">
                      <input type="number" min={0} max={9} className="wz-cell c" style={{ width: 44 }} value={a.res_crew ?? 0}
                             onChange={(e) => editAct(i, { res_crew: Number(e.target.value) })} disabled={a.milestone} />
                    </td>
                    <td>
                      <input className="wz-cell" value={(a.predecessors ?? []).map((p) => p.code).join(", ")}
                             onChange={(e) => editAct(i, { predecessors: e.target.value.split(/[\s,]+/).filter(Boolean).map((c) => ({ code: c, type: "FS", lag_days: 0 })) })} />
                    </td>
                    <td className="c"><button className="wz-del" onClick={() => removeAct(i)}>삭제</button></td>
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
                {stage === "done" ? "✅ 베이스라인 확정" : "⏸ 공정 스케줄링"}
              </span>
              <b style={{ fontSize: 14 }}> {stage === "done" ? "공정표 베이스라인이 확정되었습니다" : "공정표 베이스라인 — 최종 검토"}</b>
              <p style={{ fontSize: 12, color: "#64748b", margin: "4px 0 0" }}>
                플래닝 기반으로 CPM 날짜를 계산한 베이스라인입니다. {stage === "scheduled" ? "간트를 검토하고 확정하세요." : "P6 XML 을 다운로드해 Primavera 에서 사용하세요."}
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              {stage === "scheduled" && (
                <button className="wz-btn green" disabled={busy} onClick={() => void onConfirm()}>베이스라인 확정</button>
              )}
              {planId && (
                <a className="wz-btn ghost" style={{ textDecoration: "none" }} href={planP6XmlUrl(planId)}>P6 XML 다운로드</a>
              )}
              {stage === "done" && (
                <button className="wz-btn" onClick={() => {
                  setPlanId(null); setPlan(null); setActs([]); setErr(null); setDirty(false);
                  localStorage.removeItem(PLAN_CKPT);
                  router.replace("?");
                }}>새 계획 시작</button>
              )}
            </div>
          </div>
          {plan?.payload.schedule && (
            <div className="wz-rat-body" style={{ marginBottom: 10 }}>
              <p><b>베이스라인 근거</b> — PM이 컨펌한 플래닝(활동·선후행·기간)을 입력으로,
                시스템이 CPM + SGS 자원 평준화(크레인·작업조 한도 내 배치)로 날짜를 결정론 계산했습니다.
                활동 {String((plan.payload.schedule as Record<string, unknown>).activity_count ?? ganttTasks.length)}개
                · 준공 {String((plan.payload.schedule as Record<string, unknown>).end_date ?? "-")}.
                {Array.isArray((plan.payload.schedule as Record<string, unknown>).warnings) &&
                  ((plan.payload.schedule as Record<string, unknown>).warnings as string[]).length > 0 && (
                  <span className="wz-rat-stat"> ⚠ 보정 {((plan.payload.schedule as Record<string, unknown>).warnings as string[]).length}건 (순환·기간상한 등)</span>
                )}
              </p>
            </div>
          )}
          {(() => {
            const tgt = (plan?.payload.schedule as Record<string, unknown> | undefined)?.target as
              | { target_days: number; achieved_days?: number; met?: boolean; advice?: string;
                  suggestion?: { crane: number; crew: number; days: number } | null } | undefined;
            if (!tgt || stage === "done") return null;
            const m = (d?: number) => (d ? `${Math.round(d / 30.4)}개월` : "-");
            return tgt.met ? (
              <div style={{ border: "1px solid #bbf7d0", background: "#f0fdf4", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#15803d", marginBottom: 10 }}>
                ✅ 목표공기 달성 — 목표 {m(tgt.target_days)} / 산출 {m(tgt.achieved_days)}
              </div>
            ) : (
              <div style={{ border: "1px solid #fde68a", background: "#fffbeb", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#92400e", marginBottom: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ flex: 1 }}>
                  ⚠ 목표공기 초과 — 목표 <b>{m(tgt.target_days)}</b> vs 산출 <b>{m(tgt.achieved_days)}</b>.
                  {tgt.suggestion
                    ? <> 크레인 <b>{tgt.suggestion.crane}대</b>·작업조 <b>{tgt.suggestion.crew}조</b>면 <b>{m(tgt.suggestion.days)}</b> 달성 가능.</>
                    : <> 자원 증설로는 불가 — 선후행·기간이 지배(공법·플래닝 재검토 필요).</>}
                </span>
                {tgt.suggestion && (
                  <button className="wz-btn" disabled={busy} onClick={() => {
                    setBusy(true);
                    void confirmPlan(planId!, { crane: tgt.suggestion!.crane, crew: tgt.suggestion!.crew })
                      .then(() => refresh(planId!)).finally(() => setBusy(false));
                  }}>이 자원으로 재스케줄</button>
                )}
              </div>
            );
          })()}
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
        .wz-step.big { padding: 12px 16px; }
        .wz-substeps { display: flex; gap: 5px; margin-top: 5px; flex-wrap: wrap; }
        .wz-substep { font-size: 10.5px; padding: 2px 8px; border-radius: 10px; background: #f1f5f9; color: #94a3b8; }
        .wz-substep.on { background: #dbeafe; color: #1d4ed8; font-weight: 700; }
        .wz-substep.done { background: #dcfce7; color: #15803d; }
        .wz-step-arrow { position: absolute; right: -6px; top: 50%; transform: translateY(-50%); color: #cbd5e1; font-size: 16px; z-index: 1; }
        .wz-card { border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; background: #fff; }
        .wz-in { width: 100%; padding: 7px 9px; border: 1px solid #cbd5e1; border-radius: 7px; font-size: 13px; box-sizing: border-box; background: #fff; }
        .wz-sub { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: #64748b; flex: 1; }
        .wz-chip { padding: 3px 10px; border: 1px solid #cbd5e1; border-radius: 13px; font-size: 11.5px;
                   background: #fff; color: #475569; cursor: pointer; }
        .wz-chip:hover { border-color: #2563eb; color: #2563eb; }
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
        .wz-rat { border: 1px solid #e9d5ff; background: #faf5ff; border-radius: 10px; padding: 10px 14px; margin-bottom: 12px; }
        .wz-rat summary { cursor: pointer; font-size: 12.5px; font-weight: 700; color: #7c3aed; }
        .wz-rat-body { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
        .wz-rat-body p { margin: 0; font-size: 12.5px; color: #475569; line-height: 1.65; }
        .wz-rat-body b { color: #1e293b; }
        .wz-rat-stat { color: #7c3aed; font-size: 11.5px; }
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
