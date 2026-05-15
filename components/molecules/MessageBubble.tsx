"use client";

import Image from "next/image";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { Message } from "../../stores/chatStore";
import { AssistantTtsButton } from "./AssistantTtsButton";

interface MessageBubbleProps {
  message: Message;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  design_review:   "설계 검토 보고서",
  design_change:   "도면 변경 요청서",
  design_fit:      "설계 적합성 검토서",
  process_plan:    "공정 계획서",
  process_status:  "공정 현황 보고서",
  process_delay:   "공정 지연 분석서",
  const_plan:      "시공 계획서",
  daily_report:    "작업 일보",
  const_check:     "시공 품질 확인서",
  quality_inspect: "품질 검사 보고서",
  material_check:  "자재 검수 확인서",
  defect_report:   "부적합 처리 보고서 (NCR)",
  safety_inspect:  "정기 안전 점검 보고서",
  risk_assess:     "위험성 평가서",
  accident_report: "사고 조사 보고서",
};

const CATEGORY_LABELS: Record<string, string> = {
  design:       "설계관리",
  process:      "공정관리",
  construction: "시공관리",
  quality:      "품질관리",
  safety:       "안전관리",
};

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div className={`cbot-msg-row ${message.role}`}>
      {/* 사용자 첨부 이미지 */}
      {isUser && message.imageUrl && (
        <div className={`cbot-bubble ${message.role} cbot-bubble-image-wrap`}>
          <Image
            src={message.imageUrl}
            alt="첨부 이미지"
            width={280}
            height={200}
            className="cbot-user-image"
            style={{ objectFit: "cover", borderRadius: 8, display: "block" }}
            unoptimized
          />
        </div>
      )}

      {/* 텍스트 버블 */}
      <div className={`cbot-bubble ${message.role}${!isUser ? " cbot-bubble-with-tts" : ""}`}>
        {!isUser && (
          <div className="cbot-assist-toolbar">
            <AssistantTtsButton markdown={message.content} />
          </div>
        )}
        {isUser ? (
          message.content
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => (
                <p style={{ margin: "0 0 0.7em", lineHeight: 1.7, color: "#1f2937" }}>{children}</p>
              ),
              strong: ({ children }) => (
                <strong style={{ fontWeight: 700, color: "#0f172a" }}>{children}</strong>
              ),
              em: ({ children }) => (
                <em style={{ fontStyle: "italic", color: "#374151" }}>{children}</em>
              ),
              del: ({ children }) => (
                <del style={{ color: "#9ca3af", textDecoration: "line-through" }}>{children}</del>
              ),
              ul: ({ children }) => (
                <ul style={{ paddingLeft: "1.4em", margin: "0.35em 0 0.75em" }}>{children}</ul>
              ),
              ol: ({ children }) => (
                <ol style={{ paddingLeft: "1.6em", margin: "0.35em 0 0.75em" }}>{children}</ol>
              ),
              li: ({ children }) => (
                <li style={{ marginBottom: "0.35em", lineHeight: 1.7 }}>{children}</li>
              ),
              a: ({ href, children }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#2563eb", textDecoration: "underline", textUnderlineOffset: "2px" }}
                >
                  {children}
                </a>
              ),
              code: ({ children, ...props }) => {
                const inline = !(props as { className?: string }).className;
                if (inline) {
                  return (
                    <code
                      style={{
                        background: "rgba(15, 23, 42, 0.06)",
                        color: "#0f172a",
                        borderRadius: 4,
                        padding: "1px 6px",
                        fontSize: "0.88em",
                        fontFamily:
                          "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
                      }}
                    >
                      {children}
                    </code>
                  );
                }
                return <code>{children}</code>;
              },
              pre: ({ children }) => (
                <pre
                  style={{
                    background: "#0f172a",
                    color: "#e2e8f0",
                    padding: "0.85em 1em",
                    borderRadius: 8,
                    fontSize: "0.85em",
                    overflowX: "auto",
                    margin: "0.6em 0 0.8em",
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
                  }}
                >
                  {children}
                </pre>
              ),
              blockquote: ({ children }) => (
                <blockquote
                  style={{
                    borderLeft: "3px solid #93c5fd",
                    background: "rgba(219, 234, 254, 0.35)",
                    padding: "0.5em 0.9em",
                    margin: "0.55em 0",
                    color: "#1e3a8a",
                    borderRadius: "0 6px 6px 0",
                  }}
                >
                  {children}
                </blockquote>
              ),
              hr: () => (
                <div
                  style={{
                    margin: "1em 0 0.9em",
                    borderTop: "none",
                    borderBottom: "1px dashed #cbd5e1",
                  }}
                />
              ),
              h1: ({ children }) => (
                <h1
                  style={{
                    fontSize: "1.05em",
                    fontWeight: 700,
                    margin: "0.3em 0 0.55em",
                    color: "#0f172a",
                  }}
                >
                  {children}
                </h1>
              ),
              h2: ({ children }) => (
                <h2
                  style={{
                    fontSize: "0.98em",
                    fontWeight: 700,
                    margin: "0.55em 0 0.4em",
                    color: "#0f3a66",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.35em",
                  }}
                >
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <h3
                  style={{
                    fontSize: "0.92em",
                    fontWeight: 700,
                    margin: "0.55em 0 0.3em",
                    color: "#1d4ed8",
                  }}
                >
                  {children}
                </h3>
              ),
              h4: ({ children }) => (
                <h4
                  style={{
                    fontSize: "0.88em",
                    fontWeight: 600,
                    margin: "0.45em 0 0.25em",
                    color: "#334155",
                  }}
                >
                  {children}
                </h4>
              ),
              /* GFM 표 — 가독성 있는 카드형 */
              table: ({ children }) => (
                <div
                  style={{
                    overflowX: "auto",
                    margin: "0.7em 0 0.9em",
                    borderRadius: 8,
                    border: "1px solid #e2e8f0",
                    background: "#ffffff",
                  }}
                >
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: "0.88em",
                      lineHeight: 1.55,
                    }}
                  >
                    {children}
                  </table>
                </div>
              ),
              thead: ({ children }) => (
                <thead style={{ background: "#f1f5f9", color: "#0f172a" }}>{children}</thead>
              ),
              tbody: ({ children }) => <tbody>{children}</tbody>,
              tr: ({ children }) => (
                <tr style={{ borderBottom: "1px solid #e2e8f0" }}>{children}</tr>
              ),
              th: ({ children, style }) => (
                <th
                  style={{
                    padding: "0.55em 0.75em",
                    textAlign: (style as React.CSSProperties | undefined)?.textAlign ?? "left",
                    fontWeight: 700,
                    color: "#0f3a66",
                    borderBottom: "2px solid #cbd5e1",
                    whiteSpace: "nowrap",
                  }}
                >
                  {children}
                </th>
              ),
              td: ({ children, style }) => (
                <td
                  style={{
                    padding: "0.5em 0.75em",
                    verticalAlign: "top",
                    color: "#1f2937",
                    textAlign: (style as React.CSSProperties | undefined)?.textAlign ?? "left",
                  }}
                >
                  {children}
                </td>
              ),
              /* GFM 체크박스(task list) */
              input: ({ checked, type }) =>
                type === "checkbox" ? (
                  <input
                    type="checkbox"
                    checked={!!checked}
                    readOnly
                    style={{ marginRight: 6, accentColor: "#2563eb" }}
                  />
                ) : null,
            }}
          >
            {message.content}
          </ReactMarkdown>
        )}
      </div>

      {/* supervisor가 비동기 doc-generate를 트리거한 경우 — 진행도 링크 카드 */}
      {!isUser && message.triggeredJob && (
        <Link
          href="/progress"
          className="cbot-job-card"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            marginTop: 8,
            padding: "10px 14px",
            border: "1px solid #c7d2fe",
            background: "linear-gradient(180deg,#eef2ff 0%,#e0e7ff 100%)",
            borderRadius: 10,
            textDecoration: "none",
            color: "#1e3a8a",
            fontSize: "0.9em",
            fontWeight: 600,
            maxWidth: 460,
          }}
        >
          <span aria-hidden style={{ fontSize: "1.1em" }}>📝</span>
          <span style={{ flex: 1, lineHeight: 1.4 }}>
            <span style={{ display: "block" }}>
              {DOC_TYPE_LABELS[message.triggeredJob.doc_type] ?? message.triggeredJob.doc_type} 작성 중
            </span>
            <span style={{ display: "block", fontWeight: 400, color: "#475569", fontSize: "0.88em" }}>
              /progress → {CATEGORY_LABELS[message.triggeredJob.doc_category] ?? message.triggeredJob.doc_category} 탭에서 확인
            </span>
          </span>
          <span style={{ color: "#1e40af", fontSize: "0.85em" }}>→</span>
        </Link>
      )}
    </div>
  );
}

export function ThinkingBubble() {
  return (
    <div className="cbot-msg-row assistant">
      <div className="cbot-bubble thinking">
        <span className="cbot-dot" />
        <span className="cbot-dot" />
        <span className="cbot-dot" />
      </div>
    </div>
  );
}
