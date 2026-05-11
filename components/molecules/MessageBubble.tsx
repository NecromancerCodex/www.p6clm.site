"use client";

import Image from "next/image";
import ReactMarkdown from "react-markdown";

import type { Message } from "../../stores/chatStore";

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
      <div className={`cbot-bubble ${message.role}`}>
        {isUser ? (
          message.content
        ) : (
          <ReactMarkdown
            components={{
              p: ({ children }) => <p style={{ margin: "0 0 0.6em", lineHeight: 1.65 }}>{children}</p>,
              strong: ({ children }) => <strong style={{ fontWeight: 700 }}>{children}</strong>,
              ul: ({ children }) => <ul style={{ paddingLeft: "1.4em", margin: "0.3em 0 0.6em" }}>{children}</ul>,
              ol: ({ children }) => <ol style={{ paddingLeft: "1.4em", margin: "0.3em 0 0.6em" }}>{children}</ol>,
              li: ({ children }) => <li style={{ marginBottom: "0.3em", lineHeight: 1.6 }}>{children}</li>,
              code: ({ children }) => (
                <code style={{
                  background: "rgba(0,0,0,0.07)",
                  borderRadius: 3,
                  padding: "1px 5px",
                  fontSize: "0.87em",
                  fontFamily: "monospace",
                }}>
                  {children}
                </code>
              ),
              blockquote: ({ children }) => (
                <blockquote style={{
                  borderLeft: "3px solid #d0d0d0",
                  paddingLeft: "0.9em",
                  margin: "0.5em 0",
                  color: "#666",
                  fontStyle: "italic",
                }}>
                  {children}
                </blockquote>
              ),
              hr: () => (
                <div style={{
                  margin: "1em 0 0.8em",
                  borderTop: "none",
                  borderBottom: "2px solid #e8eef6",
                }} />
              ),
              h2: ({ children }) => (
                <h2 style={{
                  fontSize: "0.95em",
                  fontWeight: 700,
                  margin: "0.2em 0 0.5em",
                  color: "#1a3a5c",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.3em",
                }}>
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <h3 style={{
                  fontSize: "0.88em",
                  fontWeight: 600,
                  margin: "0.6em 0 0.3em",
                  color: "#2d5a8e",
                }}>
                  {children}
                </h3>
              ),
            }}
          >
            {message.content}
          </ReactMarkdown>
        )}
      </div>
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
