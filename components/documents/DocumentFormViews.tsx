"use client";

import { Fragment, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  NCRDocument,
  SafetyInspectionDocument,
  QualityInspectionDoc,
  MaterialInspectionDoc,
  CARDoc,
  DerivedNCRDoc,
} from "../../stores/doc/types";
import type { ScheduleReportDoc } from "../../lib/api/schedule";

/* ── 번호 목록 텍스트 렌더러 ──────────────────────────────────── */

export function NumberedText({ text }: { text: string }) {
  if (!text) return null;
  const lines = text
    .split(/(?=\d+\)\s|[*\-]\s)/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (lines.length <= 1) {
    return <span style={{ whiteSpace: "pre-wrap" }}>{text}</span>;
  }
  return (
    <ol className="ncr-numbered-list">
      {lines.map((line, i) => (
        <li key={i}>{line.replace(/^\d+\)\s*/, "").replace(/^[*\-]\s*/, "")}</li>
      ))}
    </ol>
  );
}

/* ── NCR 폼 뷰 (문서 작성 / 진행도 공통) ─────────────────────── */

export function NcrFormView({
  ncr,
  stepsLog = [],
  onReset,
  projectName = "현장 미지정",
  showPipeline = true,
}: {
  ncr: NCRDocument;
  stepsLog?: string[];
  onReset?: () => void;
  projectName?: string;
  showPipeline?: boolean;
}) {
  const DISPOSITION_ALL = ["재작업", "폐기", "사용승인", "반품", "기타"] as const;

  async function copyAsText() {
    const text = `Non-Conformance Report (NCR)\nPROJECT: ${projectName}\n\n문서번호: ${ncr.document_number}   발생자: ${ncr.reporter}   발생일자: ${ncr.report_date}\n제목: ${ncr.title}\n작성자: ${ncr.author}   조치부서: ${ncr.action_department}\n발생위치: ${ncr.location}   업체: ${ncr.company}\nNC 유형: ${ncr.nc_type}   첨부: ${ncr.attachment}\n조치담당자: ${ncr.action_manager}\n\n[요구사항/기준]\n${ncr.specification}\n\n[부적합 내용]\n${ncr.description}\n\n[즉각 조치사항]\n${ncr.immediate_action}\n\n[처분] ${ncr.disposition.join(", ")}\n조치 책임자: ${ncr.action_responsible}   조치기한: ${ncr.action_deadline}\n\n[검증]\n${ncr.verification}\n\n종료일: ${ncr.completion_date}   비고: ${ncr.notes}`.trim();
    await navigator.clipboard.writeText(text);
  }

  return (
    <div className="ncr-wrapper">
      <div className="ncr-top-bar">
        {showPipeline && stepsLog.length > 0 ? (
          <div className="dag-steps-log">
            {stepsLog.map((s, i) => (
              <span key={i} className="dag-step-badge">
                ✓ {s}
              </span>
            ))}
          </div>
        ) : (
          <div className="dag-steps-log" />
        )}
        <div className="ncr-actions">
          <button type="button" className="dag-copy-btn" onClick={copyAsText}>
            텍스트 복사
          </button>
          <button type="button" className="dag-copy-btn" onClick={() => window.print()}>
            🖨️ 인쇄
          </button>
          {onReset ? (
            <button type="button" className="dag-reset-btn" onClick={onReset}>
              다시 선택
            </button>
          ) : null}
        </div>
      </div>
      <div className="ncr-form">
        <div className="ncr-title-row">Non-Conformance Report (NCR)</div>
        <div className="ncr-project-row">
          <span className="ncr-label">PROJECT</span>
          <span className="ncr-value ncr-project-name">{projectName}</span>
        </div>
        <div className="ncr-header-grid">
          <div className="ncr-cell">
            <span className="ncr-label">문서번호</span>
            <span className="ncr-value">{ncr.document_number}</span>
          </div>
          <div className="ncr-cell">
            <span className="ncr-label">발생자</span>
            <span className="ncr-value">{ncr.reporter}</span>
          </div>
          <div className="ncr-cell">
            <span className="ncr-label">발생일자</span>
            <span className="ncr-value">{ncr.report_date}</span>
          </div>
          <div className="ncr-cell ncr-cell-full">
            <span className="ncr-label">제목</span>
            <span className="ncr-value">{ncr.title}</span>
          </div>
          <div className="ncr-cell">
            <span className="ncr-label">작성자</span>
            <span className="ncr-value">{ncr.author}</span>
          </div>
          <div className="ncr-cell">
            <span className="ncr-label">조치부서</span>
            <span className="ncr-value">{ncr.action_department}</span>
          </div>
          <div className="ncr-cell">
            <span className="ncr-label">발생위치</span>
            <span className="ncr-value">{ncr.location}</span>
          </div>
          <div className="ncr-cell">
            <span className="ncr-label">업체</span>
            <span className="ncr-value">{ncr.company}</span>
          </div>
          <div className="ncr-cell">
            <span className="ncr-label">NC 유형</span>
            <span className="ncr-value">{ncr.nc_type}</span>
          </div>
          <div className="ncr-cell">
            <span className="ncr-label">첨부</span>
            <span className="ncr-value">{ncr.attachment}</span>
          </div>
          <div className="ncr-cell ncr-cell-full">
            <span className="ncr-label">조치담당자</span>
            <span className="ncr-value">{ncr.action_manager}</span>
          </div>
        </div>
        <div className="ncr-section">
          <div className="ncr-section-title">요구사항 / 기준 (Specification)</div>
          <div className="ncr-section-body">{ncr.specification}</div>
        </div>
        <div className="ncr-section">
          <div className="ncr-section-title">부적합 내용 (Description)</div>
          <div className="ncr-section-body ncr-section-tall">
            <NumberedText text={ncr.description} />
          </div>
        </div>
        <div className="ncr-section">
          <div className="ncr-section-title">즉각 조치사항 (Immediate Action)</div>
          <div className="ncr-section-body ncr-section-tall">
            <NumberedText text={ncr.immediate_action} />
          </div>
        </div>
        <div className="ncr-section">
          <div className="ncr-section-title">처분 (Disposition)</div>
          <div className="ncr-disposition-row">
            {DISPOSITION_ALL.map((opt) => (
              <label key={opt} className="ncr-checkbox-label">
                <span
                  className={`ncr-checkbox${ncr.disposition.includes(opt) ? " is-checked" : ""}`}
                >
                  {ncr.disposition.includes(opt) ? "☑" : "□"}
                </span>
                {opt}
              </label>
            ))}
          </div>
        </div>
        <div className="ncr-two-col">
          <div className="ncr-cell">
            <span className="ncr-label">조치 책임자</span>
            <span className="ncr-value">{ncr.action_responsible}</span>
          </div>
          <div className="ncr-cell">
            <span className="ncr-label">조치기한</span>
            <span className="ncr-value">{ncr.action_deadline}</span>
          </div>
        </div>
        <div className="ncr-section">
          <div className="ncr-section-title">검증 (Verification)</div>
          <div className="ncr-section-body">
            <NumberedText text={ncr.verification} />
          </div>
        </div>
        <div className="ncr-two-col">
          <div className="ncr-cell">
            <span className="ncr-label">종료일</span>
            <span className="ncr-value">{ncr.completion_date || "-"}</span>
          </div>
          <div className="ncr-cell">
            <span className="ncr-label">비고</span>
            <span className="ncr-value">{ncr.notes || ""}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── SIR 폼 뷰 ───────────────────────────────────────────────── */

export function SirFormView({
  sir,
  stepsLog = [],
  onReset,
  showPipeline = true,
}: {
  sir: SafetyInspectionDocument;
  stepsLog?: string[];
  onReset?: () => void;
  showPipeline?: boolean;
}) {
  const failItems = sir.checklist.filter((c) => c.status === "F");
  const passItems = sir.checklist.filter((c) => c.status === "P");
  const riskClass =
    sir.risk_level === "Critical"
      ? "sir-risk-critical"
      : sir.risk_level === "High" || sir.risk_level === "high"
        ? "sir-risk-high"
        : sir.risk_level === "Medium" || sir.risk_level === "medium"
          ? "sir-risk-medium"
          : "sir-risk-low";

  async function copyAsText() {
    const rows = sir.checklist.map((c) => `  [${c.status}] ${c.target} — ${c.item_name}: ${c.findings}`).join("\n");
    const regs = sir.violated_regulations.length > 0 ? sir.violated_regulations.join(", ") : "-";
    const text = [
      `정기 안전 점검 보고서`,
      `문서번호: ${sir.document_number}`,
      ``,
      `[1. 점검 기본 정보]`,
      `공사명:    ${sir.construction_name}`,
      `점검 일시: ${sir.inspection_date}`,
      `점검자:    ${sir.inspector}`,
      `점검 구역: ${sir.inspection_zone}`,
      ``,
      `[2. 주요 점검 및 지적 사항]`,
      `YOLO 탐지: ${sir.yolo_detections_summary}`,
      rows,
      ``,
      `지적 건수: ${failItems.length}건 Fail / ${passItems.length}건 Pass`,
      `위험도: ${sir.risk_level}`,
      ``,
      `[3. 현장 사진]`,
      sir.photo_guidance,
      ``,
      `[4. 조치 계획 및 확인]`,
      `위반 법령:  ${regs}`,
      `조치 기한:  ${sir.action_deadline}`,
      `조치 책임자: ${sir.action_responsible}`,
      `재점검 의견: ${sir.reinspection_opinion}`,
    ].join("\n");
    await navigator.clipboard.writeText(text);
  }

  return (
    <div className="sir-wrapper">
      <div className="sir-top-bar">
        {showPipeline && stepsLog.length > 0 ? (
          <div className="dag-steps-log">
            {stepsLog.map((s, i) => (
              <span key={i} className="dag-step-badge">
                ✓ {s}
              </span>
            ))}
          </div>
        ) : (
          <div className="dag-steps-log" />
        )}
        <div className="ncr-actions">
          <button type="button" className="dag-copy-btn" onClick={copyAsText}>
            텍스트 복사
          </button>
          <button type="button" className="dag-copy-btn" onClick={() => window.print()}>
            🖨️ 인쇄
          </button>
          {onReset ? (
            <button type="button" className="dag-reset-btn" onClick={onReset}>
              다시 선택
            </button>
          ) : null}
        </div>
      </div>

      <div className="sir-form">
        <div className="sir-doc-header">
          <div className="sir-doc-title">정기 안전 점검 보고서</div>
          <div className="sir-doc-meta">
            <span>문서번호: {sir.document_number}</span>
            <span className={`sir-risk-badge ${riskClass}`}>{sir.risk_level}</span>
          </div>
        </div>

        <div className="sir-section">
          <div className="sir-section-title">1. 점검 기본 정보</div>
          <table className="sir-info-table">
            <tbody>
              <tr>
                <th>공사명</th>
                <td colSpan={3}>{sir.construction_name}</td>
              </tr>
              <tr>
                <th>점검 일시</th>
                <td>{sir.inspection_date}</td>
                <th>점검자</th>
                <td>{sir.inspector}</td>
              </tr>
              <tr>
                <th>점검 구역</th>
                <td colSpan={3}>{sir.inspection_zone}</td>
              </tr>
            </tbody>
          </table>
          {sir.yolo_detections_summary !== "자동 탐지 결과 없음 — 이미지 육안 분석 기반" && (
            <div className="sir-yolo-box">
              <span className="sir-yolo-label">🤖 AI 탐지</span>
              <span className="sir-yolo-text">{sir.yolo_detections_summary}</span>
            </div>
          )}
        </div>

        <div className="sir-section">
          <div className="sir-section-title">
            2. 주요 점검 및 지적 사항
            <span className="sir-summary-badge">
              Fail <strong>{failItems.length}</strong>건 &nbsp;/&nbsp; Pass <strong>{passItems.length}</strong>건
            </span>
          </div>
          <table className="sir-checklist-table">
            <thead>
              <tr>
                <th style={{ width: "13%" }}>점검 대상</th>
                <th style={{ width: "28%" }}>점검 항목 (Checklist)</th>
                <th style={{ width: "8%" }}>상태 (P/F)</th>
                <th>지적 및 조치 요구 사항</th>
              </tr>
            </thead>
            <tbody>
              {sir.checklist.map((item, i) => (
                <tr
                  key={i}
                  className={
                    item.status === "F" ? "sir-row-fail" : item.status === "P" ? "sir-row-pass" : ""
                  }
                >
                  <td className="sir-target-cell">{item.target}</td>
                  <td>{item.item_name}</td>
                  <td
                    className={`sir-pf-cell ${
                      item.status === "F" ? "sir-pf-fail" : item.status === "P" ? "sir-pf-pass" : "sir-pf-na"
                    }`}
                  >
                    {item.status}
                  </td>
                  <td className="sir-findings-cell">{item.findings}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="sir-section">
          <div className="sir-section-title">3. 현장 사진 (Before &amp; After)</div>
          <div className="sir-photo-guidance">{sir.photo_guidance}</div>
          <div className="sir-photo-grid">
            <div className="sir-photo-box">
              <div className="sir-photo-label">📷 현황 사진 (Before)</div>
              <div className="sir-photo-placeholder">지적 사항 촬영 사진 첨부</div>
            </div>
            <div className="sir-photo-box">
              <div className="sir-photo-label">✅ 조치 완료 사진 (After)</div>
              <div className="sir-photo-placeholder">조치 완료 후 확인 사진 첨부</div>
            </div>
          </div>
        </div>

        <div className="sir-section">
          <div className="sir-section-title">4. 조치 계획 및 확인</div>
          {sir.violated_regulations.length > 0 && (
            <div className="sir-regulation-box">
              <span className="sir-reg-label">위반 법령</span>
              <ul className="sir-reg-list">
                {sir.violated_regulations.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          <table className="sir-action-table">
            <tbody>
              <tr>
                <th>조치 기한</th>
                <td>{sir.action_deadline}</td>
                <th>조치 책임자</th>
                <td>{sir.action_responsible}</td>
              </tr>
              <tr>
                <th>재점검 의견</th>
                <td colSpan={3} className="sir-opinion-cell">
                  {sir.reinspection_opinion.split(/<br\s*\/?>/i).map((part, i, arr) => (
                    <Fragment key={i}>
                      {part}
                      {i < arr.length - 1 && <br />}
                    </Fragment>
                  ))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="sir-sig-row">
          <div className="sir-sig-box">
            <div className="sir-sig-title">점검자</div>
            <div className="sir-sig-area" />
            <div className="sir-sig-name">{sir.inspector}</div>
          </div>
          <div className="sir-sig-box">
            <div className="sir-sig-title">확인자</div>
            <div className="sir-sig-area" />
            <div className="sir-sig-name">(서명)</div>
          </div>
          <div className="sir-sig-box">
            <div className="sir-sig-title">승인</div>
            <div className="sir-sig-area" />
            <div className="sir-sig-name">(서명)</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 공정 현황 보고서 폼 뷰 (Primavera P6 분석 결과) ──────────── */

export function ScheduleFormView({
  doc,
  stepsLog = [],
  onReset,
  showPipeline = true,
}: {
  doc: ScheduleReportDoc;
  stepsLog?: string[];
  onReset?: () => void;
  showPipeline?: boolean;
}) {
  // 진도 편차에 따른 상태 배지 색 (안전점검 risk 배지 클래스 재사용).
  const statusClass = doc.status_level === "지연" ? "sir-risk-high" : "sir-risk-low";
  const varianceStr = `${doc.schedule_variance > 0 ? "+" : ""}${doc.schedule_variance}%p`;
  const criticalDelayed = doc.delayed.filter((d) => d.is_critical).length;

  async function copyAsText() {
    const rows = doc.delayed
      .map(
        (d) =>
          `  [${d.is_critical ? "임계" : "지연"}] ${d.name} (${d.wbs_path}) — ${d.reason}, ${d.delay_days}일`,
      )
      .join("\n");
    const text = [
      doc.title,
      `문서번호: ${doc.document_number}`,
      ``,
      `[1. 보고 기본 정보]`,
      `공사명:   ${doc.construction_name}`,
      `기준일:   ${doc.data_date}`,
      `전체 공기: ${doc.project_start} ~ ${doc.project_finish} (총 ${doc.total_duration_days}일)`,
      ``,
      `[2. 공정 현황 요약]`,
      `실적 진도: ${doc.overall_percent}%  /  계획 진도: ${doc.planned_percent}%  /  편차: ${varianceStr}`,
      `완료 ${doc.completed_count} / 진행 ${doc.in_progress_count} / 미착수 ${doc.not_started_count}  ·  임계공정 ${doc.critical_count}개`,
      ``,
      `[3. 지연·임계 공정]`,
      rows || "  (지연 공정 없음)",
      ``,
      `[4. 종합 의견]`,
      doc.narrative,
    ].join("\n");
    await navigator.clipboard.writeText(text);
  }

  return (
    <div className="sir-wrapper">
      <div className="sir-top-bar">
        {showPipeline && stepsLog.length > 0 ? (
          <div className="dag-steps-log">
            {stepsLog.map((s, i) => (
              <span key={i} className="dag-step-badge">
                ✓ {s}
              </span>
            ))}
          </div>
        ) : (
          <div className="dag-steps-log" />
        )}
        <div className="ncr-actions">
          <button type="button" className="dag-copy-btn" onClick={copyAsText}>
            텍스트 복사
          </button>
          <button type="button" className="dag-copy-btn" onClick={() => window.print()}>
            🖨️ 인쇄
          </button>
          {onReset ? (
            <button type="button" className="dag-reset-btn" onClick={onReset}>
              다시 선택
            </button>
          ) : null}
        </div>
      </div>

      <div className="sir-form">
        <div className="sir-doc-header">
          <div className="sir-doc-title">{doc.title}</div>
          <div className="sir-doc-meta">
            <span>문서번호: {doc.document_number}</span>
            <span className={`sir-risk-badge ${statusClass}`}>{doc.status_level}</span>
          </div>
        </div>

        {/* 1. 보고 기본 정보 */}
        <div className="sir-section">
          <div className="sir-section-title">1. 보고 기본 정보</div>
          <table className="sir-info-table">
            <tbody>
              <tr>
                <th>공사명</th>
                <td colSpan={3}>{doc.construction_name}</td>
              </tr>
              <tr>
                <th>작성일 (금일)</th>
                <td>{doc.reference_date}</td>
                <th>공정표 기준일</th>
                <td>{doc.data_date}</td>
              </tr>
              <tr>
                <th>보고 유형</th>
                <td>{doc.title}</td>
                <th>전체 공기</th>
                <td>
                  {doc.project_start} ~ {doc.project_finish} (총 {doc.total_duration_days}일)
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* 2. 공정 현황 요약 */}
        <div className="sir-section">
          <div className="sir-section-title">
            2. 공정 현황 요약
            <span className="sir-summary-badge">
              실적 <strong>{doc.overall_percent}%</strong> &nbsp;/&nbsp; 계획{" "}
              <strong>{doc.planned_percent}%</strong> &nbsp;·&nbsp; 편차{" "}
              <strong>{varianceStr}</strong>
            </span>
          </div>
          <table className="sir-info-table">
            <tbody>
              <tr>
                <th>실적 진도율</th>
                <td>{doc.overall_percent}%</td>
                <th>계획 진도율</th>
                <td>{doc.planned_percent}%</td>
              </tr>
              <tr>
                <th>진행 현황</th>
                <td colSpan={3}>
                  완료 {doc.completed_count} / 진행 {doc.in_progress_count} / 미착수{" "}
                  {doc.not_started_count} (총 {doc.activity_count}개 · 마일스톤{" "}
                  {doc.milestone_count}개)
                </td>
              </tr>
              <tr>
                <th>임계공정</th>
                <td>{doc.critical_count}개</td>
                <th>지연 공정</th>
                <td>{doc.delayed_count}개</td>
              </tr>
            </tbody>
          </table>
          <div className="sch-prog-wrap">
            <ProgressBar label="실적" pct={doc.overall_percent} variant="actual" />
            <ProgressBar label="계획" pct={doc.planned_percent} variant="planned" />
          </div>
        </div>

        {/* 금일 진행 공정 (공사일보 — 일정 날짜 기준, 실적%과 무관) */}
        {doc.doc_type === "proc_daily" && (
          <div className="sir-section">
            <div className="sir-section-title">
              금일({doc.reference_date}) 진행 공정 — 일정 기준
              <span className="sir-summary-badge">
                <strong>{doc.active_today.length}</strong>건
              </span>
            </div>
            {doc.active_today.length > 0 ? (
              <table className="sir-checklist-table">
                <thead>
                  <tr>
                    <th style={{ width: "32%" }}>공정명</th>
                    <th style={{ width: "30%" }}>WBS 경로</th>
                    <th style={{ width: "22%" }}>공정 기간</th>
                    <th>구분</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.active_today.map((t, i) => (
                    <tr key={i} className={t.is_critical ? "sir-row-fail" : ""}>
                      <td className="sir-target-cell">{t.name}</td>
                      <td>{t.wbs_path || "-"}</td>
                      <td>
                        {t.planned_start} ~ {t.planned_finish}
                      </td>
                      <td className={`sir-pf-cell ${t.is_critical ? "sir-pf-fail" : "sir-pf-na"}`}>
                        {t.is_critical ? "⚠ 임계" : "일반"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="sir-photo-guidance">
                금일({doc.reference_date}) 일정상 착수·진행 예정 공정 없음.
              </div>
            )}
          </div>
        )}

        {/* 3. 공정 리스크 신호 (단기 착수·지연 영향·정합성) */}
        {(doc.upcoming_critical.length > 0 ||
          doc.delay_impacts.length > 0 ||
          doc.integrity_warnings.length > 0) && (
          <div className="sir-section">
            <div className="sir-section-title">3. 공정 리스크 신호 (AI 추천 — 검토용)</div>

            {doc.integrity_warnings.length > 0 && (
              <div className="sch-warn-box">
                <div className="sch-warn-title">⚠ 데이터 정합성 경고</div>
                <ul className="sch-warn-list">
                  {doc.integrity_warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {doc.upcoming_critical.length > 0 && (
              <>
                <div className="sch-subhead">단기 착수 예정 — 선행 조치 대상 (14일 내)</div>
                <table className="sir-checklist-table">
                  <thead>
                    <tr>
                      <th style={{ width: "30%" }}>공정명</th>
                      <th style={{ width: "32%" }}>WBS 경로</th>
                      <th style={{ width: "18%" }}>착수 예정</th>
                      <th>구분</th>
                    </tr>
                  </thead>
                  <tbody>
                    {doc.upcoming_critical.map((u, i) => (
                      <tr key={i} className={u.is_critical ? "sir-row-fail" : ""}>
                        <td className="sir-target-cell">{u.name}</td>
                        <td>{u.wbs_path || "-"}</td>
                        <td>
                          {u.planned_start}
                          {" "}
                          <span style={{ color: u.days_until < 0 ? "#b91c1c" : "#64748b" }}>
                            ({u.days_until < 0 ? `${-u.days_until}일 경과` : `D-${u.days_until}`})
                          </span>
                        </td>
                        <td className={`sir-pf-cell ${u.is_critical ? "sir-pf-fail" : "sir-pf-na"}`}>
                          {u.is_critical ? "⚠ 임계" : "일반"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {doc.delay_impacts.length > 0 && (
              <>
                <div className="sch-subhead">지연 영향 전파 (후속 공정·마일스톤)</div>
                <ul className="sch-impact-list">
                  {doc.delay_impacts.map((di, i) => (
                    <li key={i}>
                      <strong>{di.name}</strong>
                      {di.is_critical ? <span className="sch-tag-cp"> 임계</span> : null}
                      {" "}
                      {di.delay_days}일 지연 → 후속 {di.downstream_count}건 영향
                      {di.affected_milestones.length > 0 && (
                        <span className="sch-impact-ms">
                          {" "}· 마일스톤 영향: {di.affected_milestones.join(", ")}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {/* 4. 지연·임계 공정 */}
        <div className="sir-section">
          <div className="sir-section-title">
            4. 지연·임계 공정 (지적 사항)
            <span className="sir-summary-badge">
              지연 <strong>{doc.delayed_count}</strong>건 &nbsp;/&nbsp; 임계{" "}
              <strong>{doc.critical_count}</strong>건
            </span>
          </div>
          {doc.delayed.length > 0 ? (
            <table className="sir-checklist-table">
              <thead>
                <tr>
                  <th style={{ width: "24%" }}>공정명</th>
                  <th style={{ width: "26%" }}>WBS 경로</th>
                  <th style={{ width: "10%" }}>상태</th>
                  <th style={{ width: "10%" }}>지연</th>
                  <th>사유</th>
                </tr>
              </thead>
              <tbody>
                {doc.delayed.map((d, i) => (
                  <tr key={i} className={d.is_critical ? "sir-row-fail" : ""}>
                    <td className="sir-target-cell">{d.name}</td>
                    <td>{d.wbs_path || "-"}</td>
                    <td className={`sir-pf-cell ${d.is_critical ? "sir-pf-fail" : "sir-pf-na"}`}>
                      {d.is_critical ? "⚠ 임계" : "지연"}
                    </td>
                    <td>{d.delay_days}일</td>
                    <td className="sir-findings-cell">
                      {d.reason} (진도 {d.percent_complete}%, 계획종료 {d.planned_finish})
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="sir-photo-guidance">지연·임계 공정 없음 — 계획 대비 정상 추세입니다.</div>
          )}
          {doc.milestones.length > 0 && (
            <div className="sir-regulation-box">
              <span className="sir-reg-label">다가오는 마일스톤</span>
              <ul className="sir-reg-list">
                {doc.milestones.map((m, i) => (
                  <li key={i}>
                    {m.name} — 목표 {m.date}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* 5. 필요문서 추천 (선행 준비) */}
        {doc.doc_recommendations.length > 0 && (
          <div className="sir-section">
            <div className="sir-section-title">
              5. 필요문서 추천 (선행 준비 — AI 추천, 사람 확정)
            </div>
            {doc.doc_rec_summary.length > 0 && (
              <div className="sch-recsum">
                {doc.doc_rec_summary.map((s) => (
                  <span key={s.type} className="sch-recsum-chip">
                    {s.label} <strong>{s.count}</strong>건
                  </span>
                ))}
              </div>
            )}
            <table className="sir-checklist-table">
              <thead>
                <tr>
                  <th style={{ width: "26%" }}>공정명</th>
                  <th style={{ width: "16%" }}>공종</th>
                  <th style={{ width: "16%" }}>시점</th>
                  <th>필요 문서 (생성 후보)</th>
                </tr>
              </thead>
              <tbody>
                {doc.doc_recommendations.map((r, i) => (
                  <tr key={i} className={r.is_critical ? "sir-row-fail" : ""}>
                    <td className="sir-target-cell">{r.activity_name}</td>
                    <td>{r.work_type}</td>
                    <td>
                      {r.when}
                      {r.is_critical ? <span className="sch-tag-cp"> 임계</span> : null}
                    </td>
                    <td>
                      {r.doc_types.map((d) => (
                        <span key={d.type} className="sch-docbadge">
                          {d.label}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="sir-photo-guidance">
              ※ 위 문서는 해당 공정 착수·진행 전 준비가 권장되는 후보입니다. 실제 생성·작성·확정은
              담당자가 판단합니다. 부적합·사고 발생 시의 NCR·시정조치(CAR)·사고조사는 별도(사후) 문서입니다.
            </div>
          </div>
        )}

        {/* 6. 관련 기준·근거 / 종합 의견 */}
        <div className="sir-section">
          <div className="sir-section-title">6. 관련 기준·근거 / 종합 의견</div>
          {doc.grounding ? (
            <div className="sir-regulation-box">
              <span className="sir-reg-label">관련 기준·근거 (KCS/KDS·법령)</span>
              <div className="sch-md">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.grounding}</ReactMarkdown>
              </div>
            </div>
          ) : null}
          <div className="sch-md sir-opinion-cell">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {doc.narrative || "_(종합 의견 없음)_"}
            </ReactMarkdown>
          </div>
          <div className="sir-photo-guidance">
            ※ 위 근거·의견은 공정표 분석에 기반한 검토용 참고자료입니다. 공기연장·지체상금·법적 책임의
            확정이 아니며, 적용 여부·최신 기준은 별도 확인이 필요합니다.
          </div>
        </div>

        <div className="sir-sig-row">
          <div className="sir-sig-box">
            <div className="sir-sig-title">작성자</div>
            <div className="sir-sig-area" />
            <div className="sir-sig-name">(현장 공무)</div>
          </div>
          <div className="sir-sig-box">
            <div className="sir-sig-title">검토자</div>
            <div className="sir-sig-area" />
            <div className="sir-sig-name">(서명)</div>
          </div>
          <div className="sir-sig-box">
            <div className="sir-sig-title">승인</div>
            <div className="sir-sig-area" />
            <div className="sir-sig-name">(서명)</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProgressBar({
  label,
  pct,
  variant,
}: {
  label: string;
  pct: number;
  variant: "actual" | "planned";
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="sch-prog-row">
      <span className="sch-prog-label">{label}</span>
      <div className="sch-prog-track">
        <div className={`sch-prog-fill sch-prog-${variant}`} style={{ width: `${clamped}%` }} />
      </div>
      <span className="sch-prog-val">{pct}%</span>
    </div>
  );
}

/* ── 공통 툴바 / 서명행 헬퍼 ─────────────────────────────────── */

function FormTopBar({ stepsLog = [], onReset }: { stepsLog?: string[]; onReset?: () => void }) {
  return (
    <div className="sir-top-bar">
      {stepsLog.length > 0 ? (
        <div className="dag-steps-log">
          {stepsLog.map((s, i) => (
            <span key={i} className="dag-step-badge">✓ {s}</span>
          ))}
        </div>
      ) : (
        <div className="dag-steps-log" />
      )}
      <div className="ncr-actions">
        <button type="button" className="dag-copy-btn" onClick={() => window.print()}>🖨️ 인쇄</button>
        {onReset ? (
          <button type="button" className="dag-reset-btn" onClick={onReset}>다시 선택</button>
        ) : null}
      </div>
    </div>
  );
}

function SigRow({ roles }: { roles: Array<[string, string]> }) {
  return (
    <div className="sir-sig-row">
      {roles.map(([title, name], i) => (
        <div key={i} className="sir-sig-box">
          <div className="sir-sig-title">{title}</div>
          <div className="sir-sig-area" />
          <div className="sir-sig-name">{name || "(서명)"}</div>
        </div>
      ))}
    </div>
  );
}

function judgeClass(j: string) {
  if (j === "부적합") return "sir-pf-fail";
  if (j === "적합") return "sir-pf-pass";
  if (j === "확인필요") return "sir-pf-na";  // 노란 톤 원하면 별도 클래스 추가 가능
  return "sir-pf-na";  // 해당없음 등
}

/* ── 품질 검사 보고서 A4 뷰 ──────────────────────────────────── */

export function QualityFormView({
  doc,
  stepsLog = [],
  onReset,
}: {
  doc: QualityInspectionDoc;
  stepsLog?: string[];
  onReset?: () => void;
}) {
  const fail = doc.checklist.filter((c) => c.judgement === "부적합").length;
  const pass = doc.checklist.filter((c) => c.judgement === "적합").length;
  const review = doc.checklist.filter((c) => c.judgement === "확인필요").length;
  const badge =
    doc.judgement === "부적합" ? "sir-risk-high"
    : doc.judgement === "확인필요" ? "sir-risk-medium"
    : "sir-risk-low";
  return (
    <div className="sir-wrapper">
      <FormTopBar stepsLog={stepsLog} onReset={onReset} />
      <div className="sir-form">
        <div className="sir-doc-header">
          <div className="sir-doc-title">{doc.report_title || "품질 검사 보고서"}</div>
          <div className="sir-doc-meta">
            <span>문서번호: {doc.document_number}</span>
            <span className={`sir-risk-badge ${badge}`}>{doc.judgement}</span>
          </div>
        </div>

        <div className="sir-section">
          <div className="sir-section-title">1. 공사 개요</div>
          <table className="sir-info-table">
            <tbody>
              <tr><th>현장명</th><td>{doc.site_name}</td><th>공사 위치</th><td>{doc.construction_location || "-"}</td></tr>
              <tr><th>시공사</th><td>{doc.contractor || "-"}</td><th>감리단</th><td>{doc.supervisor_org || "-"}</td></tr>
              <tr><th>검사 일자</th><td>{doc.inspection_date}</td><th>검사자</th><td>{doc.inspector}</td></tr>
              <tr><th>검사 공종</th><td>{doc.work_type}</td><th>입회자</th><td>{doc.witness || "해당 없음"}</td></tr>
              <tr><th>검사 위치</th><td colSpan={3}>{doc.inspection_location}</td></tr>
            </tbody>
          </table>
        </div>

        <div className="sir-section">
          <div className="sir-section-title">2. 검사 목적</div>
          <div className="sir-photo-guidance"><NumberedText text={doc.inspection_purpose || ""} /></div>
        </div>

        <div className="sir-section">
          <div className="sir-section-title">3. 검사 기준</div>
          <div className="sir-regulation-box">
            <ul className="sir-reg-list">
              {[...(doc.criteria_documents || []), ...(doc.related_standards || [])].map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="sir-section">
          <div className="sir-section-title">
            4. 검사 내용
            <span className="sir-summary-badge">
              적합 <strong>{pass}</strong> / 부적합 <strong>{fail}</strong>
              {review > 0 && <> / 확인필요 <strong>{review}</strong></>}건
            </span>
          </div>
          <table className="sir-checklist-table">
            <thead>
              <tr><th>검사 항목</th><th>검사 기준</th><th>검사 결과</th><th style={{ width: "8%" }}>판정</th><th>비고</th></tr>
            </thead>
            <tbody>
              {doc.checklist.map((c, i) => (
                <tr
                  key={i}
                  className={
                    c.judgement === "부적합" ? "sir-row-fail"
                    : c.judgement === "확인필요" ? ""
                    : "sir-row-pass"
                  }
                >
                  <td>{c.item}</td><td>{c.criterion}</td><td>{c.result}</td>
                  <td className={`sir-pf-cell ${judgeClass(c.judgement)}`}>{c.judgement}</td>
                  <td>{c.note || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {doc.nonconformities?.length > 0 && (
          <div className="sir-section">
            <div className="sir-section-title">5. 부적합 사항</div>
            {doc.nonconformities.map((nc, i) => (
              <table key={i} className="sir-action-table" style={{ marginBottom: 8 }}>
                <tbody>
                  <tr><th>발생 위치</th><td colSpan={3}>{nc.location}</td></tr>
                  <tr><th>부적합 내용</th><td colSpan={3}><NumberedText text={nc.description || ""} /></td></tr>
                  <tr><th>원인</th><td><NumberedText text={nc.cause || "-"} /></td><th>관련 사진</th><td>{nc.photo_ref || "-"}</td></tr>
                  <tr><th>조치 필요</th><td colSpan={3}><NumberedText text={nc.required_action || ""} /></td></tr>
                </tbody>
              </table>
            ))}
          </div>
        )}

        {doc.actions?.length > 0 && (
          <div className="sir-section">
            <div className="sir-section-title">6. 조치 사항</div>
            <table className="sir-checklist-table">
              <thead><tr><th>부적합 내용</th><th>조치 사항</th><th>완료 여부</th><th>재검사 결과</th></tr></thead>
              <tbody>
                {doc.actions.map((a, i) => (
                  <tr key={i}>
                    <td><NumberedText text={a.nonconformity || ""} /></td>
                    <td><NumberedText text={a.action || ""} /></td>
                    <td>{a.completed}</td>
                    <td>{a.reinspection_result}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="sir-section">
          <div className="sir-section-title">7. 종합 의견</div>
          <div className="sir-photo-guidance"><NumberedText text={doc.overall_opinion || ""} /></div>
        </div>

        {doc.attachments?.length > 0 && (
          <div className="sir-section">
            <div className="sir-section-title">8. 첨부 자료</div>
            <div className="sir-regulation-box"><ul className="sir-reg-list">{doc.attachments.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
          </div>
        )}

        <SigRow roles={[["작성자", doc.author || ""], ["검토자", doc.reviewer || ""], ["승인자", doc.approver || ""]]} />
      </div>
    </div>
  );
}

/* ── 자재 검수 확인서 A4 뷰 ──────────────────────────────────── */

export function MaterialFormView({
  doc,
  stepsLog = [],
  onReset,
}: {
  doc: MaterialInspectionDoc;
  stepsLog?: string[];
  onReset?: () => void;
}) {
  const ov = doc.overview || {};
  const badge = doc.judgement === "부적합" ? "sir-risk-high" : doc.judgement === "조건부 적합" ? "sir-risk-medium" : "sir-risk-low";
  const OV: Array<[string, string]> = [
    ["자재명", ov.material_name], ["규격/모델", ov.specification], ["제조사", ov.manufacturer],
    ["공급업체", ov.supplier], ["수량", `${ov.quantity ?? ""} ${ov.unit ?? ""}`], ["납품일자", ov.delivery_date],
    ["납품서 번호", ov.delivery_note_no], ["자재승인서 번호", ov.approval_doc_no],
    ["시험성적서 번호", ov.test_report_no], ["KS/인증", ov.ks_certified], ["보관 위치", ov.storage_location],
  ];
  return (
    <div className="sir-wrapper">
      <FormTopBar stepsLog={stepsLog} onReset={onReset} />
      <div className="sir-form">
        <div className="sir-doc-header">
          <div className="sir-doc-title">자재 검수 확인서</div>
          <div className="sir-doc-meta">
            <span>문서번호: {doc.document_number}</span>
            <span className={`sir-risk-badge ${badge}`}>{doc.judgement}</span>
          </div>
        </div>

        <div className="sir-section">
          <div className="sir-section-title">기본 정보</div>
          <table className="sir-info-table">
            <tbody>
              <tr><th>현장명</th><td>{doc.site_name}</td><th>검수 일자</th><td>{doc.inspection_date}</td></tr>
              <tr><th>검수자</th><td>{doc.inspector}</td><th>관련 공종</th><td>{doc.work_type}</td></tr>
              <tr><th>협력업체</th><td>{doc.cooperator || "-"}</td><th>공급업체</th><td>{doc.supplier || "-"}</td></tr>
              <tr><th>납품차량</th><td>{doc.delivery_vehicle_no || "-"}</td><th>입회자</th><td>{doc.witness || "해당 없음"}</td></tr>
            </tbody>
          </table>
        </div>

        <div className="sir-section">
          <div className="sir-section-title">1. 자재 개요</div>
          <table className="sir-info-table">
            <tbody>
              {OV.reduce<Array<Array<[string, string]>>>((rows, cur, i) => {
                if (i % 2 === 0) rows.push([cur]);
                else rows[rows.length - 1].push(cur);
                return rows;
              }, []).map((pair, i) => (
                <tr key={i}>
                  <th>{pair[0][0]}</th><td>{pair[0][1] || "-"}</td>
                  <th>{pair[1]?.[0] ?? ""}</th><td>{pair[1]?.[1] ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="sir-section">
          <div className="sir-section-title">3. 검수 결과</div>
          <table className="sir-checklist-table">
            <thead><tr><th>검수 항목</th><th>검수 기준</th><th>검수 결과</th><th style={{ width: "8%" }}>판정</th><th>비고</th></tr></thead>
            <tbody>
              {doc.checklist.map((c, i) => (
                <tr key={i} className={c.judgement === "부적합" ? "sir-row-fail" : "sir-row-pass"}>
                  <td>{c.item}</td><td>{c.criterion}</td><td>{c.result}</td>
                  <td className={`sir-pf-cell ${judgeClass(c.judgement)}`}>{c.judgement}</td>
                  <td>{c.note || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="sir-section">
          <div className="sir-section-title">4. 종합 판정</div>
          <table className="sir-action-table">
            <tbody>
              <tr><th>종합 판정</th><td>{doc.judgement}</td><th>처리 결과</th><td>{doc.disposition}</td></tr>
              <tr><th>NCR 번호</th><td colSpan={3}>{doc.ncr_number || "(해당 시 발행)"}</td></tr>
            </tbody>
          </table>
        </div>

        {doc.nonconformities?.length > 0 && (
          <div className="sir-section">
            <div className="sir-section-title">5. 부적합 사항</div>
            {doc.nonconformities.map((nc, i) => (
              <table key={i} className="sir-action-table" style={{ marginBottom: 8 }}>
                <tbody>
                  <tr><th>발생 항목</th><td>{nc.nc_item}</td><th>발생 수량</th><td>{nc.quantity || "-"}</td></tr>
                  <tr><th>요구 기준</th><td><NumberedText text={nc.required_criterion || ""} /></td><th>실제 상태</th><td><NumberedText text={nc.actual_state || ""} /></td></tr>
                  <tr><th>부적합 내용</th><td colSpan={3}><NumberedText text={nc.description || ""} /></td></tr>
                  <tr><th>임시 조치</th><td><NumberedText text={nc.temporary_action || ""} /></td><th>NCR 발행</th><td>{nc.ncr_issued}{nc.ncr_number ? ` (${nc.ncr_number})` : ""}</td></tr>
                </tbody>
              </table>
            ))}
          </div>
        )}

        <div className="sir-section">
          <div className="sir-section-title">7. 검수 의견</div>
          <div className="sir-photo-guidance"><NumberedText text={doc.inspection_opinion || ""} /></div>
        </div>

        <SigRow roles={[
          ["검수자", doc.inspector_sign || doc.inspector], ["현장대리인", doc.site_manager_sign || ""],
          ["감리/감독자", doc.supervisor_sign || ""], ["협력업체", doc.cooperator_sign || ""],
        ]} />
      </div>
    </div>
  );
}

/* ── 자동 파생 NCR (부적합 처리 보고서) A4 뷰 ────────────────── */

const NCR_TYPE_LABEL: Record<string, string> = {
  workmanship: "시공 (Workmanship)",
  material: "자재 (Material)",
  test_result: "시험 결과 (Test Result)",
  other: "기타 (Other)",
};
const SRC_TYPE_LABEL: Record<string, string> = {
  quality_inspection: "품질 검사 보고서",
  material_inspection: "자재 검수 확인서",
};

export function DerivedNcrFormView({
  doc,
  onReset,
}: {
  doc: DerivedNCRDoc;
  onReset?: () => void;
}) {
  const items = doc.items || [];
  return (
    <div className="sir-wrapper">
      <FormTopBar onReset={onReset} />
      <div className="sir-form">
        <div className="sir-doc-header">
          <div className="sir-doc-title">부적합 처리 보고서 (NCR)</div>
          <div className="sir-doc-meta">
            <span>문서번호: {doc.ncr_number}</span>
            <span className="sir-risk-badge sir-risk-high">부적합 {items.length}건</span>
          </div>
        </div>

        <div className="sir-section">
          <div className="sir-section-title">1. 발행 정보</div>
          <table className="sir-info-table">
            <tbody>
              <tr>
                <th>원본 문서</th>
                <td>{SRC_TYPE_LABEL[doc.source_document_type] || doc.source_document_type} {doc.source_document_id}</td>
                <th>부적합 유형</th>
                <td>{NCR_TYPE_LABEL[doc.ncr_type] || doc.ncr_type}</td>
              </tr>
              <tr>
                <th>조치 담당자</th>
                <td>{doc.responsible_party || "현장 품질관리자"}</td>
                <th>조치 기한</th>
                <td>{doc.due_date || "-"}</td>
              </tr>
              <tr>
                <th>CAR 필요</th>
                <td>{doc.car_required ? "필요 (시정조치 보고서 작성 권고)" : "불필요"}</td>
                <th>상태</th>
                <td>{doc.status || "draft"}</td>
              </tr>
            </tbody>
          </table>
          <div className="sir-photo-guidance">{doc.description}</div>
        </div>

        <div className="sir-section">
          <div className="sir-section-title">
            2. 부적합 항목
            <span className="sir-summary-badge">총 <strong>{items.length}</strong>건</span>
          </div>
          <table className="sir-checklist-table">
            <thead>
              <tr>
                <th style={{ width: "18%" }}>부적합 항목</th>
                <th style={{ width: "20%" }}>요구 기준</th>
                <th style={{ width: "22%" }}>실제 상태</th>
                <th style={{ width: "16%" }}>발생 위치</th>
                <th>즉시 조치</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="sir-row-fail">
                  <td className="sir-target-cell">{it.item}</td>
                  <td>{it.required_value}</td>
                  <td>{it.actual_value}</td>
                  <td>{it.location || "-"}</td>
                  <td className="sir-findings-cell">{it.immediate_action || "시정조치 후 재검사 필요"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {doc.related_standards && doc.related_standards.length > 0 && (
          <div className="sir-section">
            <div className="sir-section-title">3. 위반 기준·근거 (KCS/KDS·법령)</div>
            <div className="sir-regulation-box">
              <ul className="sir-reg-list">
                {doc.related_standards.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <div className="sir-photo-guidance">
          ※ 본 NCR은 {doc.source_document_id}의 부적합 항목에서 자동 발행되었습니다. 원인 분석·재발방지가
          필요하면 아래 [CAR 생성]으로 시정조치 보고서를 작성하세요.
        </div>
      </div>
    </div>
  );
}

/* ── 시정조치 보고서 (CAR) A4 뷰 — 종결상태 편집 가능 ────────── */

const CLOSURE_OPTIONS = ["종결", "조건부 종결", "미종결", "추가 조치 필요"];

/** 인라인 편집 셀 — editable=false 면 정적 텍스트, true 면 input/textarea. */
function EditCell({
  value,
  editable,
  onChange,
  multiline = false,
  placeholder,
}: {
  value: string;
  editable: boolean;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  if (!editable) {
    return <NumberedText text={value || ""} />;
  }
  if (multiline) {
    return (
      <textarea
        className="dd-edit-input dd-edit-textarea"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={Math.max(2, Math.min(12, (value || "").split("\n").length + 1))}
      />
    );
  }
  return (
    <input
      type="text"
      className="dd-edit-input"
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

/** 인라인 편집 select — enum 필드(판정·처분·위험도 등) 용. */
function EditSelect({
  value,
  options,
  editable,
  onChange,
}: {
  value: string;
  options: string[];
  editable: boolean;
  onChange: (v: string) => void;
}) {
  if (!editable) return <>{value || "-"}</>;
  return (
    <select
      className="dd-edit-input"
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
    >
      {!options.includes(value) && value ? <option value={value}>{value}</option> : null}
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}

/** path 기반 onChange 헬퍼 빌더 — 각 FormView 가 자기 doc 으로 호출. */
function makeSetField<T extends object>(
  doc: T,
  onChange: ((next: Record<string, unknown>) => void) | undefined,
) {
  return (path: string, val: string | string[]) => {
    if (!onChange) return;
    const parts = path.split(".");
    const next: Record<string, unknown> = { ...(doc as unknown as Record<string, unknown>) };
    let cur: Record<string, unknown> = next;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i];
      const child = cur[k];
      cur[k] = child && typeof child === "object" && !Array.isArray(child) ? { ...(child as object) } : {};
      cur = cur[k] as Record<string, unknown>;
    }
    cur[parts[parts.length - 1]] = val;
    onChange(next);
  };
}

/** 배열 항목 수정 — 예: setItem("checklist", 2, { judgement: "부적합" }) */
function makeSetItem<T extends object>(
  doc: T,
  onChange: ((next: Record<string, unknown>) => void) | undefined,
) {
  return (arrayPath: string, index: number, patch: Record<string, unknown>) => {
    if (!onChange) return;
    const next: Record<string, unknown> = { ...(doc as unknown as Record<string, unknown>) };
    const arr = Array.isArray(next[arrayPath]) ? [...(next[arrayPath] as unknown[])] : [];
    if (index < 0 || index >= arr.length) return;
    arr[index] = { ...(arr[index] as Record<string, unknown>), ...patch };
    next[arrayPath] = arr;
    onChange(next);
  };
}

export function CarFormView({
  doc,
  stepsLog = [],
  onReset,
  editable = false,
  onChange,
}: {
  doc: CARDoc;
  stepsLog?: string[];
  onReset?: () => void;
  editable?: boolean;
  onChange?: (next: Record<string, unknown>) => void;
}) {
  const [closure, setClosure] = useState(doc.closure_status || "미종결");
  const lk = doc.linked || {};
  const nc = doc.nc_summary || {};
  const c = (doc.cause || {}) as Record<string, unknown>;
  const cor = doc.corrective || {};
  const pre = doc.preventive || {};
  const ar = doc.action_result || {};
  const ri = doc.reinspection || {};
  const methods = Array.isArray(c.analysis_methods) ? (c.analysis_methods as string[]).join(", ") : "5 Why";
  const badge = closure === "종결" ? "sir-risk-low" : closure === "추가 조치 필요" ? "sir-risk-high" : "sir-risk-medium";

  // 인라인 편집 — path 기반 onChange 헬퍼.
  // 예: setField("corrective.content", "...") → doc.corrective.content 갱신.
  const setField = (path: string, val: string) => {
    if (!onChange) return;
    const parts = path.split(".");
    // doc 을 얕은 복사하면서 path 따라 들어감
    const next: Record<string, unknown> = { ...(doc as unknown as Record<string, unknown>) };
    let cur: Record<string, unknown> = next;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i];
      const child = cur[k];
      cur[k] = child && typeof child === "object" && !Array.isArray(child) ? { ...(child as object) } : {};
      cur = cur[k] as Record<string, unknown>;
    }
    cur[parts[parts.length - 1]] = val;
    onChange(next);
  };
  const setClosureField = (v: string) => {
    setClosure(v);
    if (onChange) {
      onChange({ ...(doc as unknown as Record<string, unknown>), closure_status: v });
    }
  };
  return (
    <div className="sir-wrapper">
      <FormTopBar stepsLog={stepsLog} onReset={onReset} />
      <div className="sir-form">
        <div className="sir-doc-header">
          <div className="sir-doc-title">시정조치 보고서 (CAR)</div>
          <div className="sir-doc-meta">
            <span>문서번호: {doc.document_number}</span>
            <span className={`sir-risk-badge ${badge}`}>{closure}</span>
          </div>
        </div>

        <div className="sir-section">
          <div className="sir-section-title">1. 연결 문서 정보</div>
          <table className="sir-info-table">
            <tbody>
              <tr><th>연결 NCR</th><td>{lk.ncr_number}</td><th>원본 문서</th><td>{lk.source_doc_type} {lk.source_doc_number}</td></tr>
              <tr><th>발생 위치</th><td>{lk.nc_location}</td><th>관련 공종</th><td>{lk.work_type || "-"}</td></tr>
              <tr><th>조치 담당자</th><td>{lk.action_responsible}</td><th>조치 기한</th><td>{lk.due_date}</td></tr>
            </tbody>
          </table>
        </div>

        <div className="sir-section">
          <div className="sir-section-title">2. 부적합 내용 요약</div>
          <table className="sir-info-table">
            <tbody>
              <tr>
                <th>부적합 항목</th>
                <td><EditCell value={String(nc.nc_item ?? "")} editable={editable} onChange={(v) => setField("nc_summary.nc_item", v)} /></td>
                <th>등급</th>
                <td><EditCell value={String(nc.nc_grade ?? "")} editable={editable} onChange={(v) => setField("nc_summary.nc_grade", v)} /></td>
              </tr>
              <tr>
                <th>요구 기준</th>
                <td><EditCell value={String(nc.required_criterion ?? "")} editable={editable} onChange={(v) => setField("nc_summary.required_criterion", v)} multiline /></td>
                <th>실제 상태</th>
                <td><EditCell value={String(nc.actual_state ?? "")} editable={editable} onChange={(v) => setField("nc_summary.actual_state", v)} multiline /></td>
              </tr>
              <tr>
                <th>부적합 내용</th>
                <td colSpan={3}><EditCell value={String(nc.nc_description ?? "")} editable={editable} onChange={(v) => setField("nc_summary.nc_description", v)} multiline /></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="sir-section">
          <div className="sir-section-title">3. 원인 분석</div>
          <table className="sir-action-table">
            <tbody>
              <tr><th>직접 원인</th><td colSpan={3}><EditCell value={String(c.direct_cause ?? "")} editable={editable} onChange={(v) => setField("cause.direct_cause", v)} multiline /></td></tr>
              <tr><th>근본 원인</th><td colSpan={3}><EditCell value={String(c.root_cause ?? "")} editable={editable} onChange={(v) => setField("cause.root_cause", v)} multiline /></td></tr>
              <tr><th>분석 방법</th><td colSpan={3}>{methods}</td></tr>
            </tbody>
          </table>
        </div>

        <div className="sir-section">
          <div className="sir-section-title">4. 시정조치 계획</div>
          <table className="sir-action-table">
            <tbody>
              <tr><th>조치 내용</th><td colSpan={3}><EditCell value={String(cor.content ?? "")} editable={editable} onChange={(v) => setField("corrective.content", v)} multiline /></td></tr>
              <tr>
                <th>조치 방법</th>
                <td><EditCell value={String(cor.method ?? "")} editable={editable} onChange={(v) => setField("corrective.method", v)} /></td>
                <th>담당자</th>
                <td><EditCell value={String(cor.responsible ?? lk.action_responsible ?? "")} editable={editable} onChange={(v) => setField("corrective.responsible", v)} /></td>
              </tr>
              <tr>
                <th>예정일</th>
                <td><EditCell value={String(cor.planned_date ?? "")} editable={editable} onChange={(v) => setField("corrective.planned_date", v)} /></td>
                <th>완료 예정</th>
                <td><EditCell value={String(cor.completion_due ?? "")} editable={editable} onChange={(v) => setField("corrective.completion_due", v)} /></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="sir-section">
          <div className="sir-section-title">5. 재발방지 대책</div>
          <table className="sir-action-table">
            <tbody>
              <tr><th>대책</th><td colSpan={3}><EditCell value={String(pre.content ?? "")} editable={editable} onChange={(v) => setField("preventive.content", v)} multiline /></td></tr>
              <tr>
                <th>개선 대상</th>
                <td><EditCell value={String(pre.improvement_target ?? "")} editable={editable} onChange={(v) => setField("preventive.improvement_target", v)} /></td>
                <th>교육</th>
                <td>{pre.training_needed} {pre.training_target ? `(${pre.training_target})` : ""}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="sir-section">
          <div className="sir-section-title">6. 조치 실행 결과</div>
          <table className="sir-action-table">
            <tbody>
              <tr>
                <th>조치 기간</th>
                <td>
                  <EditCell value={String(ar.start_date ?? "")} editable={editable} onChange={(v) => setField("action_result.start_date", v)} placeholder="시작일" />
                  {!editable && " ~ "}
                  <EditCell value={String(ar.complete_date ?? "")} editable={editable} onChange={(v) => setField("action_result.complete_date", v)} placeholder="완료일" />
                </td>
                <th>결과</th>
                <td><EditCell value={String(ar.result ?? "")} editable={editable} onChange={(v) => setField("action_result.result", v)} /></td>
              </tr>
              <tr><th>실제 조치</th><td colSpan={3}><EditCell value={String(ar.actual_content ?? "")} editable={editable} onChange={(v) => setField("action_result.actual_content", v)} multiline /></td></tr>
            </tbody>
          </table>
        </div>

        <div className="sir-section">
          <div className="sir-section-title">7. 재검사 및 효과성 검증</div>
          <table className="sir-action-table">
            <tbody>
              <tr>
                <th>재검사 일자</th>
                <td><EditCell value={String(ri.date ?? "")} editable={editable} onChange={(v) => setField("reinspection.date", v)} /></td>
                <th>재검사 결과</th>
                <td><EditCell value={String(ri.result ?? "")} editable={editable} onChange={(v) => setField("reinspection.result", v)} /></td>
              </tr>
              <tr><th>재검사 기준</th><td colSpan={3}><EditCell value={String(ri.criterion ?? "")} editable={editable} onChange={(v) => setField("reinspection.criterion", v)} multiline /></td></tr>
              <tr><th>검증 의견</th><td colSpan={3}><EditCell value={String(ri.opinion ?? "")} editable={editable} onChange={(v) => setField("reinspection.opinion", v)} multiline /></td></tr>
            </tbody>
          </table>
        </div>

        <div className="sir-section">
          <div className="sir-section-title">8. 종결 판정</div>
          <div className="car-closure-edit">
            <label>종결 여부:&nbsp;
              <select value={closure} onChange={(e) => setClosureField(e.target.value)} className="car-closure-select">
                {CLOSURE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
            <span className="car-closure-hint">조치·재검사 완료 후 종결로 변경하세요</span>
          </div>
          <table className="sir-action-table">
            <tbody>
              <tr><th>종결 의견</th><td colSpan={3}><EditCell value={String(doc.closure_opinion ?? "")} editable={editable} onChange={(v) => setField("closure_opinion", v)} multiline /></td></tr>
            </tbody>
          </table>
        </div>

        <SigRow roles={[
          ["조치 담당자", doc.sign_action_responsible || ""], ["품질관리자", doc.sign_quality_manager || ""],
          ["현장대리인", doc.sign_site_manager || ""], ["감리/감독자", doc.sign_supervisor || ""],
        ]} />
      </div>
    </div>
  );
}

/* ── 통합 문서 렌더 라우터 ─────────────────────────────────────────
 * 단일 진실원천(SSOT): doc_type + document_json → A4 폼뷰.
 * DocAutoGen / DocumentDetail / ProgressDashboard 가 모두 이 함수를 공유한다.
 * (이전엔 3곳이 각자 라우팅 → 누락·불일치 버그 발생)
 */

const _s = (v: unknown): string => (v == null ? "" : String(v));

/** 임의 JSON → NCRDocument (직접 발행 NCR 모양 정규화). */
export function coerceNcr(j: Record<string, unknown>): NCRDocument {
  const disp = j.disposition;
  let disposition: string[] = [];
  if (Array.isArray(disp)) disposition = disp.map(String);
  else if (typeof disp === "string" && disp.trim()) disposition = [disp];
  return {
    document_number: _s(j.document_number), reporter: _s(j.reporter), report_date: _s(j.report_date),
    title: _s(j.title), author: _s(j.author), action_department: _s(j.action_department),
    location: _s(j.location), company: _s(j.company), nc_type: _s(j.nc_type),
    attachment: _s(j.attachment), action_manager: _s(j.action_manager), specification: _s(j.specification),
    description: _s(j.description), immediate_action: _s(j.immediate_action), disposition,
    action_responsible: _s(j.action_responsible), action_deadline: _s(j.action_deadline),
    verification: _s(j.verification), completion_date: _s(j.completion_date), notes: _s(j.notes),
  };
}

/** 임의 JSON → SafetyInspectionDocument (안전점검 모양 정규화). */
export function coerceSir(j: Record<string, unknown>): SafetyInspectionDocument {
  const raw = Array.isArray(j.checklist) ? j.checklist : [];
  const checklist = raw.map((row) => {
    const o = row as Record<string, unknown>;
    const st = String(o.status ?? "N/A").toUpperCase();
    const status: "P" | "F" | "N/A" = st === "F" || st === "FAIL" ? "F" : st === "P" || st === "PASS" ? "P" : "N/A";
    return { target: _s(o.target), item_name: _s(o.item_name), status, findings: _s(o.findings) };
  });
  const regs = j.violated_regulations;
  return {
    document_number: _s(j.document_number), construction_name: _s(j.construction_name),
    inspection_date: _s(j.inspection_date), inspector: _s(j.inspector), inspection_zone: _s(j.inspection_zone),
    yolo_detections_summary: _s(j.yolo_detections_summary) || "자동 탐지 결과 없음",
    checklist, photo_guidance: _s(j.photo_guidance),
    violated_regulations: Array.isArray(regs) ? regs.map(String) : [],
    action_deadline: _s(j.action_deadline), action_responsible: _s(j.action_responsible),
    reinspection_opinion: _s(j.reinspection_opinion), risk_level: _s(j.risk_level) || "Medium",
    notes: j.notes != null ? _s(j.notes) : undefined,
  };
}

const _isNcrShape = (j: Record<string, unknown>): boolean =>
  typeof j.document_number === "string" && ("specification" in j || "description" in j || "immediate_action" in j);
const _isSirShape = (j: Record<string, unknown>): boolean => Array.isArray(j.checklist);
const _isDerivedNcrShape = (j: Record<string, unknown>): boolean => "items" in j && "source_document_type" in j;

/**
 * 통합 라우터 — doc_type + json → A4 폼뷰.
 * 구조화 JSON 이 없거나 매칭되는 폼이 없으면 null 반환(호출측이 마크다운 fallback 처리).
 */
export function pickDocumentForm({
  docType,
  json,
  projectName = "현장 미지정",
  stepsLog = [],
  onReset,
  editable = false,
  onChange,
}: {
  docType: string;
  json?: Record<string, unknown> | null;
  projectName?: string;
  stepsLog?: string[];
  onReset?: () => void;
  /** 인라인 편집 모드 — A4 셀이 input/textarea 가 됨. 현재 CAR 에서 1차 구현. */
  editable?: boolean;
  /** 편집 시 호출 — 변경된 document_json 전체를 호출측에 전달. */
  onChange?: (next: Record<string, unknown>) => void;
}): ReactNode | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const ncr = () => (
    <NcrFormView ncr={coerceNcr(json)} stepsLog={stepsLog} projectName={projectName} showPipeline={false} onReset={onReset} />
  );
  const sir = () => <SirFormView sir={coerceSir(json)} stepsLog={stepsLog} showPipeline={false} onReset={onReset} />;
  switch (docType) {
    case "quality_inspect":
      return <QualityFormView doc={json as unknown as QualityInspectionDoc} stepsLog={stepsLog} onReset={onReset} />;
    case "material_check":
      return <MaterialFormView doc={json as unknown as MaterialInspectionDoc} stepsLog={stepsLog} onReset={onReset} />;
    case "car":
      return (
        <CarFormView
          doc={json as unknown as CARDoc}
          stepsLog={stepsLog}
          onReset={onReset}
          editable={editable}
          onChange={onChange as (next: Record<string, unknown>) => void}
        />
      );
    case "proc_daily":
    case "proc_weekly":
    case "proc_monthly":
    case "proc_supervision":
      // 공정관리 보고서 — /schedule 생성뷰와 동일한 ScheduleFormView 로 렌더.
      return <ScheduleFormView doc={json as unknown as ScheduleReportDoc} stepsLog={stepsLog} onReset={onReset} />;
    case "defect_report":
      return _isDerivedNcrShape(json)
        ? <DerivedNcrFormView doc={json as unknown as DerivedNCRDoc} onReset={onReset} />
        : ncr();
    case "safety_inspect":
      return sir();
    default:
      // 레거시/미상 doc_type — payload 형태로 추정
      if (_isDerivedNcrShape(json)) return <DerivedNcrFormView doc={json as unknown as DerivedNCRDoc} onReset={onReset} />;
      if (_isNcrShape(json)) return ncr();
      if (_isSirShape(json)) return sir();
      return null;
  }
}
