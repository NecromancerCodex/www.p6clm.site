"use client";

import { Fragment, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  NCRDocument,
  SafetyInspectionDocument,
  QualityInspectionDoc,
  MaterialInspectionDoc,
  CARDoc,
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

        {/* 5. 관련 기준·근거 / 종합 의견 */}
        <div className="sir-section">
          <div className="sir-section-title">5. 관련 기준·근거 / 종합 의견</div>
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
  return j === "부적합" ? "sir-pf-fail" : j === "적합" ? "sir-pf-pass" : "sir-pf-na";
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
  const badge = doc.judgement === "부적합" ? "sir-risk-high" : "sir-risk-low";
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
          <div className="sir-photo-guidance">{doc.inspection_purpose}</div>
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
            <span className="sir-summary-badge">적합 <strong>{pass}</strong>건 / 부적합 <strong>{fail}</strong>건</span>
          </div>
          <table className="sir-checklist-table">
            <thead>
              <tr><th>검사 항목</th><th>검사 기준</th><th>검사 결과</th><th style={{ width: "8%" }}>판정</th><th>비고</th></tr>
            </thead>
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

        {doc.nonconformities?.length > 0 && (
          <div className="sir-section">
            <div className="sir-section-title">5. 부적합 사항</div>
            {doc.nonconformities.map((nc, i) => (
              <table key={i} className="sir-action-table" style={{ marginBottom: 8 }}>
                <tbody>
                  <tr><th>발생 위치</th><td colSpan={3}>{nc.location}</td></tr>
                  <tr><th>부적합 내용</th><td colSpan={3}>{nc.description}</td></tr>
                  <tr><th>원인</th><td>{nc.cause || "-"}</td><th>관련 사진</th><td>{nc.photo_ref || "-"}</td></tr>
                  <tr><th>조치 필요</th><td colSpan={3}>{nc.required_action}</td></tr>
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
                  <tr key={i}><td>{a.nonconformity}</td><td>{a.action}</td><td>{a.completed}</td><td>{a.reinspection_result}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="sir-section">
          <div className="sir-section-title">7. 종합 의견</div>
          <div className="sir-photo-guidance">{doc.overall_opinion}</div>
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
                  <tr><th>요구 기준</th><td>{nc.required_criterion}</td><th>실제 상태</th><td>{nc.actual_state}</td></tr>
                  <tr><th>부적합 내용</th><td colSpan={3}>{nc.description}</td></tr>
                  <tr><th>임시 조치</th><td>{nc.temporary_action}</td><th>NCR 발행</th><td>{nc.ncr_issued}{nc.ncr_number ? ` (${nc.ncr_number})` : ""}</td></tr>
                </tbody>
              </table>
            ))}
          </div>
        )}

        <div className="sir-section">
          <div className="sir-section-title">7. 검수 의견</div>
          <div className="sir-photo-guidance">{doc.inspection_opinion}</div>
        </div>

        <SigRow roles={[
          ["검수자", doc.inspector_sign || doc.inspector], ["현장대리인", doc.site_manager_sign || ""],
          ["감리/감독자", doc.supervisor_sign || ""], ["협력업체", doc.cooperator_sign || ""],
        ]} />
      </div>
    </div>
  );
}

/* ── 시정조치 보고서 (CAR) A4 뷰 — 종결상태 편집 가능 ────────── */

const CLOSURE_OPTIONS = ["종결", "조건부 종결", "미종결", "추가 조치 필요"];

export function CarFormView({
  doc,
  stepsLog = [],
  onReset,
}: {
  doc: CARDoc;
  stepsLog?: string[];
  onReset?: () => void;
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
              <tr><th>부적합 항목</th><td>{nc.nc_item || "-"}</td><th>등급</th><td>{nc.nc_grade || "-"}</td></tr>
              <tr><th>요구 기준</th><td>{nc.required_criterion || "-"}</td><th>실제 상태</th><td>{nc.actual_state || "-"}</td></tr>
              <tr><th>부적합 내용</th><td colSpan={3}>{nc.nc_description}</td></tr>
            </tbody>
          </table>
        </div>

        <div className="sir-section">
          <div className="sir-section-title">3. 원인 분석</div>
          <table className="sir-action-table">
            <tbody>
              <tr><th>직접 원인</th><td colSpan={3}>{String(c.direct_cause ?? "")}</td></tr>
              <tr><th>근본 원인</th><td colSpan={3}>{String(c.root_cause ?? "")}</td></tr>
              <tr><th>분석 방법</th><td colSpan={3}>{methods}</td></tr>
            </tbody>
          </table>
        </div>

        <div className="sir-section">
          <div className="sir-section-title">4. 시정조치 계획</div>
          <table className="sir-action-table">
            <tbody>
              <tr><th>조치 내용</th><td colSpan={3}>{cor.content}</td></tr>
              <tr><th>조치 방법</th><td>{cor.method}</td><th>담당자</th><td>{cor.responsible || lk.action_responsible}</td></tr>
              <tr><th>예정일</th><td>{cor.planned_date || "-"}</td><th>완료 예정</th><td>{cor.completion_due || "-"}</td></tr>
            </tbody>
          </table>
        </div>

        <div className="sir-section">
          <div className="sir-section-title">5. 재발방지 대책</div>
          <table className="sir-action-table">
            <tbody>
              <tr><th>대책</th><td colSpan={3}>{pre.content}</td></tr>
              <tr><th>개선 대상</th><td>{pre.improvement_target || "-"}</td><th>교육</th><td>{pre.training_needed} {pre.training_target ? `(${pre.training_target})` : ""}</td></tr>
            </tbody>
          </table>
        </div>

        <div className="sir-section">
          <div className="sir-section-title">6. 조치 실행 결과</div>
          <table className="sir-action-table">
            <tbody>
              <tr><th>조치 기간</th><td>{ar.start_date || "예정"} ~ {ar.complete_date || "예정"}</td><th>결과</th><td>{ar.result || "미완료"}</td></tr>
              <tr><th>실제 조치</th><td colSpan={3}>{ar.actual_content || "(조치 진행 시 기재)"}</td></tr>
            </tbody>
          </table>
        </div>

        <div className="sir-section">
          <div className="sir-section-title">7. 재검사 및 효과성 검증</div>
          <table className="sir-action-table">
            <tbody>
              <tr><th>재검사 일자</th><td>{ri.date || "예정"}</td><th>재검사 결과</th><td>{ri.result || "재검사 예정"}</td></tr>
              <tr><th>재검사 기준</th><td colSpan={3}>{ri.criterion || "-"}</td></tr>
              <tr><th>검증 의견</th><td colSpan={3}>{ri.opinion || "-"}</td></tr>
            </tbody>
          </table>
        </div>

        <div className="sir-section">
          <div className="sir-section-title">8. 종결 판정</div>
          <div className="car-closure-edit">
            <label>종결 여부:&nbsp;
              <select value={closure} onChange={(e) => setClosure(e.target.value)} className="car-closure-select">
                {CLOSURE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
            <span className="car-closure-hint">조치·재검사 완료 후 종결로 변경하세요</span>
          </div>
          <table className="sir-action-table">
            <tbody>
              <tr><th>종결 의견</th><td colSpan={3}>{doc.closure_opinion}</td></tr>
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
