"use client";

import { ArrowUp, ImageIcon, X } from "lucide-react";
import { useRef, useCallback } from "react";
import Image from "next/image";

import { AutoResizeTextarea } from "../atoms/AutoResizeTextarea";
import { useChatStore } from "../../stores/chatStore";

export function ChatInputBar() {
  const input             = useChatStore((s) => s.input);
  const isLoading         = useChatStore((s) => s.isLoading);
  const pendingImagePreview = useChatStore((s) => s.pendingImagePreview);
  const setInput          = useChatStore((s) => s.setInput);
  const sendMessage       = useChatStore((s) => s.sendMessage);
  const setPendingImage   = useChatStore((s) => s.setPendingImage);
  const clearPendingImage = useChatStore((s) => s.clearPendingImage);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage().then(() => textareaRef.current?.focus());
      }
    },
    [sendMessage]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) setPendingImage(file);
      // input 초기화 (같은 파일 재선택 가능하도록)
      e.target.value = "";
    },
    [setPendingImage]
  );

  const canSend = (input.trim().length > 0 || pendingImagePreview !== null) && !isLoading;

  return (
    <div className="cbot-input-area">
      {/* 이미지 미리보기 */}
      {pendingImagePreview && (
        <div className="cbot-image-preview">
          <div className="cbot-image-preview-wrap">
            <Image
              src={pendingImagePreview}
              alt="첨부 이미지"
              width={120}
              height={90}
              className="cbot-image-preview-img"
              style={{ objectFit: "cover", borderRadius: 6 }}
              unoptimized
            />
            <button
              className="cbot-image-remove-btn"
              type="button"
              onClick={clearPendingImage}
              aria-label="이미지 제거"
            >
              <X size={12} strokeWidth={2.5} />
            </button>
          </div>
        </div>
      )}

      <div className="cbot-input-wrap">
        {/* 숨겨진 파일 input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleFileChange}
        />

        {/* 이미지 첨부 버튼 */}
        <button
          className="cbot-attach-btn"
          type="button"
          aria-label="이미지 첨부"
          onClick={() => fileInputRef.current?.click()}
          disabled={isLoading}
        >
          <ImageIcon size={16} strokeWidth={2} />
        </button>

        <AutoResizeTextarea
          ref={textareaRef}
          className="cbot-textarea"
          placeholder="무엇이든 물어보세요 (이미지 첨부 가능)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
        />

        <button
          className="cbot-send-btn"
          type="button"
          aria-label="전송"
          onClick={() => sendMessage().then(() => textareaRef.current?.focus())}
          disabled={!canSend}
        >
          <ArrowUp size={17} strokeWidth={2.5} />
        </button>
      </div>

      <p className="cbot-hint">
        ConstructBot은 KCS/KDS 기준을 근거로 답변합니다. 현장 사진도 분석 가능합니다.
      </p>
    </div>
  );
}
