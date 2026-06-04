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

const STATUS_META: Record<UnitStatus, { label: string; bg: string; fg: string }> = {
  pending: { label: "대기", bg: "#e2e8f0", fg: "#475569" },
  active: { label: "진행", bg: "#22d3ee", fg: "#083344" },
  done: { label: "완료", bg: "#10b981", fg: "#053b2c" },
};
const ORDER: UnitStatus[] = ["pending", "active", "done"];

const koStorey = (s: string | null) =>
  !s ? "?" : s === "PT" ? "기초(PT)" : s === "RF" ? "지붕(RF)" : `${Number(s)}층`;

export function ProgressBoard() {
  const [units, setUnits] = useState<ProgressUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    getUnitProgress()
      .then((u) => alive && setUnits(u))
      .catch((e) => alive && setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
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
    <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 20 }}>공정 진도율</h1>
        <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 13 }}>
          워크유닛별로 대기·진행·완료를 체크해 실적을 관리합니다. (대시보드에서 분석·저장한 공정 기준)
        </p>
      </div>

      {loading && <div style={{ color: "#64748b", fontSize: 14 }}>불러오는 중…</div>}

      {!loading && units.length === 0 && (
        <div style={{ padding: 24, background: "#f8fafc", borderRadius: 10, color: "#475569", fontSize: 14 }}>
          저장된 워크유닛이 없습니다. <strong>대시보드</strong>에서 공정표·BIM을 올려 분석한 뒤
          <strong> 🧩 워크패키지 → 💾 저장</strong>하면 여기에 목록이 나타납니다.
        </div>
      )}

      {!loading && units.length > 0 && (
        <>
          {/* 진도율 요약 */}
          <div style={{ padding: "14px 16px", background: "#f8fafc", borderRadius: 10, border: "1px solid #e2e8f0" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
              <strong style={{ fontSize: 15 }}>전체 진도율</strong>
              <span style={{ fontSize: 22, fontWeight: 700, color: "#0ea5e9" }}>{stats.pct}%</span>
            </div>
            <div style={{ height: 10, background: "#e2e8f0", borderRadius: 5, overflow: "hidden" }}>
              <div style={{ width: `${stats.pct}%`, height: "100%", background: "#10b981", transition: "width .3s" }} />
            </div>
            <div style={{ marginTop: 8, fontSize: 13, color: "#475569" }}>
              완료 <strong style={{ color: STATUS_META.done.bg }}>{stats.done}</strong> ·
              진행 <strong style={{ color: "#0891b2" }}>{stats.active}</strong> ·
              대기 <strong style={{ color: "#64748b" }}>{stats.pending}</strong>
              {" / "}전체 {stats.total} · 진도율 = (완료 + 0.5×진행) ÷ 전체
              {saving && <span style={{ marginLeft: 8, color: "#94a3b8" }}>저장 중…</span>}
            </div>
            {err && <div style={{ marginTop: 6, color: "#dc2626", fontSize: 13 }}>⚠ {err}</div>}
          </div>

          {/* 그룹별 유닛 목록 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {groups.map(([key, us]) => {
              const gDone = us.filter((u) => u.status === "done").length;
              return (
                <div key={key} style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ padding: "8px 14px", background: "#f1f5f9", display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 600, color: "#334155" }}>
                    <span>{groupLabel(us)} <span style={{ color: "#94a3b8", fontWeight: 400 }}>({key})</span></span>
                    <span style={{ color: "#64748b", fontWeight: 400 }}>{gDone}/{us.length} 완료</span>
                  </div>
                  <div>
                    {us.map((u) => (
                      <div
                        key={u.id}
                        style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", borderTop: "1px solid #f1f5f9" }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {u.name || u.activity_code || "—"}
                          </div>
                          <div style={{ fontSize: 11, color: "#94a3b8" }}>
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
                                  border: on ? "none" : "1px solid #cbd5e1",
                                  background: on ? m.bg : "#fff",
                                  color: on ? m.fg : "#94a3b8",
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
    </div>
  );
}
