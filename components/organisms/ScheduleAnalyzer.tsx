"use client";

import { CalendarRange, FileUp, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { ScheduleFormView } from "../documents/DocumentFormViews";
import {
  analyzeSchedule,
  ScheduleApiError,
  SCHEDULE_DOC_LABELS,
  type ScheduleAnalyzeResult,
  type ScheduleDocType,
} from "../../lib/api/schedule";

const DOC_TYPES: { id: ScheduleDocType; label: string; desc: string }[] = [
  { id: "proc_daily", label: "공사일보", desc: "금일 공정·익일 예정" },
  { id: "proc_weekly", label: "주간 공정현황 보고", desc: "금주 진도·차주 계획" },
  { id: "proc_monthly", label: "월간 공정현황 보고", desc: "월 진도·마일스톤·만회" },
  { id: "proc_supervision", label: "감리 보고서", desc: "감리 관점 적정성·지적" },
];

export function ScheduleAnalyzer() {
  const [docType, setDocType] = useState<ScheduleDocType>("proc_weekly");
  const [projectName, setProjectName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScheduleAnalyzeResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const onPick = useCallback((f: File | null) => {
    setError(null);
    if (f && !/\.(xml|xer)$/i.test(f.name)) {
      setError("Primavera P6 공정표(.xml 또는 .xer) 파일만 업로드할 수 있습니다.");
      return;
    }
    setFile(f);
  }, []);

  const onSubmit = useCallback(async () => {
    if (!file) {
      setError("XML 파일을 선택하세요.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await analyzeSchedule(file, docType, projectName);
      setResult(res);
    } catch (e) {
      const msg = e instanceof ScheduleApiError ? e.detail : String(e);
      setError(`분석 실패: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [file, docType, projectName]);

  const m = result?.metrics;

  return (
    <div className="ws-inner-pad">
      <div className="ws-section-title">
        <CalendarRange size={18} strokeWidth={1.8} />
        공정관리 — Primavera P6 공정표 분석
      </div>
      <p className="ws-section-desc">
        P6 Professional에서 <code>Export(XER 또는 PMXML)</code>로 내보낸 공정표를 업로드하면,
        진도·주공정선(임계공정)·지연을 분석해 공정 보고서를 자동 생성합니다. 생성 결과는{" "}
        <Link href="/progress">문서저장소 → 공정관리</Link> 탭에도 저장됩니다.
      </p>

      {/* 입력 카드 */}
      <div className="sch-card">
        <div className="sch-field">
          <label className="sch-label">보고서 종류</label>
          <div className="sch-doctype-grid">
            {DOC_TYPES.map((d) => (
              <button
                key={d.id}
                type="button"
                className={`sch-doctype${docType === d.id ? " active" : ""}`}
                onClick={() => setDocType(d.id)}
                aria-pressed={docType === d.id}
              >
                <strong>{d.label}</strong>
                <span>{d.desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="sch-field">
          <label className="sch-label" htmlFor="sch-proj">
            프로젝트명 <span className="sch-optional">(선택 — 비우면 XML의 프로젝트명 사용)</span>
          </label>
          <input
            id="sch-proj"
            className="sch-input"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="예: ○○ 신축공사"
          />
        </div>

        <div className="sch-field">
          <label className="sch-label">공정표 파일 (XER / PMXML)</label>
          <button
            type="button"
            className="sch-dropzone"
            onClick={() => inputRef.current?.click()}
          >
            <FileUp size={20} strokeWidth={1.8} />
            <span>{file ? file.name : "클릭하여 .xml / .xer 파일 선택"}</span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".xml,.xer,text/xml,application/xml"
            hidden
            onChange={(e) => onPick(e.target.files?.[0] ?? null)}
          />
        </div>

        {error && (
          <div className="sch-error">
            <AlertTriangle size={15} /> {error}
          </div>
        )}

        <button
          type="button"
          className="sch-submit"
          onClick={onSubmit}
          disabled={loading || !file}
        >
          {loading ? (
            <>
              <Loader2 size={16} className="sch-spin" /> 분석 중...
            </>
          ) : (
            <>{SCHEDULE_DOC_LABELS[docType]} 생성</>
          )}
        </button>
      </div>

      {/* 결과 */}
      {result && (
        <div className="sch-result">
          <div className="sch-result-head">
            {result.alert_required ? (
              <span className="sch-badge warn">
                <AlertTriangle size={14} /> 주의 — 지연/임계공정 영향
              </span>
            ) : (
              <span className="sch-badge ok">
                <CheckCircle2 size={14} /> 정상 추세
              </span>
            )}
            <span className="sch-result-title">{result.doc_label}</span>
          </div>

          {m && (
            <div className="sch-metrics">
              <Metric label="실제 진도" value={`${m.overall_percent ?? "-"}%`} />
              <Metric label="계획 진도" value={`${m.planned_percent ?? "-"}%`} />
              <Metric
                label="편차"
                value={`${(m.schedule_variance ?? 0) > 0 ? "+" : ""}${m.schedule_variance ?? "-"}%p`}
                warn={(m.schedule_variance ?? 0) < 0}
              />
              <Metric label="활동" value={`${m.activity_count ?? "-"}개`} />
              <Metric label="임계공정" value={`${m.critical_count ?? "-"}개`} />
              <Metric label="지연" value={`${m.delayed_count ?? "-"}개`} warn={(m.delayed_count ?? 0) > 0} />
            </div>
          )}

          {result.document ? (
            <ScheduleFormView
              doc={result.document}
              stepsLog={result.steps_taken}
              showPipeline={false}
            />
          ) : (
            <div className="sch-report a4">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {result.report_markdown ?? "_(보고서 내용 없음)_"}
              </ReactMarkdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`sch-metric${warn ? " warn" : ""}`}>
      <span className="sch-metric-val">{value}</span>
      <span className="sch-metric-label">{label}</span>
    </div>
  );
}
