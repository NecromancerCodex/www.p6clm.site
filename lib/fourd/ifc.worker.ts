/**
 * IFC 파싱 Web Worker — 378MB 급 wasm 동기 스트리밍(OpenModel/StreamAllMeshes)을 메인스레드
 * 밖으로. '응답 없는 페이지' 근본 해소(메인은 페인트·입력 자유). three.js BufferGeometry 는
 * 순수 JS 라 worker 에서 생성 가능 → 기존 serializeParsed 로 원시 배열화해 transferable 전송.
 */
import { parseIfc, serializeParsed } from "./ifc";

self.onmessage = async (e: MessageEvent<{ buffer: ArrayBuffer; skipTrades?: string[] }>) => {
  const { buffer, skipTrades } = e.data;
  try {
    const parsed = await parseIfc(
      buffer,
      (p, msg) => self.postMessage({ type: "progress", p, msg }),
      skipTrades ? new Set(skipTrades) : undefined,
    );
    const s = serializeParsed(parsed);
    const transfers: ArrayBuffer[] = [];
    for (const g of s.groups) {
      transfers.push(g.pos.buffer as ArrayBuffer);
      if (g.norm) transfers.push(g.norm.buffer as ArrayBuffer);
      if (g.idx) transfers.push(g.idx.buffer as ArrayBuffer);
      transfers.push(g.matrices.buffer as ArrayBuffer);
      transfers.push(g.elementIdx.buffer as ArrayBuffer);
    }
    // 같은 buffer 를 공유하는 group(인스턴싱 재사용)이 있으면 중복 transfer 에러 → dedupe
    const uniq = [...new Set(transfers)];
    (self as unknown as Worker).postMessage({ type: "done", parsed: s }, uniq);
  } catch (err) {
    self.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
