"use client";

import "regenerator-runtime/runtime";

import { Mic } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import SpeechRecognition, { useSpeechRecognition } from "react-speech-recognition";

import { useChatStore } from "../../stores/chatStore";

/**
 * Web Speech API 기반 STT (react-speech-recognition).
 * Chrome/Edge 권장. 한 번 탭하면 수음 시작, 다시 탭하면 종료하며 인식문이 즉시 전송된다.
 *
 * 부모에서 `next/dynamic(..., { ssr: false })`로만 로드할 것 — SSR에서 RecognitionManager가
 * 한 번이라도 만들어지면 `recognition` 인스턴스가 비어 이후 startListening이 무반응할 수 있음.
 *
 * 모바일 처리:
 *   모바일 Chrome 은 발화 종료 시 `listening` false 가 먼저 발화되고 `transcript` 가 그 다음
 *   tick 에 채워진다. 같은 effect 에서 즉시 transcript 를 읽으면 빈 문자열이라 전송 누락이
 *   발생하므로, "종료 신호만 받아두고 transcript 도착을 기다리는" 2-phase 패턴으로 처리한다.
 */

const TRANSCRIPT_WAIT_MS = 1200;
const FINALIZE_DEBOUNCE_MS = 250; // 추가 음절 도착할 가능성에 대비한 짧은 디바운스

export function VoiceMicButton() {
  const input = useChatStore((s) => s.input);
  const setInput = useChatStore((s) => s.setInput);
  const sendMessage = useChatStore((s) => s.sendMessage);
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

  /** 종료 신호를 받은 직후 "transcript 도착 대기" 상태. */
  const pendingFinalize = useRef(false);
  /** transcript 가 도착했을 때 finalize 가 한 번만 실행되도록 가드. */
  const finalizedFor = useRef<number | null>(null);
  /** "종료 후 transcript 도착 안 함" 타임아웃. */
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** transcript 변경 시 추가 음절 가능성을 짧게 기다리는 디바운스. */
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 최신 transcript/input 을 timer 콜백에서 안전하게 접근하기 위한 ref. */
  const transcriptRef = useRef(transcript);
  const inputRef = useRef(input);
  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);
  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  const scheduleClear = useCallback((ms: number) => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => {
      setStatusLine("");
      clearTimer.current = null;
    }, ms);
  }, []);

  const clearTimers = useCallback(() => {
    if (fallbackTimer.current) {
      clearTimeout(fallbackTimer.current);
      fallbackTimer.current = null;
    }
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
  }, []);

  /** 인식 결과를 input 에 머지한 뒤 곧바로 전송. */
  const finalize = useCallback(
    (sessionStartedAt: number) => {
      // 같은 세션에서 두 번 호출 방지 (디바운스 → fallback 등이 겹칠 때)
      if (finalizedFor.current === sessionStartedAt) return;
      finalizedFor.current = sessionStartedAt;

      clearTimers();
      pendingFinalize.current = false;

      const t = transcriptRef.current.trim();
      if (!t) {
        setStatusLine("인식된 음성이 없습니다. 다시 탭해 시도하거나 Chrome/Edge를 사용해 주세요.");
        scheduleClear(4000);
        return;
      }

      const curInput = inputRef.current;
      const merged = curInput ? `${curInput.replace(/\s+$/, "")} ${t}`.trim() : t;
      setInput(merged);
      resetTranscript();
      setStatusLine("✓ 인식 완료 — 전송");
      scheduleClear(1600);
      // Zustand set 은 동기 — 위 setInput 직후 store 의 input 이 갱신된 상태에서 전송된다.
      void sendMessage();
    },
    [clearTimers, resetTranscript, scheduleClear, setInput, sendMessage]
  );

  /* ── listening 상태 전환 ───────────────────────────── */
  useEffect(() => {
    // 시작
    if (!prevListening.current && listening) {
      setStatusLine("듣는 중… 말씀해 주세요");
      pendingFinalize.current = false;
      finalizedFor.current = null;
      clearTimers();
    }

    // 종료 — 모바일에선 transcript 가 아직 비어 있을 수 있음.
    // "도착을 기다리는" 모드로 전환하고, transcript effect 가 채워주거나 fallback timer 로 처리.
    if (prevListening.current && !listening) {
      const sessionStartedAt = Date.now();
      pendingFinalize.current = true;
      finalizedFor.current = null;

      // transcript 가 이미 있으면 디바운스 후 즉시 전송
      const t = transcriptRef.current.trim();
      if (t) {
        clearTimers();
        debounceTimer.current = setTimeout(() => {
          if (pendingFinalize.current) finalize(sessionStartedAt);
        }, FINALIZE_DEBOUNCE_MS);
      }

      // transcript 가 아직 안 도착했을 때를 위한 fallback
      clearTimers();
      fallbackTimer.current = setTimeout(() => {
        if (pendingFinalize.current) finalize(sessionStartedAt);
      }, TRANSCRIPT_WAIT_MS);
    }

    prevListening.current = listening;
  }, [listening, clearTimers, finalize]);

  /* ── transcript 도착 처리 (종료 대기 상태에서만) ── */
  useEffect(() => {
    // 듣는 중에는 라이브 미리보기 표시
    if (listening && transcript) {
      const short = transcript.trim().slice(0, 42);
      setStatusLine(short ? `인식: ${short}${transcript.length > 42 ? "…" : ""}` : "듣는 중…");
      return;
    }

    // 종료 후 transcript 가 도착한 경우 — 디바운스 후 finalize
    if (!listening && pendingFinalize.current && transcript.trim()) {
      const sessionStartedAt = Date.now();
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        if (pendingFinalize.current) finalize(sessionStartedAt);
      }, FINALIZE_DEBOUNCE_MS);
    }
  }, [listening, transcript, finalize]);

  /* ── unmount 시 타이머 정리 ── */
  useEffect(
    () => () => {
      clearTimers();
      if (clearTimer.current) clearTimeout(clearTimer.current);
    },
    [clearTimers]
  );

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
