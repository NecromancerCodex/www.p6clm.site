"use client";

import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { Message } from "../../stores/chatStore";
import { AssistantTtsButton } from "./AssistantTtsButton";
import { TriggeredJobCard } from "./TriggeredJobCard";

interface MessageBubbleProps {
  message: Message;
}

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
                <p style={{ margin: "0 0 0.7em", lineHeight: 1.7, color: "var(--text)" }}>{children}</p>
              ),
              strong: ({ children }) => (
                <strong style={{ fontWeight: 700, color: "var(--text)" }}>{children}</strong>
              ),
              em: ({ children }) => (
                <em style={{ fontStyle: "italic", color: "var(--muted-strong)" }}>{children}</em>
              ),
              del: ({ children }) => (
                <del style={{ color: "var(--muted)", textDecoration: "line-through" }}>{children}</del>
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
                  style={{ color: "var(--primary)", textDecoration: "underline", textUnderlineOffset: "2px" }}
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
                        background: "rgba(0, 0, 0, 0.06)",
                        color: "var(--text)",
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
                    background: "var(--text)",
                    color: "var(--line)",
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
                    borderLeft: "3px solid var(--primary)",
                    background: "rgba(201, 163, 92, 0.35)",
                    padding: "0.5em 0.9em",
                    margin: "0.55em 0",
                    color: "var(--primary-deep)",
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
                    borderBottom: "1px dashed var(--line-strong)",
                  }}
                />
              ),
              h1: ({ children }) => (
                <h1
                  style={{
                    fontSize: "1.05em",
                    fontWeight: 700,
                    margin: "0.3em 0 0.55em",
                    color: "var(--text)",
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
                    color: "var(--primary-deep)",
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
                    color: "var(--primary-deep)",
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
                    color: "var(--muted-strong)",
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
                    border: "1px solid var(--line)",
                    background: "var(--surface)",
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
                <thead style={{ background: "var(--surface-soft)", color: "var(--text)" }}>{children}</thead>
              ),
              tbody: ({ children }) => <tbody>{children}</tbody>,
              tr: ({ children }) => (
                <tr style={{ borderBottom: "1px solid var(--line)" }}>{children}</tr>
              ),
              th: ({ children, style }) => (
                <th
                  style={{
                    padding: "0.55em 0.75em",
                    textAlign: (style as React.CSSProperties | undefined)?.textAlign ?? "left",
                    fontWeight: 700,
                    color: "var(--primary-deep)",
                    borderBottom: "2px solid var(--line-strong)",
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
                    color: "var(--text)",
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
                    style={{ marginRight: 6, accentColor: "var(--primary)" }}
                  />
                ) : null,
            }}
          >
            {message.content}
          </ReactMarkdown>
        )}
      </div>

      {/* supervisor 가 비동기 doc-generate 를 트리거한 경우 — 진행/완료 상태 카드 */}
      {!isUser && message.triggeredJob && (
        <TriggeredJobCard job={message.triggeredJob} />
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
