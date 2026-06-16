/**
 * 광장(Plaza) WebSocket 프로토콜 타입 + 접속 URL 유도.
 *
 * Backend: /api/v1/plaza/ws  (app root 마운트, plaza_endpoints.py)
 *
 * ⚠ WebSocket 은 Next.js rewrite(/api/clm)·Vercel 프록시로 통과되지 않으므로
 *    브라우저가 백엔드 오리진에 **직접** 접속한다. clm_session 쿠키는
 *    .p6clm.site 도메인이라 ai.p6clm.site 서브도메인으로 자동 전달된다(구글 로그인과 동일).
 */

/** 장착 외형 — 슬롯 → item_key */
export type Look = Record<string, string>;

/** server → client */
export type ServerMsg =
  | { t: "welcome"; id: number; roster: PlayerSnapshot[] }
  | { t: "join"; p: PlayerSnapshot }
  | { t: "state"; id: number; x: number; y: number; vx: number; facing: Facing; st: AnimState }
  | { t: "chat"; id: number; name: string; text: string }
  | { t: "look"; id: number; eq: Look }
  | { t: "leave"; id: number }
  | { t: "pong" };

/** client → server */
export type ClientMsg =
  | { t: "move"; x: number; y: number; vx: number; facing: Facing; st: AnimState }
  | { t: "chat"; text: string }
  | { t: "look"; eq: Look }
  | { t: "ping" };

export type Facing = "l" | "r";
export type AnimState = "idle" | "walk" | "jump";

export interface PlayerSnapshot {
  id: number;
  name: string;
  x: number;
  y: number;
  facing: Facing;
  st: AnimState;
  look?: Look;
}

/** 백엔드 WS 엔드포인트 URL. http(s) 베이스를 ws(s) 로 변환. */
export function plazaWsUrl(): string {
  const base =
    process.env.NEXT_PUBLIC_API_BASE ||
    process.env.NEXT_PUBLIC_CLM_API_URL ||
    (typeof window !== "undefined" ? window.location.origin : "http://localhost:8002");
  // https → wss, http → ws
  const wsBase = base.replace(/^http/i, "ws");
  return `${wsBase.replace(/\/$/, "")}/api/v1/plaza/ws`;
}
