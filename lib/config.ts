/**
 * 백엔드 CLM API 기본 URL.
 *
 * 우선순위:
 *   1. CLM_SERVER_API_URL  — next.config.ts / Docker Compose 서버사이드 주입
 *   2. NEXT_PUBLIC_CLM_API_URL — 클라이언트 빌드타임 환경변수 (.env.local 등)
 *   3. http://localhost:8002   — 로컬 개발 기본값
 *
 * cbot/chat route.ts 는 서버사이드 실행이므로 NEXT_PUBLIC 없이도 접근 가능.
 */
export const API_URL =
  process.env.CLM_SERVER_API_URL ??
  process.env.NEXT_PUBLIC_CLM_API_URL ??
  "http://localhost:8002";
