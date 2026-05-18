"use client";

import { Fragment } from "react";
import type { NCRDocument, SafetyInspectionDocument } from "../../stores/docStore";

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
  projectName = "POSCO CONSTRUCTION",
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
