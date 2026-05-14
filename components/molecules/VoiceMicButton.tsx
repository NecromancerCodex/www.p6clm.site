"use client";

import "regenerator-runtime/runtime";

import { Mic } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import SpeechRecognition, { useSpeechRecognition } from "react-speech-recognition";

import { useChatStore } from "../../stores/chatStore";

/**
 * Web Speech API 기반 STT (react-speech-recognition).
 * Chrome/Edge 권장. 한 번 탭하면 수음 시작, 다시 탭하면 종료하며 인식문을 입력창에 반영.
 *
 * 부모에서 `next/dynamic(..., { ssr: false })`로만 로드할 것 — SSR에서 RecognitionManager가
 * 한 번이라도 만들어지면 `recognition` 인스턴스가 비어 이후 startListening이 무반응할 수 있음.
 */
export function VoiceMicButton() {
  const input = useChatStore((s) => s.input);
  const setInput = useChatStore((s) => s.setInput);
  const isLoading = useChatStore((s) => s.isLoading);

  const [statusLine, setStatusLine] = useState("");
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    transcript,
    listening,
    resetTranscript,
    browserSupportsSpeechRecognition,
    isMicrophoneAvailable,
  } = useSpeechRecognition();

  const prevListening = useRef(false);

  const scheduleClear = useCallback((ms: number) => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => {
      setStatusLine("");
      clearTimer.current = null;
    }, ms);
  }, []);

  useEffect(() => {
    if (!prevListening.current && listening) {
      setStatusLine("듣는 중… 말씀해 주세요");
    }

    if (prevListening.current && !listening) {
      const t = transcript.trim();
      if (t) {
        setInput(input ? `${input.replace(/\s+$/, "")} ${t}`.trim() : t);
        resetTranscript();
        setStatusLine("✓ 입력창에 반영했습니다");
        scheduleClear(2800);
      } else {
        setStatusLine("인식된 음성이 없습니다. 다시 탭해 시도하거나 Chrome/Edge를 사용해 주세요.");
        scheduleClear(4000);
      }
    }

    prevListening.current = listening;
  }, [listening, transcript, input, setInput, resetTranscript, scheduleClear]);

  useEffect(() => {
    if (listening && transcript) {
      const short = transcript.trim().slice(0, 42);
      setStatusLine(short ? `인식: ${short}${transcript.length > 42 ? "…" : ""}` : "듣는 중…");
    }
  }, [listening, transcript]);

  const toggle = useCallback(() => {
    if (isLoading) return;
    if (listening) {
      SpeechRecognition.stopListening();
      return;
    }
    resetTranscript();
    setStatusLine("시작 중…");
    void SpeechRecognition.startListening({
      continuous: false,
      language: "ko-KR",
    }).catch(() => {
      setStatusLine("시작 실패 — HTTPS·localhost인지, 마이크 권한을 확인해 주세요.");
      scheduleClear(4500);
    });
  }, [isLoading, listening, resetTranscript, scheduleClear]);

  if (!browserSupportsSpeechRecognition) {
    return (
      <div className="cbot-mic-stack">
        <div className="cbot-mic-stack-anchor">
          <button
            type="button"
            className="cbot-mic-btn"
            disabled
            title="이 브라우저는 음성 인식(Web Speech API)을 지원하지 않습니다."
            aria-label="음성 입력 미지원"
          >
            <Mic size={17} strokeWidth={2} />
          </button>
          <p className="cbot-mic-live" role="status">
            음성 입력 미지원
          </p>
        </div>
      </div>
    );
  }

  const title = !isMicrophoneAvailable
    ? "마이크가 막혀 있을 수 있습니다. 주소창 자물쇠에서 마이크 허용 후 새로고침. (탭하면 재시도)"
    : listening
      ? "탭하여 수음 종료"
      : "탭하여 음성 입력 (한국어)";

  return (
    <div className="cbot-mic-stack">
      <div className="cbot-mic-stack-anchor">
        <button
          type="button"
          className={`cbot-mic-btn${listening ? " listening" : ""}`}
          onClick={toggle}
          disabled={isLoading}
          title={title}
          aria-label={listening ? "음성 입력 중지" : "음성 입력 시작"}
          aria-pressed={listening}
        >
          <Mic size={17} strokeWidth={2} />
        </button>
        <p className="cbot-mic-live" aria-live="polite" role="status">
          {!isMicrophoneAvailable && !listening
            ? "마이크 차단 가능 — 자물쇠에서 허용"
            : statusLine}
        </p>
      </div>
    </div>
  );
}
