"use client";

import { Square, Volume2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { cancelTts, speakText } from "../../lib/voiceTts";

interface AssistantTtsButtonProps {
  /** 마크다운 원문 — 읽기 전용으로 가볍게 정리 후 TTS */
  markdown: string;
}

export function AssistantTtsButton({ markdown }: AssistantTtsButtonProps) {
  const [playing, setPlaying] = useState(false);
  const cancelled = useRef(false);

  const onClick = useCallback(async () => {
    if (playing) {
      cancelled.current = true;
      cancelTts();
      setPlaying(false);
      return;
    }
    cancelled.current = false;
    setPlaying(true);
    try {
      await speakText(markdown);
    } finally {
      if (!cancelled.current) setPlaying(false);
    }
  }, [markdown, playing]);

  return (
    <button
      type="button"
      className={`cbot-tts-btn${playing ? " playing" : ""}`}
      onClick={() => void onClick()}
      title={playing ? "읽기 중지" : "답변 듣기 (TTS)"}
      aria-label={playing ? "음성 읽기 중지" : "음성으로 읽기"}
      aria-pressed={playing}
    >
      {playing ? <Square size={14} fill="currentColor" /> : <Volume2 size={16} strokeWidth={2} />}
    </button>
  );
}
