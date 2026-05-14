declare module "speak-tts" {
  export default class SpeakTTS {
    init(opts?: {
      lang?: string;
      rate?: number;
      pitch?: number;
      volume?: number;
    }): Promise<void>;
    speak(opts: { text: string }): Promise<void>;
    cancel?(): void;
  }
}
