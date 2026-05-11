"use client";

import { useEffect, useRef, useState } from "react";

import { useChatStore } from "../../stores/chatStore";
import { MessageBubble, ThinkingBubble } from "../molecules/MessageBubble";
import { ChatInputBar } from "../molecules/ChatInputBar";

export function ChatWindow() {
  const messages    = useChatStore((s) => s.messages);
  const isLoading   = useChatStore((s) => s.isLoading);
  const clearMessages = useChatStore((s) => s.clearMessages);
  const bottomRef   = useRef<HTMLDivElement>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleClear = () => {
    if (messages.length === 0) return;
    if (confirmClear) {
      clearMessages();
      setConfirmClear(false);
    } else {
      setConfirmClear(true);
      // 3초 후 확인 상태 자동 해제
      setTimeout(() => setConfirmClear(false), 3000);
    }
  };

  return (
    <div className="cbot-page">
      {/* 헤더 */}
      {messages.length > 0 && (
        <div className="cbot-header">
          <span className="cbot-header-title">ConstructBot</span>
          <button
            className={`cbot-clear-btn${confirmClear ? " confirm" : ""}`}
            onClick={handleClear}
            disabled={isLoading}
            title="대화 초기화"
          >
            {confirmClear ? "정말 삭제할까요?" : "대화 초기화"}
          </button>
        </div>
      )}

      <div className="cbot-messages">
        {messages.length === 0 && !isLoading && (
          <div className="cbot-empty">
            <p className="cbot-empty-text">준비되면 얘기해 주세요.</p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {isLoading && <ThinkingBubble />}

        <div ref={bottomRef} />
      </div>

      <ChatInputBar />
    </div>
  );
}
