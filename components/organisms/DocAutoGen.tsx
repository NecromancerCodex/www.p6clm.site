"use client";

import { useRef } from "react";

import { useDocStore } from "../../stores/docStore";
import { DOC_CATEGORIES } from "../../lib/docCategories";
import { CategoryTab } from "../molecules/CategoryTab";
import { DocListItem } from "../molecules/DocListItem";
import { Spinner } from "../atoms/Spinner";
import { NcrFormView, SirFormView } from "../documents/DocumentFormViews";

const PIPELINE_STEPS = [
  { key: "orchestrator_node[GPT-5-mini]", label: "GPT 오케스트레이터", icon: "🎯" },
  { key: "yolo_node", label: "YOLO 결함 탐지", icon: "👁" },
  { key: "domain_node[GPT-5-mini]", label: "도메인·규범 판정", icon: "🧠" },
  { key: "synthesis_node[GPT-5-mini]", label: "GPT 문서 조립", icon: "✍️" },
] as const;

/* ── 메인 Organism ────────────────────────────────────────────── */

export function DocAutoGen() {
  const activeCat = useDocStore((s) => s.activeCat);
  const activeDoc = useDocStore((s) => s.activeDoc);
  const context = useDocStore((s) => s.context);
  const status = useDocStore((s) => s.status);
  const ncrResult = useDocStore((s) => s.ncrResult);
  const sirResult = useDocStore((s) => s.sirResult);
  const rawResult = useDocStore((s) => s.rawResult);
  const errorMsg = useDocStore((s) => s.errorMsg);
  const imageFile = useDocStore((s) => s.imageFile);
  const imagePreview = useDocStore((s) => s.imagePreview);
  const stepsLog = useDocStore((s) => s.stepsLog);
  const judgement = useDocStore((s) => s.judgement);
  const nonconformityDetected = useDocStore((s) => s.nonconformityDetected);
  const derivedNcr = useDocStore((s) => s.derivedNcr);
  const carStatus = useDocStore((s) => s.carStatus);
  const carRaw = useDocStore((s) => s.carRaw);
  const generateCar = useDocStore((s) => s.generateCar);

  const setActiveCat = useDocStore((s) => s.setActiveCat);
  const setActiveDoc = useDocStore((s) => s.setActiveDoc);
  const setContext = useDocStore((s) => s.setContext);
  const setImage = useDocStore((s) => s.setImage);
  const clearImage = useDocStore((s) => s.clearImage);
  const reset = useDocStore((s) => s.reset);
  const generate = useDocStore((s) => s.generate);

  const fileRef = useRef<HTMLInputElement>(null);

  const category = DOC_CATEGORIES.find((c) => c.id === activeCat)!;
  const docMeta = category.documents.find((d) => d.id === activeDoc) as
    | { id: string; label: string; isNcr?: boolean }
    | undefined;
  const isNcr = !!(docMeta as { isNcr?: boolean })?.isNcr;
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
      <div className="dag-header">
        <div>
          <p className="panel-eyebrow">AI 문서 자동 작성</p>
          <h2>카테고리를 선택하고 문서를 생성하세요</h2>
          <p className="dag-desc">에이전트가 현장 사진과 정보를 분석하여 공식 문서를 자동 작성합니다.</p>
        </div>
        <span className="dag-ai-badge">AI Agent</span>
      </div>

      <div className="dag-body">
        <div className="dag-cat-row">
          {DOC_CATEGORIES.map((cat) => (
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
          <div className="dag-left">
            <p className="dag-left-desc">{category.description}</p>
            <ul className="dag-doc-list">
              {/* 파생 문서(CAR)는 생성 폼에서 숨김 — NCR 결과의 [CAR 생성] 버튼으로만 생성 */}
              {category.documents
                .filter((doc) => !("derived" in doc && (doc as { derived?: boolean }).derived))
                .map((doc) => (
                  <DocListItem
                    key={doc.id}
                    id={doc.id}
                    label={doc.label}
                    isNcr={"isNcr" in doc ? (doc as { isNcr?: boolean }).isNcr : false}
                    active={activeDoc === doc.id}
                    onClick={() => setActiveDoc(doc.id)}
                  />
                ))}
            </ul>

            {activeDoc && (
              <div className="dag-context-area">
                <div className="dag-upload-block">
                  <label className="dag-context-label">
                    현장 사진
                    {isNcr ? (
                      <span className="dag-label-required"> 📸 사진만으로 NCR 자동 작성 가능</span>
                    ) : (
                      <span>(선택 — 이미지 분석으로 정확도 향상)</span>
                    )}
                  </label>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={handleImageChange}
                  />
                  {imagePreview ? (
                    <div className="dag-image-preview">
                      <img src={imagePreview} alt="현장 사진 미리보기" />
                      <button
                        type="button"
                        className="dag-image-remove"
                        onClick={() => {
                          clearImage();
                          if (fileRef.current) fileRef.current.value = "";
                        }}
                      >
                        ✕ 제거
                      </button>
                    </div>
                  ) : (
                    <button type="button" className="dag-upload-btn" onClick={() => fileRef.current?.click()}>
                      📷 사진 첨부
                    </button>
                  )}
                </div>

                <label className="dag-context-label" htmlFor="dag-context">
                  추가 현장 정보 <span>(선택 — 미입력 시 사진에서 자동 추출)</span>
                </label>
                {isNcr && imageFile && !context && (
                  <div className="dag-image-hint">
                    ✦ 사진이 첨부되었습니다. 텍스트 없이 바로 생성하면 AI가 사진을 분석하여 NCR을 자동 작성합니다.
                  </div>
                )}
                <textarea
                  id="dag-context"
                  className="dag-context-input"
                  placeholder={
                    isNcr
                      ? "예: B동 3층 기둥 배근 간격 불량... (미입력 시 사진으로 자동 분석)"
                      : "예: 현장 상황을 입력하세요..."
                  }
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  rows={3}
                  disabled={isBusy}
                />
                <button
                  type="button"
                  className={`dag-gen-btn${isBusy ? " is-loading" : ""}`}
                  onClick={() => void generate()}
                  disabled={isBusy}
                >
                  {status === "submitting" ? (
                    <>
                      <Spinner size="sm" />
                      요청 전송 중...
                    </>
                  ) : status === "polling" ? (
                    <>
                      <Spinner size="sm" />
                      AI 분석 중...
                    </>
                  ) : (
                    <>✦ 문서 생성</>
                  )}
                </button>
              </div>
            )}
          </div>

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
                {isNcr && (
                  <p className="dag-ready-hint dag-ncr-hint">
                    📋 현장 사진을 첨부하면 AI가 이미지를 분석하여 부적합 내용·즉각 조치사항을 자동으로 작성합니다.
                  </p>
                )}
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
                        <div className="dag-pipe-icon">
                          {done ? "✓" : active ? <Spinner size="sm" /> : step.icon}
                        </div>
                        <span>{step.label}</span>
                      </div>
                    );
                  })}
                </div>
                {isNcr ? (
                  <div className="dag-skel-ncr">
                    <div className="dag-skel-title" />
                    <div className="dag-skel-row">
                      <div className="dag-skel-cell" />
                      <div className="dag-skel-cell" />
                      <div className="dag-skel-cell" />
                    </div>
                    <div className="dag-skel-row">
                      <div className="dag-skel-cell dag-skel-wide" />
                    </div>
                    <div className="dag-skel-block" />
                    <div className="dag-skel-block dag-skel-tall" />
                    <div className="dag-skel-block dag-skel-tall" />
                    <div className="dag-skel-row">
                      {["재작업", "폐기", "사용승인", "반품", "기타"].map((d) => (
                        <div key={d} className="dag-skel-chip" />
                      ))}
                    </div>
                    <div className="dag-skel-block" />
                  </div>
                ) : (
                  <div className="dag-skel-general">
                    <div className="dag-skel-title" />
                    <div className="dag-skel-block" />
                    <div className="dag-skel-block dag-skel-tall" />
                    <div className="dag-skel-block" />
                  </div>
                )}
              </div>
            )}

            {status === "error" && (
              <div className="dag-error">
                <p>오류: {errorMsg}</p>
                <button type="button" className="dag-reset-btn" onClick={reset}>
                  다시 시도
                </button>
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
                    <button
                      type="button"
                      className="dag-copy-btn"
                      onClick={() => void navigator.clipboard.writeText(rawResult)}
                    >
                      복사
                    </button>
                    <button type="button" className="dag-reset-btn" onClick={reset}>
                      다시 선택
                    </button>
                  </div>
                </div>
                {stepsLog.length > 0 && (
                  <div className="dag-steps-log">
                    {stepsLog.map((s, i) => (
                      <span key={i} className="dag-step-badge">
                        ✓ {s}
                      </span>
                    ))}
                  </div>
                )}

                {/* 품질/자재 검수 판정 — 적합/부적합 배지 */}
                {judgement && (
                  <div className={`dag-judgement ${nonconformityDetected ? "is-fail" : "is-pass"}`}>
                    <strong>AI 추천 판정: {judgement}</strong>
                    {nonconformityDetected ? (
                      <span> ⚠️ 부적합 — NCR이 자동 발행되었습니다 (최종 판정은 품질관리자 확정)</span>
                    ) : (
                      <span> ✅ 적합 — 최상위 문서로 완료 (NCR 불필요)</span>
                    )}
                  </div>
                )}

                <pre className="dag-result-body">{rawResult}</pre>

                {/* 부적합 → 자동 파생 NCR + [CAR 생성] */}
                {nonconformityDetected && derivedNcr && (
                  <div className="dag-derived-ncr">
                    <p className="dag-result-label">자동 발행된 NCR</p>
                    <strong>{String((derivedNcr as Record<string, unknown>).ncr_number ?? "NCR")}</strong>
                    <p className="dag-ncr-desc">{String((derivedNcr as Record<string, unknown>).description ?? "")}</p>
                    {carStatus === "done" && carRaw ? (
                      <div className="dag-car-result">
                        <p className="dag-result-label">시정조치 보고서 (CAR)</p>
                        <pre className="dag-result-body">{carRaw}</pre>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className={`dag-gen-btn${carStatus === "submitting" || carStatus === "polling" ? " is-loading" : ""}`}
                        onClick={() => void generateCar(derivedNcr as Record<string, unknown>)}
                        disabled={carStatus === "submitting" || carStatus === "polling"}
                      >
                        {carStatus === "submitting" || carStatus === "polling" ? (
                          <>
                            <Spinner size="sm" />
                            CAR 생성 중...
                          </>
                        ) : (
                          <>✦ CAR 생성 (시정조치 보고서)</>
                        )}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
