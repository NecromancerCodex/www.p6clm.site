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
import { ScheduleFormView } from "../../../components/documents/DocumentFormViews";
import { analyzeSchedule, uploadSchedule, type ScheduleReportDoc } from "../../../lib/api/schedule";
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
import { buildSchedOpStorey, classifyUnmatched, CAUSE_ORDER, classifyNoBim, NOBIM_ORDER, type Cause } from "../../../lib/fourd/diagnose";
import { deriveWorkPackages, deriveActivityUnits, type DerivedPackage, type ActivityUnit } from "../../../lib/fourd/workpackage";
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
  tasks: ScheduleTask[]; // 워크패키지 재도출용 (정책매칭 후 갱신)
  sessionId: string; // 분석 run id (Neon 저장 키)
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
  // 공정 활동 있는데 BIM 부재 없음 — 원인(A 재연결가능 / B 모델누락 / C 보류)별 그룹
  noBim: {
    cause: string;
    title: string;
    color: string;
    explain: string;
    recommend: string;
    total: number;
    items: string[];
  }[];
  // BIM 부재 있는데 공정 없음 — 원인(C1~C4)별 그룹 + 설명·추천
  noSchedule: {
    cause: string;
    title: string;
    color: string;
    explain: string;
    recommend: string;
    total: number;
    items: { label: string; count: number }[];
  }[];
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
        tasks,
        sessionId:
          typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `run-${tasks.length}`,
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

  // ── 워크패키지 — BIM 메타(호·타입·부재종류)로 세분, Neon 영속화 ──
  const [wpOpen, setWpOpen] = useState(false);

  // ── 공사일보 — 타임라인 슬라이더 '해당일' 기준, 기존 schedule/analyze 재사용 ──
  const [dailyBusy, setDailyBusy] = useState(false);
  const [dailyDoc, setDailyDoc] = useState<ScheduleReportDoc | null>(null);
  const [dailyErr, setDailyErr] = useState<string | null>(null);
  const runDaily = useCallback(
    async (dateMs: number) => {
      if (!scheduleFile) return;
      // 로컬 날짜 그대로 YYYY-MM-DD (UTC 변환 시 하루 밀림 방지)
      const d = new Date(dateMs);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      setDailyBusy(true);
      setDailyErr(null);
      try {
        const res = await analyzeSchedule(scheduleFile, "proc_daily", undefined, iso);
        if (!res.document) throw new Error("보고서 본문이 비어 있습니다.");
        setDailyDoc(res.document);
      } catch (e) {
        setDailyErr(e instanceof Error ? e.message : "공사일보 생성 실패");
      } finally {
        setDailyBusy(false);
      }
    },
    [scheduleFile],
  );
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

    // ① BIM 있는데 공정 없음 (미매칭 부재) → 원인 규칙분류(C1~C4)로 그룹핑 + 설명·추천
    const schedOpStorey = buildSchedOpStorey(candidates.map((c) => c.key));
    const noSched = new Map<string, { label: string; count: number; sample: string; via?: string; zone?: string }>();
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
          via: ranges.get(el.globalId)?.via,
          zone: el.zone,
        });
    }
    // 원인별 묶기 (대표 via/zone 으로 규칙 분류)
    const causeMap = new Map<Cause, { title: string; color: string; explain: string; recommend: string; total: number; items: { label: string; count: number }[] }>();
    for (const g of noSched.values()) {
      const meta = classifyUnmatched(g.via, g.zone, schedOpStorey);
      let cg = causeMap.get(meta.cause);
      if (!cg) {
        cg = { title: meta.title, color: meta.color, explain: meta.explain, recommend: meta.recommend, total: 0, items: [] };
        causeMap.set(meta.cause, cg);
      }
      cg.total += g.count;
      cg.items.push({ label: `${g.label}${g.sample ? ` (예: ${g.sample})` : ""}`, count: g.count });
    }
    const noSchedule = CAUSE_ORDER.filter((c) => causeMap.has(c)).map((c) => {
      const cg = causeMap.get(c)!;
      return { cause: c, ...cg, items: cg.items.sort((a, b) => b.count - a.count) };
    });

    // ② 공정 활동 있는데 BIM 없음 (매칭된 부재가 0인 후보 활동) → 원인 A/B/C 분류
    const covered = new Set<string>();
    for (const el of parsed.elements) {
      const k = viaToActivity(ranges.get(el.globalId)?.via);
      if (k) covered.add(k);
    }
    // BIM 부재의 (공종|층) 존재 인덱스 — A(구역만 불일치) vs B(아예 없음) 판별용
    const OP_OF_CAT: Record<string, string> = { CORE: "CR", MOD: "MD", FOOT: "FT" };
    const bimPresence = new Set<string>();
    const bimZonesAt = new Map<string, Set<string>>();
    for (const el of parsed.elements) {
      const op = OP_OF_CAT[classifyIfcType(el.ifcType)];
      const st = el.storey4d ?? normStorey(el.storeyName);
      if (!op || !st) continue;
      const bk = `${op}|${st}`;
      bimPresence.add(bk);
      if (el.zone) {
        let s = bimZonesAt.get(bk);
        if (!s) {
          s = new Set();
          bimZonesAt.set(bk, s);
        }
        s.add(el.zone);
      }
    }
    const noBimMap = new Map<string, { title: string; color: string; explain: string; recommend: string; total: number; items: string[] }>();
    for (const c of candidates) {
      if (covered.has(c.key)) continue;
      const meta = classifyNoBim(c.key, bimPresence, bimZonesAt);
      let cg = noBimMap.get(meta.cause);
      if (!cg) {
        cg = { title: meta.title, color: meta.color, explain: meta.explain, recommend: meta.recommend, total: 0, items: [] };
        noBimMap.set(meta.cause, cg);
      }
      cg.total++;
      cg.items.push(`${c.name} [${c.key}]`);
    }
    const noBim = NOBIM_ORDER.filter((c) => noBimMap.has(c)).map((c) => ({ cause: c, ...noBimMap.get(c)! }));

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
      noSchedule,
      seqViolations: seqViolations.slice(0, 30),
      clashes4d: [...new Set(clashes4d)].slice(0, 30),
    });
  }, [ready]);

  return (
    <div style={{ padding: 20, height: "100%", display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 20 }}>대시보드</h1>
        <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 13 }}>
          공정표(P6)와 BIM(IFC)을 올리면 공정 진행 상황을 시각화하고, 해당일 공사일보를 생성합니다.
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
              <button
                onClick={() => setWpOpen(true)}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: "1px solid #7c3aed",
                  background: "#7c3aed",
                  color: "#fff",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                🧩 워크패키지
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
              codeToName={new Map(ready.tasks.map((t) => [t.code, t.name ?? t.code]))}
              onGenerateDaily={scheduleFile ? runDaily : undefined}
              dailyBusy={dailyBusy}
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

      {dailyErr && (
        <div
          style={{ position: "fixed", bottom: 16, right: 16, zIndex: 60, background: "#fee2e2", color: "#991b1b", padding: "10px 14px", borderRadius: 8, fontSize: 13, boxShadow: "0 4px 12px rgba(0,0,0,.15)" }}
          onClick={() => setDailyErr(null)}
        >
          ⚠ 공사일보 생성 실패: {dailyErr} (클릭하여 닫기)
        </div>
      )}
      {dailyDoc && <DailyReportModal doc={dailyDoc} onClose={() => setDailyDoc(null)} />}
      {report && <ReportModal report={report} onClose={() => setReport(null)} />}
      {wpOpen && ready && (
        <WorkPackageModal
          sessionId={ready.sessionId}
          packages={deriveWorkPackages(ready.tasks, ready.parsed.elements, ready.ranges)}
          activities={deriveActivityUnits(ready.tasks, ready.parsed.elements, ready.ranges)}
          onClose={() => setWpOpen(false)}
        />
      )}
    </div>
  );
}

/** 타임라인 '해당일' 공사일보 — 기존 ScheduleFormView 그대로 렌더 (수치표 결정적 + AI 서술). */
function DailyReportModal({ doc, onClose }: { doc: ScheduleReportDoc; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 24, overflow: "auto" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: 12, padding: 20, maxWidth: 880, width: "100%", boxShadow: "0 10px 40px rgba(0,0,0,0.3)" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>
            📄 공사일보 — {doc.reference_date}
          </h2>
          <button onClick={onClose} style={{ border: "none", background: "#f1f5f9", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>
            닫기
          </button>
        </div>
        <ScheduleFormView doc={doc} showPipeline={false} />
      </div>
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

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, color: "#dc2626", marginBottom: 6 }}>
            ① BIM 있는데 공정 없음 — 원인별 분석 ({report.unmatched.toLocaleString()})
          </div>
          {report.noSchedule.length === 0 ? (
            <div style={{ color: "#10b981", fontSize: 13 }}>✓ 모든 부재가 공정에 연결됨</div>
          ) : (
            report.noSchedule.map((cg) => (
              <div key={cg.cause} style={{ borderLeft: `3px solid ${cg.color}`, paddingLeft: 10, marginBottom: 10 }}>
                <div style={{ fontWeight: 600, color: cg.color, fontSize: 13 }}>
                  [{cg.cause}] {cg.title} — {cg.total.toLocaleString()}개
                </div>
                <div style={{ fontSize: 12, color: "#475569", margin: "2px 0" }}>· 왜: {cg.explain}</div>
                <div style={{ fontSize: 12, color: "#0f766e", margin: "2px 0" }}>· 권장: {cg.recommend}</div>
                <ul style={{ margin: "4px 0 0", paddingLeft: 16, fontSize: 12, lineHeight: 1.5, color: "#64748b", maxHeight: 90, overflow: "auto" }}>
                  {cg.items.map((it, i) => (
                    <li key={i}>
                      {it.label} — {it.count.toLocaleString()}개
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, color: "#ea580c", marginBottom: 6 }}>
            ② 공정 있는데 BIM 없음 — 원인별 분석 ({report.noBim.reduce((s, g) => s + g.total, 0).toLocaleString()})
          </div>
          {report.noBim.length === 0 ? (
            <div style={{ color: "#10b981", fontSize: 13 }}>✓ 모든 공정활동에 BIM 부재 연결됨</div>
          ) : (
            report.noBim.map((cg) => (
              <div key={cg.cause} style={{ borderLeft: `3px solid ${cg.color}`, paddingLeft: 10, marginBottom: 10 }}>
                <div style={{ fontWeight: 600, color: cg.color, fontSize: 13 }}>
                  [{cg.cause}] {cg.title} — {cg.total.toLocaleString()}건
                </div>
                <div style={{ fontSize: 12, color: "#475569", margin: "2px 0" }}>· 왜: {cg.explain}</div>
                <div style={{ fontSize: 12, color: "#0f766e", margin: "2px 0" }}>· 권장: {cg.recommend}</div>
                <ul style={{ margin: "4px 0 0", paddingLeft: 16, fontSize: 12, lineHeight: 1.5, color: "#64748b", maxHeight: 90, overflow: "auto" }}>
                  {cg.items.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>

        <Section title="③ 타임라인 순서 위반 (아래→위, 공종 순서)" color="#d97706"
          empty="공정 순서 정합 — 층·공종 순서 정상"
          items={report.seqViolations} />
        {report.seqViolations.length > 0 && (
          <div style={{ fontSize: 11, color: "#94a3b8", margin: "-8px 0 16px" }}>
            · 왜: 같은 구역·공종에서 위층이 아래층보다 먼저 시작하면 통상 시공순서(아래→위)에 어긋납니다.<br />
            · 권장: 병렬시공/조닝 의도면 정상입니다. 아니라면 선후행(TASKPRED) 연결을 재검토하세요.
          </div>
        )}

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

function wpLabel(p: DerivedPackage): string {
  if (p.trade === "MO") {
    return `${p.zone ?? "?"} ${p.storey ?? "?"}층 ${p.module_unit ?? "?"}호${p.mtype ? ` ${p.mtype}타입` : ""}`;
  }
  return `${p.zone ?? "?"} ${p.storey ?? "?"}층 ${p.worktype ?? "?"}`;
}

function WorkPackageModal({
  sessionId,
  packages,
  activities,
  onClose,
}: {
  sessionId: string;
  packages: DerivedPackage[];
  activities: ActivityUnit[];
  onClose: () => void;
}) {
  const [saving, setSaving] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [view, setView] = useState<"bim" | "activity">("bim");
  const [expanded, setExpanded] = useState<number | null>(null);
  const totalRule = packages.reduce((s, p) => s + p.bim_count_rule, 0);
  const totalAi = packages.reduce((s, p) => s + p.bim_count_ai, 0);
  const totalStorey = packages.reduce((s, p) => s + p.bim_count_storey, 0);
  const actLinked = activities.filter((a) => a.status === "연결완료").length;

  const save = async () => {
    setSaving("saving");
    try {
      const res = await fetch("/api/clm/fourd/work-packages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, packages }),
      });
      setSaving(res.ok ? "done" : "error");
    } catch {
      setSaving("error");
    }
  };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: 12, padding: 24, maxWidth: 760, width: "100%", maxHeight: "85vh", overflow: "auto", boxShadow: "0 10px 40px rgba(0,0,0,0.3)" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>🧩 워크패키지 (BIM 물리단위 · 모듈·악세사리별)</h2>
          <button onClick={onClose} style={{ border: "none", background: "#f1f5f9", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>
            닫기
          </button>
        </div>
        <div style={{ fontSize: 13, color: "#475569", marginBottom: 12, padding: "8px 12px", background: "#f8fafc", borderRadius: 8 }}>
          패키지 <strong>{packages.length.toLocaleString()}</strong>개 · 부재 매칭 출처{" "}
          <span style={{ color: "#0d9488" }}>규칙 {totalRule.toLocaleString()}</span> +{" "}
          <span style={{ color: "#7c3aed" }}>AI {totalAi.toLocaleString()}</span> +{" "}
          <span style={{ color: "#64748b" }}>층근사 {totalStorey.toLocaleString()}</span>
          <span style={{ marginLeft: 8, fontSize: 11, color: "#94a3b8" }}>(pmisx 정밀 + AI 보강)</span>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button
            onClick={save}
            disabled={saving === "saving" || saving === "done"}
            style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: saving === "done" ? "#10b981" : "#7c3aed", color: "#fff", fontWeight: 600, cursor: saving === "saving" ? "default" : "pointer" }}
          >
            {saving === "idle" && "💾 Neon에 저장"}
            {saving === "saving" && "저장 중…"}
            {saving === "done" && "✓ 저장됨"}
            {saving === "error" && "⚠ 저장 실패 — 재시도"}
          </button>
          <span style={{ fontSize: 11, color: "#94a3b8", alignSelf: "center" }}>
            저장 시 이전 분석은 대체됩니다 (최신만 유지) · {sessionId.slice(0, 8)}
          </span>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 10, borderBottom: "1px solid #e2e8f0" }}>
          {([["bim", `🧩 BIM 패키지 (${packages.length})`], ["activity", `📋 공정 활동 (${activities.length}) · 연결 ${actLinked}/${activities.length}`]] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{ padding: "6px 12px", border: "none", borderBottom: view === v ? "2px solid #7c3aed" : "2px solid transparent", background: "transparent", color: view === v ? "#7c3aed" : "#64748b", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
            >
              {label}
            </button>
          ))}
        </div>

        {view === "bim" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {packages.slice(0, 400).map((p) => (
              <div key={p.key} style={{ borderLeft: `3px solid ${p.bim_count_ai > 0 ? "#7c3aed" : "#0d9488"}`, paddingLeft: 10, paddingBottom: 4 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>
                  {wpLabel(p)}{" "}
                  <span style={{ fontSize: 11, color: "#64748b", fontWeight: 400 }}>
                    부재 {(p.bim_count_rule + p.bim_count_ai + p.bim_count_storey).toLocaleString()}
                    {p.bim_count_ai > 0 && <span style={{ color: "#7c3aed" }}> (AI {p.bim_count_ai})</span>}
                    {p.bim_count_storey > 0 && <span style={{ color: "#94a3b8" }}> (층근사 {p.bim_count_storey})</span>}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "#475569", margin: "1px 0" }}>
                  악세사리: {p.accessories.map((a) => `${a.type} ${a.count}`).join(" · ") || "—"}
                </div>
                <div style={{ fontSize: 11, color: "#64748b" }}>
                  공정활동: {p.units.length === 0 ? "(연결 없음)" : p.units.map((u) => `${u.name ?? u.activity_code}${u.phase ? `[${u.phase}]` : ""}`).slice(0, 4).join(", ")}
                  {p.units.length > 4 && ` 외 ${p.units.length - 4}`}
                  {p.start && <span style={{ marginLeft: 6, color: "#94a3b8" }}>{p.start}~{p.end}</span>}
                </div>
              </div>
            ))}
            {packages.length > 400 && (
              <div style={{ fontSize: 11, color: "#94a3b8" }}>… 외 {(packages.length - 400).toLocaleString()}개 (저장은 전체 포함)</div>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>
              모든 공정 활동을 BIM 연결 상태로 (PT 포함). pmisx 스타일 — 활동마다 WS시그니처 + 매칭 부재 + 상태.
            </div>
            {activities.map((a, i) => (
              <div key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                <div
                  onClick={() => setExpanded(expanded === i ? null : i)}
                  style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12, padding: "3px 0", cursor: "pointer" }}
                >
                  <span style={{ width: 14 }}>{a.status === "연결완료" ? "✅" : "✗"}</span>
                  <span style={{ width: 10, color: "#cbd5e1" }}>{expanded === i ? "▾" : "▸"}</span>
                  <span style={{ flex: 1, color: "#334155" }}>{a.name}</span>
                  <span style={{ width: 110, color: "#94a3b8", fontFamily: "monospace", fontSize: 11 }}>{a.ws}</span>
                  <span style={{ width: 70, textAlign: "right", color: a.matched > 0 ? "#0d9488" : "#dc2626", fontWeight: 600 }}>
                    {a.matched > 0 ? `${a.matched}개${a.ai > 0 ? `(AI${a.ai})` : ""}` : a.reason}
                  </span>
                </div>
                {expanded === i && (
                  <div style={{ background: "#f8fafc", borderRadius: 6, padding: "8px 12px", margin: "2px 0 6px 24px", fontSize: 12, lineHeight: 1.7, color: "#475569" }}>
                    <div style={{ fontWeight: 600, color: "#7c3aed", marginBottom: 2 }}>
                      근거 (공정표·BIM 실측 — 지어내지 않음)
                    </div>
                    <div>· BIM 객체 수: {a.matched.toLocaleString()}개{a.ai > 0 && ` (규칙 ${a.rule} + AI ${a.ai})`}</div>
                    <div>· 공정표 기간: {a.durationDays > 0 ? `${a.durationDays}일` : "—"}{a.start && ` (${a.start} ~ ${a.end})`}</div>
                    <div>
                      · 함의 생산성:{" "}
                      {a.impliedRate != null ? (
                        <strong>{a.impliedRate}개/일 ({a.matched} ÷ {a.durationDays}, 역산)</strong>
                      ) : (
                        "— (매칭/기간 없음)"
                      )}
                    </div>
                    <div>· 선행: {a.preds.length ? a.preds.slice(0, 5).join(", ") + (a.preds.length > 5 ? ` 외 ${a.preds.length - 5}` : "") : "—"}</div>
                    <div>· 후행: {a.succs.length ? a.succs.slice(0, 5).join(", ") + (a.succs.length > 5 ? ` 외 ${a.succs.length - 5}` : "") : "—"}</div>
                    {a.status === "미연결" && <div style={{ color: "#dc2626" }}>· 미연결 사유: {a.reason}</div>}
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3 }}>
                      ※ 생산성 &quot;기준&quot;(품셈)은 미보유 — 위 생산성은 공정표 기간에서 역산한 값입니다.
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
