"use client";

/**
 * 공정 진도율 — 워크유닛별 실적 관리 보드.
 *
 * 대시보드에서 분석·저장한 워크유닛을 목록화 → 대기/진행/완료 3단계 수동 체크.
 * 이 상태 = 실적의 단일 소스 (activity_code 키로 영속, 재분석에도 보존).
 * 진도율 = (완료 + 0.5×진행) ÷ 전체.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  getUnitProgress,
  saveUnitProgress,
  type ProgressUnit,
  type UnitStatus,
} from "../../lib/api/fourdProgress";
import {
  listScheduleReports,
  getScheduleReport,
  aggregateReport,
  type ScheduleReportMeta,
  type ScheduleReportDoc,
} from "../../lib/api/schedule";
import { ScheduleFormView } from "../documents/DocumentFormViews";

const REPORT_KO: Record<string, string> = {
  proc_daily: "공사일보",
  proc_weekly: "주간 공정현황",
  proc_monthly: "월간 공정현황",
};
/** today as "YYYY.MM.DD" (백엔드 reference_date 포맷과 일치). */
function todayDot(): string {
  const d = new Date();
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

const STATUS_META: Record<UnitStatus, { label: string; bg: string; fg: string }> = {
  pending: { label: "대기", bg: "var(--line)", fg: "var(--muted-strong)" },
  active: { label: "진행", bg: "var(--primary)", fg: "#083344" },
  done: { label: "완료", bg: "var(--green)", fg: "#053b2c" },
};
const ORDER: UnitStatus[] = ["pending", "active", "done"];

const koStorey = (s: string | null) =>
  !s ? "?" : s === "PT" ? "기초(PT)" : s === "RF" ? "지붕(RF)" : `${Number(s)}층`;

export function ProgressBoard() {
  const [units, setUnits] = useState<ProgressUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // 보고서 작성 현황 (일/주/월)
  const [reports, setReports] = useState<ScheduleReportMeta[]>([]);
  const [openedDoc, setOpenedDoc] = useState<ScheduleReportDoc | null>(null);

  useEffect(() => {
    let alive = true;
    getUnitProgress()
      .then((u) => alive && setUnits(u))
      .catch((e) => alive && setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    listScheduleReports()
      .then((r) => alive && setReports(r))
      .catch(() => {/* 보고서 없으면 무시 */});
    return () => {
      alive = false;
    };
  }, []);

  const openReport = useCallback(async (id: number) => {
    try {
      const doc = await getScheduleReport(id);
      if (doc) setOpenedDoc(doc);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "보고서 열기 실패");
    }
  }, []);

  // 주간/월간 = 그 주·달 공사일보 집계 생성 (파일 불필요)
  const [genBusy, setGenBusy] = useState<"weekly" | "monthly" | null>(null);
  const generateAgg = useCallback(async (period: "weekly" | "monthly") => {
    const d = new Date();
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    setGenBusy(period);
    setErr(null);
    try {
      const r = await aggregateReport(period, iso);
      if (r.document) setOpenedDoc(r.document);
      setReports(await listScheduleReports());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "집계 생성 실패");
    } finally {
      setGenBusy(null);
    }
  }, []);

  // 상태 변경 — 낙관적 업데이트 + 단건 저장.
  const setStatus = useCallback(async (code: string | null, status: UnitStatus) => {
    if (!code) return;
    setUnits((prev) => prev.map((u) => (u.activity_code === code ? { ...u, status } : u)));
    setSaving(true);
    try {
      await saveUnitProgress([{ activity_code: code, status }]);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  }, []);

  // 진도율 — (완료 + 0.5×진행) ÷ 전체
  const stats = useMemo(() => {
    const total = units.length;
    const done = units.filter((u) => u.status === "done").length;
    const active = units.filter((u) => u.status === "active").length;
    const pending = total - done - active;
    const pct = total ? Math.round(((done + active * 0.5) / total) * 100) : 0;
    return { total, done, active, pending, pct };
  }, [units]);

  // 패키지(구역·층)별 그룹 — 간트와 동일하게 '시작일순'(기초→골조→모듈)으로 정렬.
  const groups = useMemo(() => {
    const ms = (s: string | null) => (s ? new Date(String(s).slice(0, 10)).getTime() : Infinity);
    const m = new Map<string, ProgressUnit[]>();
    for (const u of units) {
      const k = u.package_key || `${u.zone ?? "-"}|${u.storey ?? "-"}`;
      const arr = m.get(k);
      if (arr) arr.push(u);
      else m.set(k, [u]);
    }
    // 그룹 내부: 시작일순
    for (const arr of m.values()) arr.sort((a, b) => ms(a.start) - ms(b.start));
    // 그룹 간: 그룹 최소 시작일순
    const minStart = (us: ProgressUnit[]) => Math.min(...us.map((u) => ms(u.start)));
    return [...m.entries()].sort((a, b) => minStart(a[1]) - minStart(b[1]));
  }, [units]);

  const groupLabel = (us: ProgressUnit[]) => {
    const f = us[0];
    return `${f.zone ? f.zone + " " : ""}${koStorey(f.storey)}`;
  };

  return (
    <div style={{ padding: 20, height: "100%", overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 20 }}>공정 진도율</h1>
        <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 13 }}>
          워크유닛별로 대기·진행·완료를 체크해 실적을 관리합니다. (대시보드에서 분석·저장한 공정 기준)
        </p>
      </div>

      {/* 보고서 작성 현황 (공사일보/주간/월간) */}
      <div style={{ padding: "12px 16px", background: "var(--primary-soft)", borderRadius: 10, border: "1px solid var(--primary-soft)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 14, color: "var(--primary-deep)" }}>보고서 작성 현황</strong>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {(() => {
              const t = todayDot();
              const hasToday = reports.some((r) => r.doc_type === "proc_daily" && r.date === t);
              return (
                <span style={{ fontSize: 13, fontWeight: 600, color: hasToday ? "var(--green)" : "var(--red)" }}>
                  오늘({t}) 공사일보 {hasToday ? "작성됨" : "미작성"}
                </span>
              );
            })()}
            <button
              type="button"
              onClick={() => generateAgg("weekly")}
              disabled={genBusy !== null}
              title="이번 주 공사일보를 모아 주간 보고서 생성"
              style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: genBusy === "weekly" ? "var(--muted)" : "var(--primary)", color: "var(--surface)", fontSize: 12, fontWeight: 600, cursor: genBusy ? "default" : "pointer" }}
            >
              {genBusy === "weekly" ? "집계 중…" : "주간 생성"}
            </button>
            <button
              type="button"
              onClick={() => generateAgg("monthly")}
              disabled={genBusy !== null}
              title="이번 달 공사일보를 모아 월간 보고서 생성"
              style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: genBusy === "monthly" ? "var(--muted)" : "var(--primary)", color: "var(--surface)", fontSize: 12, fontWeight: 600, cursor: genBusy ? "default" : "pointer" }}
            >
              {genBusy === "monthly" ? "집계 중…" : "월간 생성"}
            </button>
          </div>
        </div>
        {reports.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            작성된 보고서가 없습니다. 대시보드에서 <strong>이 날짜 공사일보</strong>로 작성하세요.
          </div>
        ) : (
          (["proc_daily", "proc_weekly", "proc_monthly"] as const).map((dt) => {
            const rs = reports.filter((r) => r.doc_type === dt);
            if (!rs.length) return null;
            return (
              <div key={dt} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted-strong)", minWidth: 88 }}>
                  {REPORT_KO[dt]} ({rs.length})
                </span>
                {rs.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => openReport(r.id)}
                    title={r.title ?? ""}
                    style={{ padding: "3px 9px", borderRadius: 6, border: "1px solid var(--primary-soft)", background: "var(--surface)", color: "var(--primary-deep)", fontSize: 12, cursor: "pointer" }}
                  >
                    {r.date ?? r.created_at?.slice(0, 10) ?? `#${r.id}`}
                  </button>
                ))}
              </div>
            );
          })
        )}
      </div>

      {loading && <div style={{ color: "var(--muted)", fontSize: 14 }}>불러오는 중…</div>}

      {!loading && units.length === 0 && (
        <div style={{ padding: 24, background: "var(--surface-soft)", borderRadius: 10, color: "var(--muted-strong)", fontSize: 14 }}>
          저장된 워크유닛이 없습니다. <strong>대시보드</strong>에서 공정표·BIM을 올려 분석한 뒤
          <strong> 진도율·PMIS-X 저장</strong> 버튼을 누르면 여기에 목록이 나타납니다.
        </div>
      )}

      {!loading && units.length > 0 && (
        <>
          {/* 진도율 요약 */}
          <div style={{ padding: "14px 16px", background: "var(--surface-soft)", borderRadius: 10, border: "1px solid var(--line)" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
              <strong style={{ fontSize: 15 }}>전체 진도율</strong>
              <span style={{ fontSize: 22, fontWeight: 700, color: "var(--primary)" }}>{stats.pct}%</span>
            </div>
            <div style={{ height: 10, background: "var(--line)", borderRadius: 5, overflow: "hidden" }}>
              <div style={{ width: `${stats.pct}%`, height: "100%", background: "var(--green)", transition: "width .3s" }} />
            </div>
            <div style={{ marginTop: 8, fontSize: 13, color: "var(--muted-strong)" }}>
              완료 <strong style={{ color: STATUS_META.done.bg }}>{stats.done}</strong> ·
              진행 <strong style={{ color: "var(--teal)" }}>{stats.active}</strong> ·
              대기 <strong style={{ color: "var(--muted)" }}>{stats.pending}</strong>
              {" / "}전체 {stats.total} · 진도율 = (완료 + 0.5×진행) ÷ 전체
              {saving && <span style={{ marginLeft: 8, color: "var(--muted)" }}>저장 중…</span>}
            </div>
            {err && <div style={{ marginTop: 6, color: "var(--red)", fontSize: 13 }}>{err}</div>}
          </div>

          {/* 그룹별 유닛 목록 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {groups.map(([key, us]) => {
              const gDone = us.filter((u) => u.status === "done").length;
              return (
                <div key={key} style={{ border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ padding: "8px 14px", background: "var(--surface-soft)", display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 600, color: "var(--muted-strong)" }}>
                    <span>{groupLabel(us)} <span style={{ color: "var(--muted)", fontWeight: 400 }}>({key})</span></span>
                    <span style={{ color: "var(--muted)", fontWeight: 400 }}>{gDone}/{us.length} 완료</span>
                  </div>
                  <div>
                    {us.map((u) => (
                      <div
                        key={u.id}
                        style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", borderTop: "1px solid var(--surface-soft)" }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {u.name || u.activity_code || "—"}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--muted)" }}>
                            {u.activity_code}{u.phase ? ` · ${u.phase}` : ""}
                            {u.match_source === "ai" ? " · AI매칭" : ""}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 4 }}>
                          {ORDER.map((st) => {
                            const on = u.status === st;
                            const m = STATUS_META[st];
                            return (
                              <button
                                key={st}
                                type="button"
                                onClick={() => setStatus(u.activity_code, st)}
                                disabled={!u.activity_code}
                                style={{
                                  padding: "5px 12px",
                                  borderRadius: 6,
                                  border: on ? "none" : "1px solid var(--line-strong)",
                                  background: on ? m.bg : "var(--surface)",
                                  color: on ? m.fg : "var(--muted)",
                                  fontSize: 12,
                                  fontWeight: on ? 700 : 500,
                                  cursor: u.activity_code ? "pointer" : "default",
                                }}
                              >
                                {m.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {openedDoc && (
        <div
          onClick={() => setOpenedDoc(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 3000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 24, overflow: "auto" }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--surface)", borderRadius: 12, padding: 20, maxWidth: 880, width: "100%", boxShadow: "0 10px 40px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>{REPORT_KO[openedDoc.doc_type] ?? "보고서"} — {openedDoc.reference_date || openedDoc.data_date}</h2>
              <button onClick={() => setOpenedDoc(null)} style={{ border: "none", background: "var(--surface-soft)", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>닫기</button>
            </div>
            <ScheduleFormView doc={openedDoc} showPipeline={false} />
          </div>
        </div>
      )}
    </div>
  );
}
