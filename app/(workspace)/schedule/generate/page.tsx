"use client";

/**
 * 공정표 자동생성기 — 6하원칙 입력(+선택적 BIM 물량) → GPT-5.4 JSON → P6 XML.
 *
 * 책임 분리: GPT는 JSON(활동·기간·deps)만, 백엔드 Python이 CPM 날짜계산·P6 XML·라운드트립 검증.
 * AI = 초안 제안, PM = 확정 (진단 어시스턴트 정체성).
 */
import { type FC, useEffect, useMemo, useState } from "react";

import {
  generateSchedule,
  listScheduleMethods,
  type GanttTask,
  type GenerateScheduleResult,
  type GenWorkUnit,
  type MethodGroup,
} from "../../../../lib/api/schedule";
import { classifyIfcType } from "../../../../lib/fourd/match";
import GanttChartRaw from "../../../../components/process/GanttChart";

const GanttChart = GanttChartRaw as unknown as FC<{
  tasks: GanttTask[];
  height?: number;
  viewMode?: string;
  fillWidth?: boolean;
}>;

// frappe-gantt umd + css 1회 로드 (DashboardSchedule 와 동일 자산)
let _ganttLoad: Promise<void> | null = null;
function loadFrappeGantt(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if ((window as unknown as { Gantt?: unknown }).Gantt) return Promise.resolve();
  if (_ganttLoad) return _ganttLoad;
  _ganttLoad = new Promise<void>((resolve, reject) => {
    if (!document.querySelector("link[data-frappe-gantt]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "/libs/frappe-gantt.css";
      link.setAttribute("data-frappe-gantt", "1");
      document.head.appendChild(link);
    }
    const script = document.createElement("script");
    script.src = "/libs/frappe-gantt.umd.js";
    script.setAttribute("data-frappe-gantt", "1");
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("frappe-gantt 로드 실패"));
    document.body.appendChild(script);
  });
  return _ganttLoad;
}

const splitList = (s: string): string[] =>
  s.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);

export default function ScheduleGeneratePage() {
  // ── 폼 상태 (6하원칙) ──
  const [buildingType, setBuildingType] = useState("");
  const [scope, setScope] = useState("");
  const [zones, setZones] = useState("");
  const [storeys, setStoreys] = useState("");
  const [methods, setMethods] = useState<string[]>([]);
  const [startDate, setStartDate] = useState("");
  const [targetFinish, setTargetFinish] = useState("");
  const [durationMonths, setDurationMonths] = useState("");
  const [wdpw, setWdpw] = useState(6);
  const [constraints, setConstraints] = useState("");
  const [workUnits, setWorkUnits] = useState<GenWorkUnit[]>([]);
  const [bimName, setBimName] = useState<string | null>(null);
  const [bimBusy, setBimBusy] = useState(false);

  // ── 공법 목록 ──
  const [methodGroups, setMethodGroups] = useState<MethodGroup[]>([]);
  useEffect(() => {
    void listScheduleMethods().then(setMethodGroups);
  }, []);

  // ── 결과 ──
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateScheduleResult | null>(null);
  const [ganttReady, setGanttReady] = useState(false);
  const [viewMode, setViewMode] = useState("Week");

  useEffect(() => {
    if (result) loadFrappeGantt().then(() => setGanttReady(true)).catch(() => setGanttReady(false));
  }, [result]);

  const toggleMethod = (key: string) =>
    setMethods((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  // ── BIM 업로드 → 물량 집계 ──
  const onBim = async (file: File) => {
    setBimBusy(true);
    setErr(null);
    try {
      const { parseIfc } = await import("../../../../lib/fourd/ifc");
      const buf = await file.arrayBuffer();
      const parsed = await parseIfc(buf);
      const agg = new Map<string, GenWorkUnit>();
      const zoneSet = new Set<string>();
      const storeySet = new Set<string>();
      for (const el of parsed.elements) {
        const zone = el.zone ?? "-";
        const storey = el.storey4d ?? el.storeyName ?? "-";
        const cat = classifyIfcType(el.ifcType);
        if (el.zone) zoneSet.add(el.zone);
        if (storey !== "-") storeySet.add(storey);
        const key = `${zone}|${storey}|${cat}`;
        const u = agg.get(key) ?? { zone, storey, element_type: cat, count: 0 };
        u.count = (u.count ?? 0) + 1;
        agg.set(key, u);
      }
      setWorkUnits([...agg.values()]);
      setBimName(`${file.name} (${parsed.elements.length}부재 → ${agg.size}유형)`);
      if (!zones && zoneSet.size) setZones([...zoneSet].join(", "));
      if (!storeys && storeySet.size) setStoreys([...storeySet].sort().join(", "));
    } catch (e) {
      setErr(`BIM 파싱 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBimBusy(false);
    }
  };

  const canSubmit = buildingType.trim() && startDate && !busy;

  const onGenerate = async () => {
    setBusy(true);
    setErr(null);
    setResult(null);
    setGanttReady(false);
    try {
      const res = await generateSchedule({
        building_type: buildingType.trim(),
        scope: scope.trim() || undefined,
        zones: splitList(zones),
        storeys: splitList(storeys),
        work_units: workUnits,
        methods,
        start_date: startDate,
        target_finish: targetFinish || undefined,
        duration_months: durationMonths ? Number(durationMonths) : undefined,
        work_days_per_week: wdpw,
        constraints: constraints.trim() || undefined,
      });
      setResult(res);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const ganttTasks: GanttTask[] = useMemo(() => {
    if (!result) return [];
    return result.tasks
      .filter((t) => t.start && t.end)
      .map((t) => ({
        id: t.code,
        activity_code: t.code,
        name: t.name,
        wbs_code: "",
        start: t.start.slice(0, 10),
        end: t.end.slice(0, 10),
        progress: 0,
        is_cp: false,
        total_float_hr_cnt: null,
        status: "",
        dependencies: (t.predecessors ?? []).filter((p) => p !== t.code),
      })) as GanttTask[];
  }, [result]);

  const downloadXml = () => {
    if (!result) return;
    const blob = new Blob([result.p6xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${result.project_name || "schedule"}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ padding: 20, height: "100%", overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>공정표 자동생성기</h1>
        <p style={{ fontSize: 13, color: "#64748b", margin: "4px 0 0" }}>
          6가지 정보를 입력하면 GPT-5.4가 공정표 초안을 생성합니다. (날짜·P6 XML은 시스템이 결정론적으로 계산)
          <br />
          ⚠️ 기간은 AI 추정(품셈 미반영) — <b>초안</b>이며 PM 검토·확정이 필요합니다.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Field label="① 무엇을 — 건물유형 *">
          <input className="gen-in" value={buildingType} onChange={(e) => setBuildingType(e.target.value)}
            placeholder="예: 모듈러 공동주택, 근린생활시설" />
          <input className="gen-in" value={scope} onChange={(e) => setScope(e.target.value)}
            placeholder="범위 (예: 골조까지 / 마감 포함)" style={{ marginTop: 6 }} />
        </Field>
        <Field label="② 어디서 — 구역 / 층">
          <input className="gen-in" value={zones} onChange={(e) => setZones(e.target.value)}
            placeholder="구역 (쉼표: A, B, C)" />
          <input className="gen-in" value={storeys} onChange={(e) => setStoreys(e.target.value)}
            placeholder="층 (쉼표: PT, 01, 02, RF)" style={{ marginTop: 6 }} />
        </Field>

        <Field label="③ 얼마나 — BIM 물량 (선택)">
          <label className="gen-bim">
            {bimBusy ? "BIM 파싱 중…" : bimName ? `✅ ${bimName}` : "IFC 업로드 → 물량 자동집계"}
            <input type="file" accept=".ifc" style={{ display: "none" }}
              onChange={(e) => e.target.files?.[0] && onBim(e.target.files[0])} disabled={bimBusy} />
          </label>
          {workUnits.length > 0 && (
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
              {workUnits.length}개 물량유형 ({workUnits.reduce((s, u) => s + (u.count ?? 0), 0)}부재)
            </div>
          )}
        </Field>
        <Field label="⑤ 언제까지 — 일정">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <label className="gen-sub">착공일 *
              <input type="date" className="gen-in" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label className="gen-sub">목표 준공
              <input type="date" className="gen-in" value={targetFinish} onChange={(e) => setTargetFinish(e.target.value)} />
            </label>
            <label className="gen-sub">공기(개월)
              <input type="number" className="gen-in" value={durationMonths} onChange={(e) => setDurationMonths(e.target.value)} placeholder="대체" />
            </label>
            <label className="gen-sub">주 근무일
              <select className="gen-in" value={wdpw} onChange={(e) => setWdpw(Number(e.target.value))}>
                <option value={5}>주 5일</option>
                <option value={6}>주 6일</option>
                <option value={7}>주 7일</option>
              </select>
            </label>
          </div>
        </Field>
      </div>

      <Field label={`④ 어떤 방식 — 공법 선택 (${methods.length}개 선택)`}>
        <div className="gen-methods">
          {methodGroups.map((g) => (
            <div key={g.key} className="gen-mgroup">
              <div className="gen-mcat">{g.category}</div>
              <div className="gen-mlist">
                {g.methods.map((m) => (
                  <button key={m.key} type="button"
                    className={`gen-mchip${methods.includes(m.key) ? " on" : ""}`}
                    onClick={() => toggleMethod(m.key)} title={m.key}>
                    {m.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {methodGroups.length === 0 && <div style={{ fontSize: 12, color: "#94a3b8" }}>공법 목록 로딩 중…</div>}
        </div>
      </Field>

      <Field label="⑥ 어떤 제약 — 마일스톤·기상·동시작업 제한 등">
        <textarea className="gen-in" rows={2} value={constraints} onChange={(e) => setConstraints(e.target.value)}
          placeholder="예: 6월 말 골조 완료 마일스톤, 우천 시 콘크리트 타설 중단, 동시 타워크레인 2대 제약" />
      </Field>

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button type="button" className="gen-btn" disabled={!canSubmit} onClick={onGenerate}>
          {busy ? "생성 중… (GPT-5.4 추론)" : "공정표 생성"}
        </button>
        {err && <span style={{ color: "#dc2626", fontSize: 13 }}>{err}</span>}
      </div>

      {result && (
        <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              {result.project_name} — 활동 {result.activity_count} · 관계 {result.relationship_count} · {result.start_date} ~ {result.end_date ?? "?"}
              <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: 8 }}>({result.model})</span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <div className="sch-viewmode">
                {["Day", "Week", "Month"].map((vm) => (
                  <button key={vm} type="button" className={`sch-vm-btn${viewMode === vm ? " active" : ""}`}
                    onClick={() => setViewMode(vm)}>{vm === "Day" ? "일" : vm === "Week" ? "주" : "월"}</button>
                ))}
              </div>
              <button type="button" className="gen-btn" onClick={downloadXml}>📥 P6 XML 다운로드</button>
            </div>
          </div>

          {result.notes && (
            <div style={{ fontSize: 12, background: "#f1f5f9", padding: 8, borderRadius: 6, color: "#475569" }}>
              💡 {result.notes}
            </div>
          )}
          {result.warnings.length > 0 && (
            <div style={{ fontSize: 12, background: "#fef3c7", padding: 8, borderRadius: 6, color: "#92400e" }}>
              ⚠ {result.warnings.join(" · ")}
            </div>
          )}

          {ganttReady && ganttTasks.length > 0 ? (
            <GanttChart tasks={ganttTasks} height={560} viewMode={viewMode} fillWidth />
          ) : (
            <div style={{ fontSize: 13, color: "#94a3b8" }}>간트 렌더링 준비 중…</div>
          )}
        </div>
      )}

      <style jsx>{`
        .gen-in { width: 100%; padding: 7px 9px; border: 1px solid #cbd5e1; border-radius: 7px; font-size: 13px; box-sizing: border-box; }
        .gen-sub { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: #64748b; flex: 1; min-width: 110px; }
        .gen-bim { display: inline-block; padding: 8px 12px; border: 1px dashed #94a3b8; border-radius: 7px; font-size: 12px; cursor: pointer; color: #475569; background: #f8fafc; }
        .gen-methods { max-height: 230px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px; display: flex; flex-direction: column; gap: 8px; }
        .gen-mcat { font-size: 11px; font-weight: 700; color: #475569; margin-bottom: 4px; }
        .gen-mlist { display: flex; flex-wrap: wrap; gap: 5px; }
        .gen-mchip { padding: 3px 9px; border: 1px solid #cbd5e1; border-radius: 14px; font-size: 12px; background: #fff; cursor: pointer; color: #334155; }
        .gen-mchip.on { background: #2563eb; color: #fff; border-color: #2563eb; }
        .gen-btn { padding: 8px 16px; background: #2563eb; color: #fff; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; }
        .gen-btn:disabled { background: #cbd5e1; cursor: not-allowed; }
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
