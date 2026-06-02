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
  buildCodeIndex,
  buildScheduleIndex,
  decodeActId,
  matchAll,
  matchAllHybrid,
  type MatchResult,
  type MatchSummary,
  type ScheduleTask,
} from "../../../lib/fourd/match";
import type { ParsedIfc } from "../../../lib/fourd/ifc";

interface Ready {
  parsed: ParsedIfc;
  ranges: Map<string, MatchResult>;
  minDate: number;
  maxDate: number;
  summary: MatchSummary;
  taskCount: number; // 공정표 총 활동 수
  codeCount: number; // 그 중 4D 코드 디코드 성공 수
  mode: "code" | "storey"; // 매칭 방식 (REV 공정PSet vs 층근사)
  diag: {
    procCount: number; // 공정 PSet 보유 요소 수
    topVia: string; // byVia 상위 요약
  };
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
        tasks = parseXerTasks(await scheduleFile.text());
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
      if (useCode) {
        const cidx = buildCodeIndex(tasks);
        ({ ranges, summary } = matchAllHybrid(parsed.elements, cidx, sidx));
        minDate = Math.min(cidx.minDate, sidx.minDate);
        maxDate = Math.max(cidx.maxDate, sidx.maxDate);
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
        diag: { procCount, topVia },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [scheduleFile, ifcFile]);

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
          <details style={{ fontSize: 12, color: "#64748b" }}>
            <summary style={{ cursor: "pointer" }}>진단</summary>
            <div style={{ marginTop: 6, lineHeight: 1.7, fontFamily: "monospace" }}>
              <div>공정 PSet 보유 요소: {ready.diag.procCount.toLocaleString()} / {ready.summary.total.toLocaleString()}</div>
              <div>byVia: {ready.diag.topVia}</div>
            </div>
          </details>
          <div style={{ flex: 1, minHeight: 400 }}>
            <FourDViewer parsed={ready.parsed} ranges={ready.ranges} minDate={ready.minDate} maxDate={ready.maxDate} />
          </div>
        </>
      )}
    </div>
  );
}
