declare module "react-speech-recognition" {
  export interface SpeechRecognitionOptions {
    continuous?: boolean;
    language?: string;
  }

  export function useSpeechRecognition(options?: {
    transcribing?: boolean;
    clearTranscriptOnListen?: boolean;
    commands?: unknown[];
  }): {
    transcript: string;
    interimTranscript: string;
    finalTranscript: string;
    listening: boolean;
    isMicrophoneAvailable: boolean;
    resetTranscript: () => void;
    browserSupportsSpeechRecognition: boolean;
    browserSupportsContinuousListening: boolean;
  };

  interface SpeechRecognitionStatic {
    startListening(options?: SpeechRecognitionOptions): Promise<void>;
    stopListening(): Promise<void>;
    abortListening(): Promise<void>;
    browserSupportsSpeechRecognition(): boolean;
    browserSupportsContinuousListening(): boolean;
  }

  const SpeechRecognition: SpeechRecognitionStatic;
  export default SpeechRecognition;
}
