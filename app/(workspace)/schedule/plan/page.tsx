"use client";

/**
 * 공정계획 위저드 — PM 4단계 + 휴먼인더루프 (md/strategy/pm_philosophy_4stages.md).
 *
 *   [1 입력·스코프] → P2 생성 → [2 Gate A: 액티비티 검토·수정] → P3+P4
 *   → [3 Gate B: 관계·기간 검토·수정] → S1 CPM → [4 Gate C: 간트 확인·확정] → P6 XML
 *
 * AI = 초안 제안, PM = 각 게이트에서 컨펌·수정 (사람이 진실원천).
 * 원샷 데모는 /schedule/generate (PoC 보존).
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

const STEPS = ["입력·스코프", "액티비티 (Gate A)", "관계·기간 (Gate B)", "스케줄 확정 (Gate C)"] as const;

/** stage → 위저드 스텝 인덱스 */
const stageStep = (st: PlanStage): number =>
  st === "running_p2" ? 1 : st === "activities_ready" ? 1
  : st === "running_p34" ? 2 : st === "logic_ready" ? 2
  : st === "running_s1" || st === "scheduled" || st === "done" ? 3 : 0;

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
  const [acts, setActs] = useState<PlanActivity[]>([]);   // 편집 버퍼 (Gate A/B)
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ganttReady, setGanttReady] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stage: PlanStage | null = plan?.stage ?? null;
  const step = planId ? stageStep(stage ?? "running_p2") : 0;
  const running = stage === "running_p2" || stage === "running_p34" || stage === "running_s1";

  // ── 폴링: running 단계 동안 3초 간격 ──
  const refresh = useCallback(async (id: string) => {
    try {
      const p = await getPlan(id);
      setPlan(p);
      if (p.payload.scope) setScopeWbs(p.payload.scope);
      // 편집 버퍼 동기화 — 사용자 수정 중(dirty)이 아닐 때만 서버본으로 갱신
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
      setBimName(`${file.name} (${parsed.elements.length}부재 → ${agg.size}워크패키지)`);
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

  // ── 시작 (P1+P2) ──
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

  // ── 게이트 액션 ──
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

  // ── 간트 (scheduled 이후) ──
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

  // ── 편집 헬퍼 ──
  const editAct = (i: number, patch: Partial<PlanActivity>) => {
    setActs((prev) => prev.map((a, j) => (j === i ? { ...a, ...patch } : a)));
    setDirty(true);
  };
  const removeAct = (i: number) => { setActs((prev) => prev.filter((_, j) => j !== i)); setDirty(true); };

  // ════════════════ 렌더 ════════════════
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <header>
        <h1 className="text-xl font-bold">공정계획 위저드 — PM 4단계</h1>
        <p className="text-sm text-gray-500">플래닝(스코프→액티비티→관계→기간) → 스케줄링. 각 게이트에서 검토·수정 후 진행합니다.</p>
      </header>

      {/* 스텝 인디케이터 */}
      <ol className="flex gap-2 text-sm">
        {STEPS.map((s, i) => (
          <li key={s} className={`flex-1 rounded border px-3 py-2 text-center ${
            i === step ? "border-blue-500 bg-blue-50 font-semibold text-blue-700"
            : i < step ? "border-green-300 bg-green-50 text-green-700" : "border-gray-200 text-gray-400"}`}>
            {i < step ? "✓ " : `${i + 1}. `}{s}
          </li>
        ))}
      </ol>

      {err && <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">{err}</div>}
      {running && (
        <div className="flex items-center gap-3 rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          {plan?.progress ?? "AI 작업 중…"}
        </div>
      )}

      {/* ── Step 1: 입력 ── */}
      {step === 0 && (
        <section className="space-y-4 rounded border p-4">
          <div className="flex items-center gap-3">
            <label className="cursor-pointer rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">
              {bimBusy ? "BIM 분석 중…" : "BIM(IFC) 업로드"}
              <input type="file" accept=".ifc" className="hidden" disabled={bimBusy}
                     onChange={(e) => { const f = e.target.files?.[0]; if (f) void onBim(f); }} />
            </label>
            {bimName && <span className="text-sm text-gray-600">{bimName}</span>}
          </div>
          {inferReason && <p className="text-xs text-gray-500">🤖 AI 판정: {inferReason}</p>}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <label className="text-sm">건물유형*
              <input className="mt-1 w-full rounded border px-2 py-1.5" value={buildingType} onChange={(e) => setBuildingType(e.target.value)} placeholder="예: 모듈러 주택" /></label>
            <label className="text-sm">범위(scope)
              <input className="mt-1 w-full rounded border px-2 py-1.5" value={scope} onChange={(e) => setScope(e.target.value)} placeholder="골조 / 전체" /></label>
            <label className="text-sm">구조유형
              <select className="mt-1 w-full rounded border px-2 py-1.5" value={structureType} onChange={(e) => setStructureType(e.target.value)}>
                <option value="">자동/미지정</option><option>RC</option><option>철골</option><option>SRC</option>
                <option>PC·모듈러</option><option value="혼합">혼합(RC코어+철골)</option>
              </select></label>
            <label className="text-sm">착공일*
              <input type="date" className="mt-1 w-full rounded border px-2 py-1.5" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
            <label className="text-sm">목표공기(개월)
              <input type="number" className="mt-1 w-full rounded border px-2 py-1.5" value={durationMonths} onChange={(e) => setDurationMonths(e.target.value)} /></label>
            <label className="text-sm">주 근무일
              <select className="mt-1 w-full rounded border px-2 py-1.5" value={wdpw} onChange={(e) => setWdpw(Number(e.target.value))}>
                <option value={5}>주5일</option><option value={6}>주6일</option><option value={7}>주7일</option>
              </select></label>
            <label className="text-sm">타워크레인(대)
              <input type="number" min={0} className="mt-1 w-full rounded border px-2 py-1.5" value={towerCranes} onChange={(e) => setTowerCranes(Number(e.target.value))} /></label>
            <label className="text-sm">작업조(조)
              <input type="number" min={1} className="mt-1 w-full rounded border px-2 py-1.5" value={workCrews} onChange={(e) => setWorkCrews(Number(e.target.value))} /></label>
            <label className="text-sm md:col-span-3">제약(자유서술)
              <input className="mt-1 w-full rounded border px-2 py-1.5" value={constraints} onChange={(e) => setConstraints(e.target.value)} placeholder="예: 야간작업 불가, 동절기 타설 제한" /></label>
          </div>
          {workUnits.length > 0 && (
            <p className="text-sm text-gray-600">📦 워크패키지 {workUnits.length}개 · 구역 {zones.length} · 층 {storeys.length}</p>
          )}
          <button className="rounded bg-blue-600 px-5 py-2 text-white disabled:opacity-40" disabled={!buildingType.trim() || !startDate || busy} onClick={() => void onStart()}>
            {busy ? "시작 중…" : "P1 스코프 확정 → P2 액티비티 생성"}
          </button>
        </section>
      )}

      {/* WBS 요약 (P1 산출 — 전 단계 공통 표시) */}
      {scopeWbs && step >= 1 && (
        <details className="rounded border bg-gray-50 p-3 text-sm" open={step === 1 && running}>
          <summary className="cursor-pointer font-semibold">P1 스코프 — WBS ({scopeWbs.package_count} 워크패키지 · 구역 {scopeWbs.zones.length})</summary>
          <div className="mt-2 space-y-1">
            {scopeWbs.wbs.map((d) => (
              <div key={d.discipline}>
                <b>{d.discipline}</b>: {d.storeys.map((s) => `${s.storey}(${s.zones.length}구역)`).join(" · ")}
              </div>
            ))}
          </div>
        </details>
      )}

      {/* ── Step 2: Gate A 액티비티 ── */}
      {stage === "activities_ready" && (
        <section className="space-y-3 rounded border p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">⏸ Gate A — 액티비티 {acts.length}개 검토 {dirty && <em className="text-amber-600">(수정됨·미저장)</em>}</h2>
            <div className="flex gap-2">
              <button className="rounded border px-3 py-1.5 text-sm disabled:opacity-40" disabled={!dirty || busy} onClick={() => void onSaveActs()}>수정 저장</button>
              <button className="rounded bg-green-600 px-4 py-1.5 text-sm text-white disabled:opacity-40" disabled={busy} onClick={() => void onConfirm()}>컨펌 → P3 관계·P4 기간</button>
            </div>
          </div>
          <div className="max-h-[480px] overflow-auto rounded border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-100">
                <tr><th className="p-2 text-left">활동명</th><th className="p-2">구역</th><th className="p-2">층</th><th className="p-2">공종</th><th className="p-2">단계</th><th className="p-2">MS</th><th className="p-2" /></tr>
              </thead>
              <tbody>
                {acts.map((a, i) => (
                  <tr key={a.code} className="border-t hover:bg-blue-50/40">
                    <td className="p-1"><input className="w-full rounded border px-1 py-0.5" value={a.name} onChange={(e) => editAct(i, { name: e.target.value })} /></td>
                    <td className="p-1 text-center text-gray-600">{a.fd_zone ?? "-"}</td>
                    <td className="p-1 text-center text-gray-600">{a.fd_storey ?? "-"}</td>
                    <td className="p-1 text-center text-gray-600">{a.fd_op ?? "-"}</td>
                    <td className="p-1 text-center text-gray-600">{a.fd_phase ?? "-"}</td>
                    <td className="p-1 text-center">{a.milestone ? "◆" : ""}</td>
                    <td className="p-1 text-center"><button className="text-red-500 hover:underline" onClick={() => removeAct(i)}>삭제</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Step 3: Gate B 관계·기간 ── */}
      {stage === "logic_ready" && (
        <section className="space-y-3 rounded border p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">⏸ Gate B — 선후행·기간 검토 {dirty && <em className="text-amber-600">(수정됨·미저장)</em>}</h2>
            <div className="flex gap-2">
              <button className="rounded border px-3 py-1.5 text-sm disabled:opacity-40" disabled={!dirty || busy} onClick={() => void onSaveLogic()}>수정 저장</button>
              <button className="rounded bg-green-600 px-4 py-1.5 text-sm text-white disabled:opacity-40" disabled={busy} onClick={() => void onConfirm()}>컨펌 → S1 스케줄링(CPM)</button>
            </div>
          </div>
          <div className="max-h-[480px] overflow-auto rounded border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-100">
                <tr><th className="p-2 text-left">활동명</th><th className="p-2">기간(일)</th><th className="p-2 text-left">선행 (code, 쉼표 구분)</th></tr>
              </thead>
              <tbody>
                {acts.map((a, i) => (
                  <tr key={a.code} className="border-t hover:bg-blue-50/40">
                    <td className="p-1">{a.name} <span className="text-gray-400">({a.code})</span></td>
                    <td className="p-1 text-center">
                      <input type="number" min={0} className="w-16 rounded border px-1 py-0.5 text-center" value={a.duration_days}
                             onChange={(e) => editAct(i, { duration_days: Number(e.target.value) })} disabled={a.milestone} />
                    </td>
                    <td className="p-1">
                      <input className="w-full rounded border px-1 py-0.5" value={(a.predecessors ?? []).map((p) => p.code).join(", ")}
                             onChange={(e) => editAct(i, { predecessors: e.target.value.split(/[\s,]+/).filter(Boolean).map((c) => ({ code: c, type: "FS", lag_days: 0 })) })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Step 4: Gate C 간트·확정 ── */}
      {(stage === "scheduled" || stage === "done") && (
        <section className="space-y-3 rounded border p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{stage === "done" ? "✅ 확정 완료" : "⏸ Gate C — 스케줄 최종 검토"}</h2>
            <div className="flex gap-2">
              {stage === "scheduled" && (
                <button className="rounded bg-green-600 px-4 py-1.5 text-sm text-white disabled:opacity-40" disabled={busy} onClick={() => void onConfirm()}>최종 확정</button>
              )}
              {planId && (
                <a className="rounded border px-4 py-1.5 text-sm hover:bg-gray-50" href={planP6XmlUrl(planId)}>P6 XML 다운로드</a>
              )}
            </div>
          </div>
          {ganttReady && ganttTasks.length > 0 ? (
            <GanttChart tasks={ganttTasks} height={520} viewMode="Week" fillWidth />
          ) : (
            <p className="text-sm text-gray-500">간트 로드 중… (활동 {ganttTasks.length}개)</p>
          )}
        </section>
      )}
    </div>
  );
}
