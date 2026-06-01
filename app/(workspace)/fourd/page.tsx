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
  buildScheduleIndex,
  matchAll,
  type MatchResult,
  type MatchSummary,
  type ScheduleIndex,
  type ScheduleTask,
} from "../../../lib/fourd/match";
import type { ParsedIfc } from "../../../lib/fourd/ifc";

interface Ready {
  parsed: ParsedIfc;
  ranges: Map<string, MatchResult>;
  index: ScheduleIndex;
  summary: MatchSummary;
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
      // 1) 공정표 업로드 → tasks
      setProgress({ p: 0.05, msg: "공정표 파싱 중…" });
      const snap = await uploadSchedule(scheduleFile);
      const rawTasks = (snap.tasks ?? []) as unknown as Array<Record<string, unknown>>;
      const tasks: ScheduleTask[] = rawTasks.map((t) => ({
        code: String(t.activity_code ?? t.code ?? t.id ?? ""),
        name: t.name as string | undefined,
        start: (t.start ?? t.baseline_start_date ?? null) as string | null,
        end: (t.end ?? t.baseline_finish_date ?? null) as string | null,
        progress: t.progress as number | undefined,
      }));
      const index = buildScheduleIndex(tasks);

      // 2) IFC 파싱 (브라우저 web-ifc, 동적 import — SSR 회피)
      const { parseIfc } = await import("../../../lib/fourd/ifc");
      const buf = await ifcFile.arrayBuffer();
      const parsed = await parseIfc(buf, (p, msg) => setProgress({ p, msg }));

      // 3) 매칭
      setProgress({ p: 1, msg: "매칭 중…" });
      const { ranges, summary } = matchAll(parsed.elements, index);

      setReady({ parsed, ranges, index, summary });
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
              ⚠ IFC {Math.round(ifcFile.size / 1024 / 1024)}MB — 브라우저 파싱에 1~2분 + 메모리 다소 소요됩니다.
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
          <div style={{ flex: 1, minHeight: 400 }}>
            <FourDViewer parsed={ready.parsed} ranges={ready.ranges} index={ready.index} />
          </div>
        </>
      )}
    </div>
  );
}
