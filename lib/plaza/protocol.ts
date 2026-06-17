/**
 * 광장(Plaza) WebSocket 프로토콜 타입 + 접속 URL 유도.
 *
 * Backend: /api/v1/plaza/ws  (app root 마운트, plaza_endpoints.py)
 *
 * ⚠ WebSocket 은 Next.js rewrite(/api/clm)·Vercel 프록시로 통과되지 않으므로
 *    브라우저가 백엔드 오리진에 **직접** 접속한다. clm_session 쿠키는
 *    .p6clm.site 도메인이라 ai.p6clm.site 서브도메인으로 자동 전달된다(구글 로그인과 동일).
 */

export type AvatarConfig = Record<string, string>;

/** server → client */
export type ServerMsg =
  | { t: "welcome"; id: number; name: string; roster: PlayerSnapshot[] }
  | { t: "join"; p: PlayerSnapshot }
  | { t: "state"; id: number; x: number; y: number; vx: number; facing: Facing; st: AnimState }
  | { t: "chat"; id: number; name: string; text: string }
  | { t: "avatar"; id: number; a: AvatarConfig }
  | { t: "draw"; pts: number[][]; c: string; w: number }
  | { t: "board_init"; strokes: Stroke[] }
  | { t: "board_clear" }
  | { t: "game_state"; status: "playing" | "intermission"; round: number; total: number; drawerId: number; wordLen: number; secs: number; scores: Scores }
  | { t: "game_word"; word: string }
  | { t: "game_correct"; id: number; name: string; scores: Scores }
  | { t: "game_round_end"; word: string; scores: Scores }
  | { t: "game_over"; scores: Scores }
  | { t: "wheel_spin"; order: number[]; targetId: number; turns: number; dur: number }
  | { t: "omok_state"; board: number[][]; turn: number; status: "waiting" | "playing" | "done"; black: number | null; white: number | null; winner: number | null; vsAI: boolean; forbidden: number[][] }
  | { t: "omok_forbidden"; reason: string }
  | { t: "leave"; id: number }
  | { t: "pong" };

/** 점수 — JSON 키는 문자열(플레이어 id) */
export type Scores = Record<string, number>;

/** client → server */
export type ClientMsg =
  | { t: "move"; x: number; y: number; vx: number; facing: Facing; st: AnimState }
  | { t: "chat"; text: string }
  | { t: "avatar"; a: AvatarConfig }
  | { t: "draw"; pts: number[][]; c: string; w: number }
  | { t: "board_clear" }
  | { t: "board_open" }
  | { t: "game_start"; difficulty: string }
  | { t: "wheel_spin" }
  | { t: "omok_join" }
  | { t: "omok_start"; vsAI: boolean }
  | { t: "omok_move"; x: number; y: number }
  | { t: "omok_reset" }
  | { t: "omok_sync" }
  | { t: "ping" };

/** 그림판 폴리라인 스트로크 */
export interface Stroke { pts: number[][]; c: string; w: number; }

export type Facing = "l" | "r";
export type AnimState = "idle" | "walk" | "jump";

export interface PlayerSnapshot {
  id: number;
  name: string;
  x: number;
  y: number;
  facing: Facing;
  st: AnimState;
  avatar?: AvatarConfig | null;
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
