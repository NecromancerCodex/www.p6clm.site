"use client";

/**
 * 4D 시뮬레이션 PoC — 공정표(XER/PMXML) + BIM(IFC) 드래그앤드롭 → 매칭 → 타임라인 4D.
 *
 * 파이프라인:
 *  1. 공정표 → CLM /schedule/upload (기존 재사용) → tasks (activity_code = 4D 코드)
 *  2. IFC   → 브라우저 web-ifc 파싱 → 요소(GlobalId/층/타입/지오메트리)
 *  3. 매칭  → buildScheduleIndex + matchAll (pmisx auto_allocate 이식)
 *  4. 4D    → three.js 타임라인 색칠
 */
import { useCallback, useRef, useState } from "react";

import { FourDViewer } from "../../../components/fourd/FourDViewer";
import { uploadSchedule } from "../../../lib/api/schedule";
import {
  buildCandidates,
  buildCodeIndex,
  buildScheduleIndex,
  classifyIfcType,
  decodeActId,
  matchAll,
  matchAllHybrid,
  normStorey,
  type Candidate,
  type CodeIndex,
  type MatchResult,
  type MatchSummary,
  type ScheduleTask,
} from "../../../lib/fourd/match";
import { policyMatch, type UnmatchedGroup } from "../../../lib/fourd/policy";
import type { ParsedElement, ParsedIfc } from "../../../lib/fourd/ifc";

interface Ready {
  parsed: ParsedIfc;
  ranges: Map<string, MatchResult>;
  minDate: number;
  maxDate: number;
  summary: MatchSummary;
  taskCount: number; // 공정표 총 활동 수
  codeCount: number; // 그 중 4D 코드 디코드 성공 수
  mode: "code" | "storey"; // 매칭 방식 (REV 공정PSet vs 층근사)
  codeIndex: CodeIndex | null; // 정책매칭 적용 시 활동키→날짜 조회용
  candidates: Candidate[]; // 정책매칭 후보 활동
  policyCount: number; // 정책(AI)으로 추가 매칭된 부재 수
  diag: {
    procCount: number; // 공정 PSet 보유 요소 수
    topVia: string; // byVia 상위 요약
  };
}

interface ReportData {
  total: number;
  matched: number;
  unmatched: number;
  activityTotal: number;
  noBim: { key: string; name: string }[]; // 공정 활동 있는데 BIM 부재 없음
  noSchedule: { label: string; count: number; sample: string }[]; // BIM 부재 있는데 공정 없음
  seqViolations: string[]; // 타임라인 순서 위반 (아래층>위층, 공종순서 등)
  clashes4d: string[]; // 4D Clash — 같은 공간(zone·층)에서 작업 기간 중첩
}

function Dropzone({
  label,
  accept,
  file,
  onFile,
}: {
  label: string;
  accept: string;
  file: File | null;
  onFile: (f: File) => void;
}) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      onClick={() => inputRef.current?.click()}
      style={{
        flex: 1,
        minHeight: 120,
        border: `2px dashed ${over ? "#60a5fa" : file ? "#10b981" : "#cbd5e1"}`,
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        cursor: "pointer",
        background: over ? "#eff6ff" : file ? "#f0fdf4" : "#f8fafc",
        padding: 16,
        textAlign: "center",
      }}
    >
      <strong>{label}</strong>
      <span style={{ fontSize: 13, color: "#64748b" }}>
        {file ? `✓ ${file.name}` : "드래그앤드롭 또는 클릭"}
      </span>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
    </div>
  );
}

export default function FourDPage() {
  const [scheduleFile, setScheduleFile] = useState<File | null>(null);
  const [ifcFile, setIfcFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ p: number; msg: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState<Ready | null>(null);

  const run = useCallback(async () => {
    if (!scheduleFile || !ifcFile) return;
    setBusy(true);
    setError(null);
    setReady(null);
    try {
      // 1) 공정표 → tasks
      //    .xer 는 브라우저에서 직접 파싱(백엔드가 4D 코드/target 날짜를 안 돌려줌).
      //    .xml(PMXML) 은 기존 백엔드 업로드 경로 유지.
      setProgress({ p: 0.05, msg: "공정표 파싱 중…" });
      let tasks: ScheduleTask[];
      if (/\.xer$/i.test(scheduleFile.name)) {
        const { parseXerTasks } = await import("../../../lib/fourd/xer");
        // XER 는 CP949(EUC-KR) — UTF-8 로 읽으면 한글 활동명이 깨진다(정책매칭 LLM 신호 손상).
        // 코드·날짜는 ASCII 라 EUC-KR 디코드해도 안전.
        const bytes = await scheduleFile.arrayBuffer();
        let text: string;
        try {
          text = new TextDecoder("euc-kr").decode(bytes);
        } catch {
          text = new TextDecoder().decode(bytes);
        }
        tasks = parseXerTasks(text);
      } else {
        const snap = await uploadSchedule(scheduleFile);
        const rawTasks = (snap.tasks ?? []) as unknown as Array<Record<string, unknown>>;
        tasks = rawTasks.map((t) => ({
          code: String(t.activity_code ?? t.code ?? t.id ?? ""),
          name: t.name as string | undefined,
          start: (t.start ?? t.baseline_start_date ?? null) as string | null,
          end: (t.end ?? t.baseline_finish_date ?? null) as string | null,
          progress: t.progress as number | undefined,
        }));
      }
      const codeCount = tasks.filter((t) => decodeActId(t.code)).length;
      if (codeCount === 0) {
        throw new Error(
          `공정표 ${tasks.length}건 중 4D 코드(502HG…)를 0건 찾았습니다. ` +
            `task_code 또는 UDF "Act ID_4D" 에 4D 코드가 있는 XER 인지 확인하세요.`,
        );
      }

      // 2) IFC 파싱 (브라우저 web-ifc, 동적 import — SSR 회피)
      const { parseIfc } = await import("../../../lib/fourd/ifc");
      const buf = await ifcFile.arrayBuffer();
      const parsed = await parseIfc(buf, (p, msg) => setProgress({ p, msg }));

      // 3) 매칭 — 공정 PSet(REV) 있으면 코드매칭(zone 정확), 없으면 층근사 폴백
      setProgress({ p: 1, msg: "매칭 중…" });
      const procCount = parsed.elements.filter((e) => e.trade).length;
      const useCode = procCount > 0; // 공정 PSet 있으면 hybrid(zone정확 + 층폴백)
      let ranges: Map<string, MatchResult>;
      let summary: MatchSummary;
      let minDate: number;
      let maxDate: number;
      const sidx = buildScheduleIndex(tasks);
      let codeIndex: CodeIndex | null = null;
      if (useCode) {
        codeIndex = buildCodeIndex(tasks);
        // 규칙은 "확정 매칭"만 — 실제 활동에 연결되는 것(유닛/단계/구역/층).
        // 활동이 없는 하드케이스(ZA/ZC 유닛불일치·PT구조·주차장)는 미매칭으로 두고
        // 온톨로지 grounding AI(정책 버튼)가 판단한다. (규칙이 추정으로 때우지 않음)
        ({ ranges, summary } = matchAllHybrid(parsed.elements, codeIndex, sidx));
        minDate = Math.min(codeIndex.minDate, sidx.minDate);
        maxDate = Math.max(codeIndex.maxDate, sidx.maxDate);
      } else {
        ({ ranges, summary } = matchAll(parsed.elements, sidx));
        minDate = sidx.minDate;
        maxDate = sidx.maxDate;
      }

      const topVia = Object.entries(summary.byVia)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([k, v]) => `${k}:${v}`)
        .join("  ");

      setReady({
        parsed,
        ranges,
        minDate,
        maxDate,
        summary,
        taskCount: tasks.length,
        codeCount,
        mode: useCode ? "code" : "storey",
        codeIndex,
        candidates: codeIndex ? buildCandidates(tasks) : [],
        policyCount: 0,
        diag: { procCount, topVia },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [scheduleFile, ifcFile]);

  // ── 정책기반 AI 매칭 — 규칙 미매칭 그룹을 gpt-5-mini 로 후보활동에 연결 ──
  const [policyBusy, setPolicyBusy] = useState(false);
  const [policyProg, setPolicyProg] = useState("");
  const runPolicy = useCallback(async () => {
    if (!ready || !ready.codeIndex) return;
    setPolicyBusy(true);
    setError(null);
    try {
      const KO_CAT: Record<string, string> = { CORE: "벽·기둥", FOOT: "기초", MOD: "슬래브·보·모듈" };
      const koStorey = (s: string | null) =>
        !s ? "?" : s === "PT" ? "기초(PT)" : s === "RF" ? "지붕(RF)" : `${Number(s)}층`;

      // 1) 미매칭 요소 그룹핑 (zone|storey|category|reason)
      const groups = new Map<
        string,
        { els: ParsedElement[]; types: Set<string>; storey: string | null; zone: string | null; cat: string; reason: string }
      >();
      for (const el of ready.parsed.elements) {
        if (ready.ranges.get(el.globalId)?.range) continue; // 이미 매칭됨
        const storey = el.storey4d ?? normStorey(el.storeyName);
        const cat = classifyIfcType(el.ifcType);
        const zone = el.zone ?? null;
        const reason = (ready.ranges.get(el.globalId)?.via ?? "").split(/[:@]/)[0];
        const gkey = `${reason}|${zone ?? "-"}|${storey ?? "-"}|${cat}`;
        let g = groups.get(gkey);
        if (!g) {
          g = { els: [], types: new Set(), storey, zone, cat, reason };
          groups.set(gkey, g);
        }
        g.els.push(el);
        g.types.add(el.ifcType);
      }
      if (groups.size === 0) {
        setPolicyBusy(false);
        return;
      }

      const unmatched: UnmatchedGroup[] = [...groups.entries()].map(([key, g]) => ({
        key,
        label: `${g.zone ? g.zone + " " : ""}${koStorey(g.storey)} ${KO_CAT[g.cat] ?? g.cat}`,
        count: g.els.length,
        ifc_types: [...g.types],
        storey: g.storey,
        zone: g.zone,
        reason: g.reason,
      }));

      // 2) LLM 정책매칭 — 그룹을 배치(루프)로 쪼개 호출 (응답 잘림 방지)
      const BATCH = 12;
      const assignments: Awaited<ReturnType<typeof policyMatch>> = [];
      const total = Math.ceil(unmatched.length / BATCH);
      for (let i = 0; i < unmatched.length; i += BATCH) {
        setPolicyProg(`${Math.floor(i / BATCH) + 1}/${total} 배치`);
        const slice = unmatched.slice(i, i + BATCH);
        const part = await policyMatch(slice, ready.candidates);
        assignments.push(...part);
      }
      setPolicyProg("");

      // 3) 적용 — activity_key 있고 confidence≥0.6 인 것만 (없으면 회색 유지)
      const newRanges = new Map(ready.ranges);
      let applied = 0;
      for (const a of assignments) {
        if (!a.activity_key || a.confidence < 0.6) continue;
        const range = ready.codeIndex.byKey.get(a.activity_key);
        const g = groups.get(a.group_key);
        if (!range || !g) continue;
        for (const el of g.els) {
          newRanges.set(el.globalId, { range, via: `policy|${a.activity_key}` });
          applied++;
        }
      }

      const byVia = { ...ready.summary.byVia, "정책(AI)": applied };
      setReady({
        ...ready,
        ranges: newRanges,
        summary: { ...ready.summary, matched: ready.summary.matched + applied, byVia },
        policyCount: applied,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPolicyBusy(false);
      setPolicyProg("");
    }
  }, [ready]);

  // ── 시뮬레이션 보고서 — 공정표↔BIM 양방향 정합성 진단 ──
  const [report, setReport] = useState<ReportData | null>(null);
  const buildReport = useCallback(() => {
    if (!ready) return;
    const { ranges, parsed, candidates } = ready;
    const KO_CAT: Record<string, string> = { CORE: "벽·기둥", FOOT: "기초", MOD: "슬래브·보·모듈" };
    const koStorey = (s: string | null) =>
      !s ? "?" : s === "PT" ? "기초(PT)" : s === "RF" ? "지붕(RF)" : `${Number(s)}층`;

    // via → 대표 활동키 (유닛/단계/정책 → coarse 후보키)
    const viaToActivity = (via: string | undefined): string | null => {
      if (!via) return null;
      if (via.startsWith("policy|")) return via.slice(7);
      const p = via.split("|");
      if (p[0] === "MO" && p.length >= 3) return `MO|${p[1]}|${p[2]}|MD`;
      if (p[0] === "ST" && p.length >= 4) return `ST|${p[1]}|${p[2]}|${p[3]}`;
      return null; // 층 폴백(MO@04) 등 — 특정 활동 아님
    };

    // ① BIM 있는데 공정 없음 (미매칭 부재)
    const noSched = new Map<string, { label: string; count: number; sample: string }>();
    let unmatched = 0;
    for (const el of parsed.elements) {
      if (ranges.get(el.globalId)?.range) continue;
      unmatched++;
      const s = el.storey4d ?? normStorey(el.storeyName);
      const cat = classifyIfcType(el.ifcType);
      const k = `${el.zone ?? "-"}|${s ?? "-"}|${cat}`;
      const g = noSched.get(k);
      if (g) g.count++;
      else
        noSched.set(k, {
          label: `${el.zone ? el.zone + " " : ""}${koStorey(s)} ${KO_CAT[cat] ?? cat}`,
          count: 1,
          sample: el.storeyName ?? "",
        });
    }

    // ② 공정 활동 있는데 BIM 없음 (매칭된 부재가 0인 후보 활동)
    const covered = new Set<string>();
    for (const el of parsed.elements) {
      const k = viaToActivity(ranges.get(el.globalId)?.via);
      if (k) covered.add(k);
    }
    const noBim = candidates.filter((c) => !covered.has(c.key)).map((c) => ({ key: c.key, name: c.name }));

    // ③ 타임라인 순서 검토 + ④ 4D Clash — codeIndex 날짜로 검증
    const FR = (s: string) => (s === "PT" ? 0 : s === "RF" ? 13 : parseInt(s, 10) || 0);
    const OPN: Record<string, string> = { FT: "기초", CR: "골조", MD: "모듈", PR: "파라펫" };
    const seqViolations: string[] = [];
    const clashes4d: string[] = [];
    const idx = ready.codeIndex;
    if (idx) {
      // 키 파싱: ST|zone|storey|wt, MO|zone|storey|MD → {zone,floor,op,start,end}
      const acts: { zone: string; floor: string; op: string; start: number; end: number }[] = [];
      for (const [k, r] of idx.byKey) {
        const p = k.split("|");
        acts.push({ zone: p[1], floor: p[2], op: p[0] === "MO" ? "MD" : p[3], start: r.start, end: r.end });
      }
      // 순서: (zone,op)별 층 오름차순 시작일 단조 검증
      const byZoneOp = new Map<string, typeof acts>();
      for (const a of acts) (byZoneOp.get(`${a.zone}|${a.op}`) ?? byZoneOp.set(`${a.zone}|${a.op}`, []).get(`${a.zone}|${a.op}`)!).push(a);
      for (const [zo, list] of byZoneOp) {
        const [zone, op] = zo.split("|");
        list.sort((a, b) => FR(a.floor) - FR(b.floor));
        for (let i = 1; i < list.length; i++) {
          if (list[i].start < list[i - 1].start - 86400000) {
            seqViolations.push(`${zone} ${OPN[op] ?? op}: ${list[i].floor}층이 ${list[i - 1].floor}층보다 먼저 시작 (순서 역전)`);
          }
        }
      }
      // 4D Clash: (zone,floor)에서 서로 다른 공종 작업기간 중첩
      const byZF = new Map<string, typeof acts>();
      for (const a of acts) (byZF.get(`${a.zone}|${a.floor}`) ?? byZF.set(`${a.zone}|${a.floor}`, []).get(`${a.zone}|${a.floor}`)!).push(a);
      for (const [zf, list] of byZF) {
        const [zone, floor] = zf.split("|");
        for (let i = 0; i < list.length; i++)
          for (let j = i + 1; j < list.length; j++) {
            const a = list[i], b = list[j];
            if (a.op !== b.op && a.start < b.end && b.start < a.end) {
              clashes4d.push(`${zone} ${floor}층: ${OPN[a.op] ?? a.op} ↔ ${OPN[b.op] ?? b.op} 작업기간 중첩`);
            }
          }
      }
    }

    setReport({
      total: parsed.elements.length,
      matched: parsed.elements.length - unmatched,
      unmatched,
      activityTotal: candidates.length,
      noBim,
      noSchedule: [...noSched.values()].sort((a, b) => b.count - a.count),
      seqViolations: seqViolations.slice(0, 30),
      clashes4d: [...new Set(clashes4d)].slice(0, 30),
    });
  }, [ready]);

  return (
    <div style={{ padding: 20, height: "100%", display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 20 }}>4D 시뮬레이션 (PoC)</h1>
        <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 13 }}>
          공정표(P6 XER/PMXML) + BIM(IFC)을 올리면 층·공종별로 매칭해 공정 진행을 4D로 색칠합니다.
        </p>
      </div>

      {!ready && (
        <>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <Dropzone label="① 공정표 (.xer / .xml)" accept=".xer,.xml" file={scheduleFile} onFile={setScheduleFile} />
            <Dropzone label="② BIM (.ifc)" accept=".ifc" file={ifcFile} onFile={setIfcFile} />
          </div>
          <button
            onClick={run}
            disabled={!scheduleFile || !ifcFile || busy}
            style={{
              padding: "12px 20px",
              borderRadius: 8,
              border: "none",
              background: !scheduleFile || !ifcFile || busy ? "#cbd5e1" : "#2563eb",
              color: "#fff",
              fontSize: 15,
              fontWeight: 600,
              cursor: !scheduleFile || !ifcFile || busy ? "default" : "pointer",
            }}
          >
            {busy ? "분석 중…" : "분석 & 4D 생성"}
          </button>
          {ifcFile && ifcFile.size > 40 * 1024 * 1024 && (
            <p style={{ color: "#d97706", fontSize: 13, margin: 0 }}>
              ⚠ IFC {Math.round(ifcFile.size / 1024 / 1024)}MB — 브라우저 파싱·공정속성 분석에{" "}
              {ifcFile.size > 80 * 1024 * 1024 ? "2~4분" : "1~2분"} + 메모리 소요. (REV 파일이 zone 정확 매칭됩니다)
            </p>
          )}
          {progress && (
            <div>
              <div style={{ height: 8, background: "#e2e8f0", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ width: `${Math.round(progress.p * 100)}%`, height: "100%", background: "#2563eb", transition: "width .3s" }} />
              </div>
              <p style={{ fontSize: 13, color: "#64748b", margin: "6px 0 0" }}>{progress.msg}</p>
            </div>
          )}
          {error && <p style={{ color: "#dc2626", fontSize: 13 }}>오류: {error}</p>}
        </>
      )}

      {ready && (
        <>
          <div style={{ fontSize: 13, color: "#475569" }}>
            {ready.mode === "code" ? "구역 정확 매칭(공정PSet)" : "층 근사 매칭"} ·{" "}
            공정 {ready.taskCount.toLocaleString()}건 ·{" "}
            요소 {ready.summary.total.toLocaleString()}개 중{" "}
            <strong style={{ color: "#10b981" }}>{ready.summary.matched.toLocaleString()}개 매칭</strong>{" "}
            ({Math.round((ready.summary.matched / Math.max(ready.summary.total, 1)) * 100)}%)
            <button
              onClick={() => {
                setReady(null);
                setScheduleFile(null);
                setIfcFile(null);
              }}
              style={{ marginLeft: 12, fontSize: 12, padding: "4px 10px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}
            >
              새로 분석
            </button>
          </div>
          {ready.codeIndex && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
              <button
                onClick={runPolicy}
                disabled={policyBusy}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: "none",
                  background: policyBusy ? "#cbd5e1" : "#7c3aed",
                  color: "#fff",
                  fontWeight: 600,
                  cursor: policyBusy ? "default" : "pointer",
                }}
              >
                {policyBusy ? `AI 분석 중… ${policyProg}` : "🤖 정책기반 AI 매칭 (미매칭 채우기)"}
              </button>
              {ready.policyCount > 0 && (
                <span style={{ color: "#7c3aed" }}>
                  +{ready.policyCount.toLocaleString()}개 정책 매칭 (해당 없는 건 회색 유지)
                </span>
              )}
              <button
                onClick={buildReport}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: "1px solid #0ea5e9",
                  background: "#0ea5e9",
                  color: "#fff",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                📋 시뮬레이션 보고서
              </button>
            </div>
          )}
          <details style={{ fontSize: 12, color: "#64748b" }}>
            <summary style={{ cursor: "pointer" }}>진단</summary>
            <div style={{ marginTop: 6, lineHeight: 1.7, fontFamily: "monospace" }}>
              <div>공정 PSet 보유 요소: {ready.diag.procCount.toLocaleString()} / {ready.summary.total.toLocaleString()}</div>
              <div>byVia: {ready.diag.topVia}</div>
            </div>
          </details>
          <div style={{ flex: 1, minHeight: 400 }}>
            <FourDViewer
              parsed={ready.parsed}
              ranges={ready.ranges}
              minDate={ready.minDate}
              maxDate={ready.maxDate}
              activities={
                ready.codeIndex
                  ? [...ready.codeIndex.byKey.entries()].map(([k, r]) => ({
                      name: ready.candidates.find((c) => c.key === k)?.name || k,
                      start: r.start,
                      end: r.end,
                    }))
                  : []
              }
            />
          </div>
        </>
      )}

      {report && <ReportModal report={report} onClose={() => setReport(null)} />}
    </div>
  );
}

function ReportModal({ report, onClose }: { report: ReportData; onClose: () => void }) {
  const rate = Math.round((report.matched / Math.max(report.total, 1)) * 100);
  const Section = ({ title, color, items, empty }: { title: string; color: string; items: string[]; empty: string }) => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontWeight: 700, color, marginBottom: 4 }}>
        {title} ({items.length})
      </div>
      {items.length === 0 ? (
        <div style={{ color: "#10b981", fontSize: 13 }}>✓ {empty}</div>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6, maxHeight: 160, overflow: "auto" }}>
          {items.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      )}
    </div>
  );
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: 12, padding: 24, maxWidth: 720, width: "100%", maxHeight: "85vh", overflow: "auto", boxShadow: "0 10px 40px rgba(0,0,0,0.3)" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>📋 4D 시뮬레이션 진단 보고서</h2>
          <button onClick={onClose} style={{ border: "none", background: "#f1f5f9", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>
            닫기
          </button>
        </div>
        <div style={{ fontSize: 13, color: "#475569", marginBottom: 16, padding: "8px 12px", background: "#f8fafc", borderRadius: 8 }}>
          요소 {report.total.toLocaleString()}개 중 <strong style={{ color: "#10b981" }}>{report.matched.toLocaleString()}개 매칭 ({rate}%)</strong> · 공정활동 {report.activityTotal}종 · 미매칭 {report.unmatched.toLocaleString()}개
        </div>

        <Section title="① BIM 있는데 공정 없음 (공정표 누락 의심)" color="#dc2626"
          empty="모든 부재가 공정에 연결됨"
          items={report.noSchedule.map((g) => `${g.label} — ${g.count.toLocaleString()}개${g.sample ? ` (예: ${g.sample})` : ""}`)} />

        <Section title="② 공정 있는데 BIM 없음 (모델 누락/미시공 의심)" color="#ea580c"
          empty="모든 공정활동에 BIM 부재 연결됨"
          items={report.noBim.map((a) => `${a.name} [${a.key}]`)} />

        <Section title="③ 타임라인 순서 위반 (아래→위, 공종 순서)" color="#d97706"
          empty="공정 순서 정합 — 층·공종 순서 정상"
          items={report.seqViolations} />

        <Section title="④ 4D Clash (같은 공간·동시 작업 중첩)" color="#7c3aed"
          empty="동일 공간 작업기간 중첩 없음"
          items={report.clashes4d} />

        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 8, borderTop: "1px solid #e2e8f0", paddingTop: 8 }}>
          ※ 3D Clash(형상 겹침)는 형상 간섭 계산이 필요해 별도 — 추후 추가. 본 보고서는 공정표↔BIM 정합·시간축 기준.
        </div>
      </div>
    </div>
  );
}
