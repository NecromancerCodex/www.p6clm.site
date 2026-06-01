// web-ifc WASM 을 public/web-ifc/ 로 복사 (브라우저에서 SetWasmPath('/web-ifc/') 로 로드).
// postinstall 에서 실행 — dev/Vercel 빌드 모두 커버.
import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "web-ifc");
const dst = join(root, "public", "web-ifc");

const files = ["web-ifc.wasm", "web-ifc-mt.wasm", "web-ifc-mt.worker.js"];
try {
  mkdirSync(dst, { recursive: true });
  let copied = 0;
  for (const f of files) {
    const s = join(src, f);
    if (existsSync(s)) {
      copyFileSync(s, join(dst, f));
      copied++;
    }
  }
  console.log(`[copy-wasm] web-ifc → public/web-ifc/ (${copied} files)`);
} catch (e) {
  console.warn("[copy-wasm] skip:", e?.message ?? e);
}
