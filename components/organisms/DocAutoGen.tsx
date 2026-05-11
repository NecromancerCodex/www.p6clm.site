"use client";

import { useRef } from "react";

import { useDocStore, type NCRDocument, type SafetyInspectionDocument, type CategoryId } from "../../stores/docStore";
import { CategoryTab } from "../molecules/CategoryTab";
import { DocListItem } from "../molecules/DocListItem";
import { Spinner } from "../atoms/Spinner";

/* ── 카테고리 메타데이터 ──────────────────────────────────────── */

const CATEGORIES = [
  {
    id: "design" as CategoryId,
    label: "설계관리",
    icon: "📐",
    color: "blue",
    description: "도면 검토·설계 변경 요청·적합성 확인 문서",
    documents: [
      { id: "design_review", label: "설계 검토 보고서" },
      { id: "design_change", label: "도면 변경 요청서" },
      { id: "design_fit", label: "설계 적합성 검토서" },
    ],
  },
  {
    id: "process" as CategoryId,
    label: "공정관리",
    icon: "📊",
    color: "purple",
    description: "공정 계획·현황·지연 분석 문서",
    documents: [
      { id: "process_plan", label: "공정 계획서" },
      { id: "process_status", label: "공정 현황 보고서" },
      { id: "process_delay", label: "공정 지연 분석서" },
    ],
  },
  {
    id: "construction" as CategoryId,
    label: "시공관리",
    icon: "🏗️",
    color: "amber",
    description: "시공 계획·작업 일보·품질 확인 문서",
    documents: [
      { id: "const_plan", label: "시공 계획서" },
      { id: "daily_report", label: "작업 일보" },
      { id: "const_check", label: "시공 품질 확인서" },
    ],
  },
  {
    id: "quality" as CategoryId,
    label: "품질관리",
    icon: "✅",
    color: "teal",
    description: "품질 검사·자재 검수·부적합 보고 문서",
    documents: [
      { id: "quality_inspect", label: "품질 검사 보고서" },
      { id: "material_check", label: "자재 검수 확인서" },
      { id: "defect_report", label: "부적합 처리 보고서 (NCR)", isNcr: true },
    ],
  },
  {
    id: "safety" as CategoryId,
    label: "안전관리",
    icon: "⛑️",
    color: "red",
    description: "안전 점검·위험성 평가·사고 조사 문서",
    documents: [
      { id: "safety_inspect", label: "정기 안전 점검 보고서" },
      { id: "risk_assess", label: "위험성 평가서" },
      { id: "accident_report", label: "사고 조사 보고서" },
    ],
  },
] as const;

const PIPELINE_STEPS = [
  { key: "orchestrator_node[GPT-5-mini]", label: "GPT 오케스트레이터", icon: "🎯" },
  { key: "yolo_node", label: "YOLO 결함 탐지", icon: "👁" },
  { key: "domain_node[EXAONE]", label: "EXAONE 기술 판정", icon: "🧠" },
  { key: "synthesis_node[GPT-5-mini]", label: "GPT 문서 조립", icon: "✍️" },
];

/* ── 번호 목록 텍스트 렌더러 ──────────────────────────────────── */

function NumberedText({ text }: { text: string }) {
  if (!text) return null;
  // "1) ", "2) ", "* ", "- " 패턴 앞에서 줄 분리
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

/* ── NCR 폼 뷰 ────────────────────────────────────────────────── */

function NcrFormView({
  ncr,
  stepsLog,
  onReset,
}: {
  ncr: NCRDocument;
  stepsLog: string[];
  onReset: () => void;
}) {
  const DISPOSITION_ALL = ["재작업", "폐기", "사용승인", "반품", "기타"] as const;
  const projectName = "POSCO CONSTRUCTION";

  async function copyAsText() {
    const text = `Non-Conformance Report (NCR)\nPROJECT: ${projectName}\n\n문서번호: ${ncr.document_number}   발생자: ${ncr.reporter}   발생일자: ${ncr.report_date}\n제목: ${ncr.title}\n작성자: ${ncr.author}   조치부서: ${ncr.action_department}\n발생위치: ${ncr.location}   업체: ${ncr.company}\nNC 유형: ${ncr.nc_type}   첨부: ${ncr.attachment}\n조치담당자: ${ncr.action_manager}\n\n[요구사항/기준]\n${ncr.specification}\n\n[부적합 내용]\n${ncr.description}\n\n[즉각 조치사항]\n${ncr.immediate_action}\n\n[처분] ${ncr.disposition.join(", ")}\n조치 책임자: ${ncr.action_responsible}   조치기한: ${ncr.action_deadline}\n\n[검증]\n${ncr.verification}\n\n종료일: ${ncr.completion_date}   비고: ${ncr.notes}`.trim();
    await navigator.clipboard.writeText(text);
  }

  return (
    <div className="ncr-wrapper">
      <div className="ncr-top-bar">
        <div className="dag-steps-log">
          {stepsLog.map((s, i) => <span key={i} className="dag-step-badge">✓ {s}</span>)}
        </div>
        <div className="ncr-actions">
          <button className="dag-copy-btn" onClick={copyAsText}>텍스트 복사</button>
          <button className="dag-copy-btn" onClick={() => window.print()}>🖨️ 인쇄</button>
          <button className="dag-reset-btn" onClick={onReset}>다시 선택</button>
        </div>
      </div>
      <div className="ncr-form">
        <div className="ncr-title-row">Non-Conformance Report (NCR)</div>
        <div className="ncr-project-row">
          <span className="ncr-label">PROJECT</span>
          <span className="ncr-value ncr-project-name">{projectName}</span>
        </div>
        <div className="ncr-header-grid">
          <div className="ncr-cell"><span className="ncr-label">문서번호</span><span className="ncr-value">{ncr.document_number}</span></div>
          <div className="ncr-cell"><span className="ncr-label">발생자</span><span className="ncr-value">{ncr.reporter}</span></div>
          <div className="ncr-cell"><span className="ncr-label">발생일자</span><span className="ncr-value">{ncr.report_date}</span></div>
          <div className="ncr-cell ncr-cell-full"><span className="ncr-label">제목</span><span className="ncr-value">{ncr.title}</span></div>
          <div className="ncr-cell"><span className="ncr-label">작성자</span><span className="ncr-value">{ncr.author}</span></div>
          <div className="ncr-cell"><span className="ncr-label">조치부서</span><span className="ncr-value">{ncr.action_department}</span></div>
          <div className="ncr-cell"><span className="ncr-label">발생위치</span><span className="ncr-value">{ncr.location}</span></div>
          <div className="ncr-cell"><span className="ncr-label">업체</span><span className="ncr-value">{ncr.company}</span></div>
          <div className="ncr-cell"><span className="ncr-label">NC 유형</span><span className="ncr-value">{ncr.nc_type}</span></div>
          <div className="ncr-cell"><span className="ncr-label">첨부</span><span className="ncr-value">{ncr.attachment}</span></div>
          <div className="ncr-cell ncr-cell-full"><span className="ncr-label">조치담당자</span><span className="ncr-value">{ncr.action_manager}</span></div>
        </div>
        <div className="ncr-section"><div className="ncr-section-title">요구사항 / 기준 (Specification)</div><div className="ncr-section-body">{ncr.specification}</div></div>
        <div className="ncr-section"><div className="ncr-section-title">부적합 내용 (Description)</div><div className="ncr-section-body ncr-section-tall"><NumberedText text={ncr.description} /></div></div>
        <div className="ncr-section"><div className="ncr-section-title">즉각 조치사항 (Immediate Action)</div><div className="ncr-section-body ncr-section-tall"><NumberedText text={ncr.immediate_action} /></div></div>
        <div className="ncr-section">
          <div className="ncr-section-title">처분 (Disposition)</div>
          <div className="ncr-disposition-row">
            {DISPOSITION_ALL.map((opt) => (
              <label key={opt} className="ncr-checkbox-label">
                <span className={`ncr-checkbox${ncr.disposition.includes(opt) ? " is-checked" : ""}`}>{ncr.disposition.includes(opt) ? "☑" : "□"}</span>
                {opt}
              </label>
            ))}
          </div>
        </div>
        <div className="ncr-two-col">
          <div className="ncr-cell"><span className="ncr-label">조치 책임자</span><span className="ncr-value">{ncr.action_responsible}</span></div>
          <div className="ncr-cell"><span className="ncr-label">조치기한</span><span className="ncr-value">{ncr.action_deadline}</span></div>
        </div>
        <div className="ncr-section"><div className="ncr-section-title">검증 (Verification)</div><div className="ncr-section-body"><NumberedText text={ncr.verification} /></div></div>
        <div className="ncr-two-col">
          <div className="ncr-cell"><span className="ncr-label">종료일</span><span className="ncr-value">{ncr.completion_date || "-"}</span></div>
          <div className="ncr-cell"><span className="ncr-label">비고</span><span className="ncr-value">{ncr.notes || ""}</span></div>
        </div>
      </div>
    </div>
  );
}

/* ── SIR 폼 뷰 (표준 양식 4-Section) ─────────────────────────── */

function SirFormView({
  sir,
  stepsLog,
  onReset,
}: {
  sir: SafetyInspectionDocument;
  stepsLog: string[];
  onReset: () => void;
}) {
  const failItems = sir.checklist.filter((c) => c.status === "F");
  const passItems = sir.checklist.filter((c) => c.status === "P");
  const riskClass =
    sir.risk_level === "Critical" ? "sir-risk-critical"
    : sir.risk_level === "High" || sir.risk_level === "high" ? "sir-risk-high"
    : sir.risk_level === "Medium" || sir.risk_level === "medium" ? "sir-risk-medium"
    : "sir-risk-low";

  async function copyAsText() {
    const rows = sir.checklist.map(
      (c) => `  [${c.status}] ${c.target} — ${c.item_name}: ${c.findings}`
    ).join("\n");
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
        <div className="dag-steps-log">
          {stepsLog.map((s, i) => <span key={i} className="dag-step-badge">✓ {s}</span>)}
        </div>
        <div className="ncr-actions">
          <button className="dag-copy-btn" onClick={copyAsText}>텍스트 복사</button>
          <button className="dag-copy-btn" onClick={() => window.print()}>🖨️ 인쇄</button>
          <button className="dag-reset-btn" onClick={onReset}>다시 선택</button>
        </div>
      </div>

      <div className="sir-form">
        {/* 헤더 */}
        <div className="sir-doc-header">
          <div className="sir-doc-title">정기 안전 점검 보고서</div>
          <div className="sir-doc-meta">
            <span>문서번호: {sir.document_number}</span>
            <span className={`sir-risk-badge ${riskClass}`}>{sir.risk_level}</span>
          </div>
        </div>

        {/* Section 1: 점검 기본 정보 */}
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

        {/* Section 2: 체크리스트 */}
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
                <th style={{width: "13%"}}>점검 대상</th>
                <th style={{width: "28%"}}>점검 항목 (Checklist)</th>
                <th style={{width: "8%"}}>상태 (P/F)</th>
                <th>지적 및 조치 요구 사항</th>
              </tr>
            </thead>
            <tbody>
              {sir.checklist.map((item, i) => (
                <tr key={i} className={item.status === "F" ? "sir-row-fail" : item.status === "P" ? "sir-row-pass" : ""}>
                  <td className="sir-target-cell">{item.target}</td>
                  <td>{item.item_name}</td>
                  <td className={`sir-pf-cell ${item.status === "F" ? "sir-pf-fail" : item.status === "P" ? "sir-pf-pass" : "sir-pf-na"}`}>
                    {item.status}
                  </td>
                  <td className="sir-findings-cell">{item.findings}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Section 3: 현장 사진 */}
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

        {/* Section 4: 조치 계획 */}
        <div className="sir-section">
          <div className="sir-section-title">4. 조치 계획 및 확인</div>
          {sir.violated_regulations.length > 0 && (
            <div className="sir-regulation-box">
              <span className="sir-reg-label">위반 법령</span>
              <ul className="sir-reg-list">
                {sir.violated_regulations.map((r, i) => <li key={i}>{r}</li>)}
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
                <td colSpan={3} className="sir-opinion-cell">{sir.reinspection_opinion}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* 서명란 */}
        <div className="sir-sig-row">
          <div className="sir-sig-box">
            <div className="sir-sig-title">점검자</div>
            <div className="sir-sig-area"></div>
            <div className="sir-sig-name">{sir.inspector}</div>
          </div>
          <div className="sir-sig-box">
            <div className="sir-sig-title">확인자</div>
            <div className="sir-sig-area"></div>
            <div className="sir-sig-name">(서명)</div>
          </div>
          <div className="sir-sig-box">
            <div className="sir-sig-title">승인</div>
            <div className="sir-sig-area"></div>
            <div className="sir-sig-name">(서명)</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 메인 Organism ────────────────────────────────────────────── */

export function DocAutoGen() {
  const activeCat    = useDocStore((s) => s.activeCat);
  const activeDoc    = useDocStore((s) => s.activeDoc);
  const context      = useDocStore((s) => s.context);
  const status       = useDocStore((s) => s.status);
  const ncrResult    = useDocStore((s) => s.ncrResult);
  const sirResult    = useDocStore((s) => s.sirResult);
  const rawResult    = useDocStore((s) => s.rawResult);
  const errorMsg     = useDocStore((s) => s.errorMsg);
  const imageFile    = useDocStore((s) => s.imageFile);
  const imagePreview = useDocStore((s) => s.imagePreview);
  const stepsLog     = useDocStore((s) => s.stepsLog);

  const setActiveCat = useDocStore((s) => s.setActiveCat);
  const setActiveDoc = useDocStore((s) => s.setActiveDoc);
  const setContext   = useDocStore((s) => s.setContext);
  const setImage     = useDocStore((s) => s.setImage);
  const clearImage   = useDocStore((s) => s.clearImage);
  const reset        = useDocStore((s) => s.reset);
  const generate     = useDocStore((s) => s.generate);

  const fileRef = useRef<HTMLInputElement>(null);

  const category = CATEGORIES.find((c) => c.id === activeCat)!;
  const docMeta = category.documents.find((d) => d.id === activeDoc) as
    | { id: string; label: string; isNcr?: boolean } | undefined;
  const isNcr = !!(docMeta as any)?.isNcr;
  const isBusy = status === "submitting" || status === "polling";

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => setImage(f, ev.target?.result as string);
    reader.readAsDataURL(f);
  }

  return (
    <section className="dag-section">
      {/* 헤더 */}
      <div className="dag-header">
        <div>
          <p className="panel-eyebrow">AI 문서 자동 작성</p>
          <h2>카테고리를 선택하고 문서를 생성하세요</h2>
          <p className="dag-desc">에이전트가 현장 사진과 정보를 분석하여 공식 문서를 자동 작성합니다.</p>
        </div>
        <span className="dag-ai-badge">AI Agent</span>
      </div>

      <div className="dag-body">
        {/* 카테고리 탭 */}
        <div className="dag-cat-row">
          {CATEGORIES.map((cat) => (
            <CategoryTab
              key={cat.id}
              id={cat.id}
              label={cat.label}
              icon={cat.icon}
              color={cat.color}
              active={activeCat === cat.id}
              onClick={() => setActiveCat(cat.id)}
            />
          ))}
        </div>

        <div className="dag-layout">
          {/* 왼쪽: 문서 목록 + 입력 */}
          <div className="dag-left">
            <p className="dag-left-desc">{category.description}</p>
            <ul className="dag-doc-list">
              {category.documents.map((doc) => (
                <DocListItem
                  key={doc.id}
                  id={doc.id}
                  label={doc.label}
                  isNcr={"isNcr" in doc ? (doc as any).isNcr : false}
                  active={activeDoc === doc.id}
                  onClick={() => setActiveDoc(doc.id)}
                />
              ))}
            </ul>

            {activeDoc && (
              <div className="dag-context-area">
                {/* 이미지 업로드 */}
                <div className="dag-upload-block">
                  <label className="dag-context-label">
                    현장 사진
                    {isNcr
                      ? <span className="dag-label-required"> 📸 사진만으로 NCR 자동 작성 가능</span>
                      : <span>(선택 — 이미지 분석으로 정확도 향상)</span>
                    }
                  </label>
                  <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleImageChange} />
                  {imagePreview ? (
                    <div className="dag-image-preview">
                      <img src={imagePreview} alt="현장 사진 미리보기" />
                      <button className="dag-image-remove" onClick={() => { clearImage(); if (fileRef.current) fileRef.current.value = ""; }}>✕ 제거</button>
                    </div>
                  ) : (
                    <button className="dag-upload-btn" onClick={() => fileRef.current?.click()}>📷 사진 첨부</button>
                  )}
                </div>

                <label className="dag-context-label" htmlFor="dag-context">
                  추가 현장 정보 <span>(선택 — 미입력 시 사진에서 자동 추출)</span>
                </label>
                {isNcr && imageFile && !context && (
                  <div className="dag-image-hint">✦ 사진이 첨부되었습니다. 텍스트 없이 바로 생성하면 AI가 사진을 분석하여 NCR을 자동 작성합니다.</div>
                )}
                <textarea
                  id="dag-context"
                  className="dag-context-input"
                  placeholder={isNcr ? "예: B동 3층 기둥 배근 간격 불량... (미입력 시 사진으로 자동 분석)" : "예: 현장 상황을 입력하세요..."}
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  rows={3}
                  disabled={isBusy}
                />
                <button className={`dag-gen-btn${isBusy ? " is-loading" : ""}`} onClick={generate} disabled={isBusy}>
                  {status === "submitting" ? <><Spinner size="sm" />요청 전송 중...</>
                   : status === "polling"   ? <><Spinner size="sm" />AI 분석 중...</>
                   : <>✦ 문서 생성</>}
                </button>
              </div>
            )}
          </div>

          {/* 오른쪽: 결과 패널 */}
          <div className="dag-right">
            {!activeDoc && (
              <div className="dag-empty">
                <span className="dag-empty-icon">🤖</span>
                <p>생성할 문서 유형을 선택하세요</p>
                <small>현장 사진을 첨부하면 AI가 이미지를 분석하여 더 정확한 문서를 작성합니다.</small>
              </div>
            )}

            {activeDoc && status === "idle" && (
              <div className="dag-ready">
                <p className="dag-ready-title">선택된 문서</p>
                <strong>{docMeta?.label}</strong>
                {isNcr && <p className="dag-ready-hint dag-ncr-hint">📋 현장 사진을 첨부하면 AI가 이미지를 분석하여 부적합 내용·즉각 조치사항을 자동으로 작성합니다.</p>}
                {!isNcr && <p className="dag-ready-hint">현장 정보를 입력하거나 바로 생성 버튼을 눌러주세요.</p>}
              </div>
            )}

            {isBusy && (
              <div className="dag-skeleton-wrap">
                <div className="dag-pipeline">
                  {PIPELINE_STEPS.map((step, idx) => {
                    const done = stepsLog.some((s) => s.includes(step.key.split("[")[0]));
                    const active = !done && idx === stepsLog.length;
                    return (
                      <div key={step.key} className={`dag-pipe-step${done ? " done" : active ? " active" : ""}`}>
                        <div className="dag-pipe-icon">{done ? "✓" : active ? <Spinner size="sm" /> : step.icon}</div>
                        <span>{step.label}</span>
                      </div>
                    );
                  })}
                </div>
                {isNcr ? (
                  <div className="dag-skel-ncr">
                    <div className="dag-skel-title" />
                    <div className="dag-skel-row"><div className="dag-skel-cell" /><div className="dag-skel-cell" /><div className="dag-skel-cell" /></div>
                    <div className="dag-skel-row"><div className="dag-skel-cell dag-skel-wide" /></div>
                    <div className="dag-skel-block" /><div className="dag-skel-block dag-skel-tall" /><div className="dag-skel-block dag-skel-tall" />
                    <div className="dag-skel-row">{["재작업","폐기","사용승인","반품","기타"].map((d) => <div key={d} className="dag-skel-chip" />)}</div>
                    <div className="dag-skel-block" />
                  </div>
                ) : (
                  <div className="dag-skel-general">
                    <div className="dag-skel-title" /><div className="dag-skel-block" /><div className="dag-skel-block dag-skel-tall" /><div className="dag-skel-block" />
                  </div>
                )}
              </div>
            )}

            {status === "error" && (
              <div className="dag-error">
                <p>오류: {errorMsg}</p>
                <button className="dag-reset-btn" onClick={reset}>다시 시도</button>
              </div>
            )}

            {status === "done" && ncrResult && (
              <NcrFormView ncr={ncrResult} stepsLog={stepsLog} onReset={reset} />
            )}

            {status === "done" && sirResult && (
              <SirFormView sir={sirResult} stepsLog={stepsLog} onReset={reset} />
            )}

            {status === "done" && rawResult && !ncrResult && !sirResult && (
              <div className="dag-result">
                <div className="dag-result-header">
                  <div>
                    <p className="dag-result-label">생성 완료</p>
                    <strong className="dag-result-title">{docMeta?.label}</strong>
                  </div>
                  <div className="dag-result-actions">
                    <button className="dag-copy-btn" onClick={() => navigator.clipboard.writeText(rawResult)}>복사</button>
                    <button className="dag-reset-btn" onClick={reset}>다시 선택</button>
                  </div>
                </div>
                {stepsLog.length > 0 && (
                  <div className="dag-steps-log">
                    {stepsLog.map((s, i) => <span key={i} className="dag-step-badge">✓ {s}</span>)}
                  </div>
                )}
                <pre className="dag-result-body">{rawResult}</pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
