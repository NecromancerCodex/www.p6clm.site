/**
 * TTS — speak-tts 우선, 실패 시 브라우저 SpeechSynthesis (Web Speech API).
 * 클라이언트 전용. SSR에서 import하지 마세요.
 */

function stripForSpeech(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*\*?|__|\*|_/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12000);
}

type SpeakTtsInstance = {
  init: (opts?: { lang?: string; rate?: number; pitch?: number; volume?: number }) => Promise<void>;
  speak: (opts: { text: string }) => Promise<void>;
  cancel?: () => void;
};

let speakLib: { default: new () => SpeakTtsInstance } | null = null;
let speakInstance: SpeakTtsInstance | null = null;
let speakInited = false;

export function cancelTts(): void {
  if (typeof window === "undefined") return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* noop */
  }
  try {
    speakInstance?.cancel?.();
  } catch {
    /* noop */
  }
}

/** 음성 재생이 끝날 때까지(또는 오류 시) resolve */
export function speakText(markdown: string): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  const text = stripForSpeech(markdown);
  if (!text) return Promise.resolve();

  cancelTts();

  return new Promise((resolve) => {
    const done = () => resolve();

    void (async () => {
      try {
        if (!speakLib) {
          speakLib = await import("speak-tts");
        }
        const Ctor = speakLib.default;
        if (!speakInstance) {
          speakInstance = new Ctor();
        }
        if (!speakInited) {
          await speakInstance.init({
            lang: "ko-KR",
            rate: 1,
            pitch: 1,
            volume: 1,
          });
          speakInited = true;
        }
        await speakInstance.speak({ text });
        done();
      } catch {
        try {
          const u = new SpeechSynthesisUtterance(text);
          u.lang = "ko-KR";
          u.onend = done;
          u.onerror = done;
          window.speechSynthesis.speak(u);
        } catch {
          done();
        }
      }
    })();
  });
}
