/**
 * Worker 파싱 클라이언트 — wasm 동기 구간을 Web Worker 로 격리(메인스레드 응답성).
 * ifc.ts 와 분리된 파일인 이유: worker(ifc.worker.ts)가 ifc.ts 를 import 하는데, worker URL
 * 참조가 ifc.ts 안에 있으면 webpack 이 worker 번들 안에서 또 worker 를 만드는 순환으로
 * 빌드가 무한/타임아웃(실측: Vercel 45분 Error). 참조 방향을 단방향으로 절단.
 */
import { parseIfc, deserializeParsed, type ParsedIfc } from "./ifc";

export function parseIfcInWorker(
  buffer: ArrayBuffer,
  onProgress?: (p: number, msg: string) => void,
  skipTrades?: Set<string>,
): Promise<ParsedIfc> {
  if (typeof Worker === "undefined") return parseIfc(buffer, onProgress, skipTrades);
  return new Promise<ParsedIfc>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./ifc.worker.ts", import.meta.url));
    } catch {
      void parseIfc(buffer, onProgress, skipTrades).then(resolve, reject);
      return;
    }
    let settled = false;
    worker.onmessage = (e: MessageEvent) => {
      const d = e.data;
      if (d.type === "progress") onProgress?.(d.p, d.msg);
      else if (d.type === "done") { settled = true; worker.terminate(); resolve(deserializeParsed(d.parsed)); }
      else if (d.type === "error") { settled = true; worker.terminate(); reject(new Error(d.message)); }
    };
    worker.onerror = (ev) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      console.warn("[ifc] worker 실패 — 인라인 파싱 폴백:", ev.message);
      void parseIfc(buffer, onProgress, skipTrades).then(resolve, reject);
    };
    // buffer 는 transfer 하지 않음(복사) — onerror 인라인 폴백에서 재사용해야 하므로.
    worker.postMessage({ buffer, skipTrades: skipTrades ? [...skipTrades] : undefined });
  });
}
