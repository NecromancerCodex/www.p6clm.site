"use client";

/**
 * 광장(Plaza) — 메이플스토리식 2D 플랫포머 실시간 대화방.
 *
 * 조작: ←/→ 이동, Alt 점프, ↓+Alt 발판 아래로 하강, Enter 채팅.
 * 렌더: <canvas> + requestAnimationFrame 게임 루프 (React 리렌더는 상태표시/채팅 입력에만).
 * 통신: plaza WebSocket — 내 위치는 throttle 송신, 원격 플레이어는 lerp 보간.
 *
 * 물리/네트워크 상태는 모두 ref 로 보관해 프레임마다 React 리렌더를 유발하지 않는다.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  plazaWsUrl,
  type AnimState,
  type Facing,
  type ClientMsg,
  type ServerMsg,
  type PlayerSnapshot,
} from "../../lib/plaza/protocol";
import { drawChibi, drawStaticChar, roundRect } from "../../lib/plaza/render";
import {
  loadManifest, composeAvatar, DEFAULT_AVATAR,
  type PartsManifest, type AvatarConfig, type ComposedAvatar,
} from "../../lib/plaza/parts";
import { usePlazaStore } from "../../stores/plazaStore";
import { ShopPanel } from "./ShopPanel";
import { CharacterCreator } from "./CharacterCreator";
import { PaintBoard } from "./PaintBoard";
import { WheelRoom } from "./WheelRoom";
import { OmokRoom } from "./OmokRoom";

// ── 월드 / 물리 상수 ──────────────────────────────────────────────────────────
// 월드 = 배경 이미지(town.png) 원본 크기 1384×768 와 1:1.
const WORLD_W = 1384;
const WORLD_H = 768;
const GRAVITY = 0.62;
const MOVE_SPEED = 4.2;
const JUMP_V = -13.5; // 최대 점프 높이 ≈ JUMP_V²/(2·GRAVITY) ≈ 147px
const MAX_FALL = 18;
const PLAYER_W = 30;
const DROP_GRACE_MS = 250; // 하강 시 발판 무시 시간

// 스폰 지점 (중앙 바닥) — 백엔드 _SPAWN_X/_SPAWN_Y 와 동일
const SPAWN_X = 692;
const SPAWN_Y = 560;

/**
 * 발판(foothold) — 충돌 데이터. 배경 그림(town.png)의 빨간 콜리전 표시에 맞춤.
 * solid: 양방향 막힘(땅). 그 외: 위에서만 착지하는 one-way 발판(↓+점프로 통과).
 * 좌표는 픽셀 분석으로 추출 — SHOW_FOOTHOLDS(아래)로 그림과 정렬 확인 가능.
 */
interface Foothold {
  x: number;
  w: number;
  y: number; // 윗면 y
  solid?: boolean;
}
const GROUND_Y = 616;
const FOOTHOLDS: Foothold[] = [
  { x: 0, w: WORLD_W, y: GROUND_Y, solid: true }, // 바닥 데크 (전폭)
  { x: 200, w: 1020, y: 407 },                    // 2층 보 (좌우 관통)
  // 중앙 나선계단 (바닥→2층 climb)
  { x: 600, w: 100, y: 580 },
  { x: 575, w: 90, y: 530 },
  { x: 575, w: 90, y: 482 },
  { x: 610, w: 100, y: 437 },
  { x: 655, w: 105, y: 384 },                     // 다락 (침대 옆)
  { x: 318, w: 70, y: 488 },                      // 좌측 작은 단
];

// 전경 가림(occlusion)은 투명 컷아웃 town_fg.png 가 있을 때만 적용한다.
// 슬라이스 재드로 방식은 1층에 반투명 벽/레이어 아티팩트를 만들어 제거함.

// 캐릭터 색상 팔레트 — id 로 결정 (입장마다 일관)
const PALETTE = ["#ff6b6b", "#4dabf7", "#51cf66", "#ffd43b", "#cc5de8", "#ff922b", "#20c997", "#f783ac"];
const colorFor = (id: number) => PALETTE[id % PALETTE.length];

// ── 내부 상태 타입 ────────────────────────────────────────────────────────────
interface LocalState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: Facing;
  onGround: boolean;
  st: AnimState;
  dropUntil: number; // 이 시각까지 one-way 발판 무시
}

interface RemotePlayer {
  id: number;
  name: string;
  x: number; // 보간된 현재 표시 위치
  y: number;
  tx: number; // 서버가 보낸 목표 위치
  ty: number;
  vx: number;
  facing: Facing;
  st: AnimState;
  avatar: AvatarConfig; // 크리에이터 합성 설정
}

interface Bubble {
  text: string;
  until: number;
}

export interface Participant {
  id: number;
  name: string;
  avatar: AvatarConfig;
  me: boolean;
}
export interface ChatLine {
  id: number;
  name: string;
  text: string;
  ts: number; // 수신 시각(ms) — 룸 말풍선 표시용
}

export interface GameView {
  status: "playing" | "intermission";
  round: number;
  total: number;
  drawerId: number;
  wordLen: number;
  endsAt: number;            // 라운드 종료 epoch ms
  scores: Record<string, number>;
  guessed: number[];         // 이번 라운드 정답자 id
  myWord: string | null;     // 출제자에게만
  roundWord: string | null;  // 라운드 종료 공개 단어
  over: Record<string, number> | null; // 게임 종료 최종 점수
}

export function PlazaCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 연결/표시용 React 상태 (저빈도)
  const [status, setStatus] = useState<"connecting" | "open" | "closed">("connecting");
  const [count, setCount] = useState(1);
  const [chatValue, setChatValue] = useState("");
  const [panel, setPanel] = useState<null | "shop" | "creator" | "paint" | "wheel" | "omok">(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [chatLog, setChatLog] = useState<ChatLine[]>([]);
  const [game, setGame] = useState<GameView | null>(null);

  // 프로필 스토어 (재화·인벤·아바타)
  const loadProfile = usePlazaStore((s) => s.load);
  const loaded = usePlazaStore((s) => s.loaded);
  const avatar = usePlazaStore((s) => s.avatar);
  const setAvatar = usePlazaStore((s) => s.setAvatar);

  // 게임/네트워크 상태 (고빈도 — ref)
  const wsRef = useRef<WebSocket | null>(null);
  const myIdRef = useRef<number>(-1);
  const localRef = useRef<LocalState>({
    x: SPAWN_X, y: SPAWN_Y, vx: 0, vy: 0, facing: "r", onGround: false, st: "idle", dropUntil: 0,
  });
  const remotesRef = useRef<Map<number, RemotePlayer>>(new Map());
  const bubblesRef = useRef<Map<number, Bubble>>(new Map()); // playerId → 말풍선 (-1=나)
  const keysRef = useRef<Record<string, boolean>>({});
  const inputFocusedRef = useRef(false);
  const bgRef = useRef<HTMLImageElement | null>(null);
  const fgRef = useRef<HTMLImageElement | null>(null); // 선택: 전경 컷아웃 PNG
  const myAvatarRef = useRef<AvatarConfig>(DEFAULT_AVATAR); // 내 아바타 설정 (게임 루프용)
  const manifestRef = useRef<PartsManifest | null>(null);
  const avatarCacheRef = useRef<Map<string, ComposedAvatar>>(new Map()); // 합성 결과 캐시
  const composingRef = useRef<Set<string>>(new Set()); // 합성 진행 중
  const boardHandlerRef = useRef<((m: ServerMsg) => void) | null>(null); // 그림판 수신 핸들러
  const myNameRef = useRef<string>("나");

  // 참가자 카드 목록 갱신 (입장/퇴장/아바타 변경 시) — 최대 8명
  const refreshParticipants = useCallback(() => {
    const me: Participant = { id: myIdRef.current, name: myNameRef.current, avatar: myAvatarRef.current, me: true };
    const others: Participant[] = [...remotesRef.current.values()].map((r) => ({
      id: r.id, name: r.name, avatar: r.avatar, me: false,
    }));
    setParticipants([me, ...others].slice(0, 8));
  }, []);

  // WS 송신 헬퍼 (그림판 등에서 사용)
  const wsSend = (m: ClientMsg) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  };

  // ── 배경/전경 이미지 + 매니페스트 + 프로필 로드 ───────────────────────────────
  useEffect(() => {
    const img = new Image();
    img.src = "/plaza/town.png";
    img.onload = () => { bgRef.current = img; };
    const fg = new Image();
    fg.onload = () => { fgRef.current = fg; };
    fg.src = "/plaza/town_fg.png";
    void loadManifest().then((m) => { manifestRef.current = m; });
    void loadProfile();
  }, [loadProfile]);

  // ── WebSocket 연결 ─────────────────────────────────────────────────────────
  useEffect(() => {
    let closedByUs = false;
    let pingTimer: ReturnType<typeof setInterval> | null = null;

    const ws = new WebSocket(plazaWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("open");
      // keepalive — nginx proxy_read_timeout(120s) 안에서 끊기지 않도록
      pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "ping" } as ClientMsg));
      }, 30000);
    };

    ws.onclose = () => { setStatus("closed"); if (pingTimer) clearInterval(pingTimer); };
    ws.onerror = () => { if (!closedByUs) setStatus("closed"); };

    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try { msg = JSON.parse(ev.data); } catch { return; }

      switch (msg.t) {
        case "welcome": {
          myIdRef.current = msg.id;
          myNameRef.current = msg.name || "나";
          remotesRef.current.clear();
          for (const p of msg.roster) addRemote(p);
          setCount(remotesRef.current.size + 1);
          refreshParticipants();
          break;
        }
        case "join": {
          addRemote(msg.p);
          setCount(remotesRef.current.size + 1);
          refreshParticipants();
          break;
        }
        case "state": {
          const r = remotesRef.current.get(msg.id);
          if (r) {
            r.tx = msg.x; r.ty = msg.y; r.vx = msg.vx; r.facing = msg.facing; r.st = msg.st;
          }
          break;
        }
        case "chat": {
          bubblesRef.current.set(
            msg.id === myIdRef.current ? -1 : msg.id,
            { text: msg.text, until: performance.now() + 5200 },
          );
          setChatLog((log) => [...log.slice(-29), { id: msg.id, name: msg.name, text: msg.text, ts: Date.now() }]);
          break;
        }
        case "avatar": {
          const r = remotesRef.current.get(msg.id);
          if (r && msg.a) r.avatar = msg.a;
          refreshParticipants();
          break;
        }
        case "draw":
        case "board_init":
        case "board_clear":
        case "wheel_spin":
        case "omok_state":
        case "omok_forbidden": {
          boardHandlerRef.current?.(msg); // 열려있는 룸(그림퀴즈/돌림판/오목)으로 전달
          break;
        }
        case "game_state": {
          const drawerId = msg.drawerId;
          setGame((g) => ({
            status: msg.status, round: msg.round, total: msg.total, drawerId,
            wordLen: msg.wordLen, endsAt: Date.now() + msg.secs * 1000, scores: msg.scores,
            guessed: [], myWord: drawerId === myIdRef.current ? (g?.myWord ?? null) : null,
            roundWord: null, over: null,
          }));
          break;
        }
        case "game_word": {
          setGame((g) => (g ? { ...g, myWord: msg.word } : g));
          break;
        }
        case "game_correct": {
          const cid = msg.id, cname = msg.name;
          setGame((g) => (g ? { ...g, scores: msg.scores, guessed: [...g.guessed, cid] } : g));
          setChatLog((log) => [...log.slice(-29), { id: cid, name: cname, text: "✅ 정답!", ts: Date.now() }]);
          break;
        }
        case "game_round_end": {
          setGame((g) => (g ? { ...g, status: "intermission", roundWord: msg.word, scores: msg.scores } : g));
          break;
        }
        case "game_over": {
          setGame((g) => (g ? { ...g, over: msg.scores } : g));
          window.setTimeout(() => setGame(null), 8000);
          break;
        }
        case "leave": {
          remotesRef.current.delete(msg.id);
          bubblesRef.current.delete(msg.id);
          setCount(remotesRef.current.size + 1);
          refreshParticipants();
          break;
        }
      }
    };

    function addRemote(p: PlayerSnapshot) {
      if (p.id === myIdRef.current) return;
      remotesRef.current.set(p.id, {
        id: p.id, name: p.name, x: p.x, y: p.y, tx: p.x, ty: p.y,
        vx: 0, facing: p.facing, st: p.st,
        avatar: p.avatar || DEFAULT_AVATAR,
      });
    }

    return () => {
      closedByUs = true;
      if (pingTimer) clearInterval(pingTimer);
      ws.close();
      wsRef.current = null;
    };
  }, [refreshParticipants]);

  // ── 아바타 동기화: 변경/접속 시 WS avatar 송신 + 게임루프 ref 갱신 ──────────────
  useEffect(() => {
    myAvatarRef.current = avatar || DEFAULT_AVATAR;
    refreshParticipants();
    const ws = wsRef.current;
    if (avatar && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ t: "avatar", a: avatar } as ClientMsg));
    }
  }, [avatar, status, refreshParticipants]);

  // ── 키 입력 ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (inputFocusedRef.current) return; // 채팅 입력 중엔 게임 키 무시
      const k = e.key;
      if (k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowDown" || k === "Alt" || k === " ") {
        keysRef.current[k] = true;
        e.preventDefault(); // Alt 메뉴 포커스·스페이스 스크롤 방지
      }
      // C=캐릭터 크리에이터
      if (k === "c" || k === "C" || k === "ㅊ") { e.preventDefault(); setPanel((p) => (p === "creator" ? null : "creator")); }
      if (k === "Escape") setPanel(null);
      if (k === "Enter") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    const up = (e: KeyboardEvent) => {
      keysRef.current[e.key] = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // ── 게임 루프 ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let lastSent = 0;
    let prevSt: AnimState = "idle";
    let prevFacing: Facing = "r";

    const SHOW_FOOTHOLDS = false; // 발판↔그림 정렬 확인 시 true

    const bubbleFor = (key: number, now: number): { text: string } | undefined => {
      const b = bubblesRef.current.get(key);
      return b && b.until > now ? { text: b.text } : undefined;
    };

    // 한 프레임 렌더 — 배경 이미지(없으면 절차적) + 원격/로컬 캐릭터.
    const draw = (now: number) => {
      const cw = ctx.canvas.width;
      const ch = ctx.canvas.height;
      const scale = cw / WORLD_W;

      ctx.clearRect(0, 0, cw, ch);
      ctx.save();
      ctx.scale(scale, scale);

      if (bgRef.current) {
        ctx.drawImage(bgRef.current, 0, 0, WORLD_W, WORLD_H);
      } else {
        // 배경 이미지 로드 전 — 단색 하늘(옛 맵 깜빡임 방지)
        ctx.fillStyle = "#2a3950";
        ctx.fillRect(0, 0, WORLD_W, WORLD_H);
      }

      if (SHOW_FOOTHOLDS) {
        ctx.strokeStyle = "rgba(255,0,0,0.7)"; ctx.lineWidth = 3;
        for (const f of FOOTHOLDS) {
          ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.x + f.w, f.y); ctx.stroke();
        }
      }

      // 아바타 합성 결과를 캐시에서 가져오거나(없으면) 비동기 합성 시작
      const composed = (config: AvatarConfig): ComposedAvatar | null => {
        const key = JSON.stringify(config);
        const hit = avatarCacheRef.current.get(key);
        if (hit) return hit;
        const m = manifestRef.current;
        if (m && !composingRef.current.has(key)) {
          composingRef.current.add(key);
          void composeAvatar(m, config).then((res) => {
            if (res) avatarCacheRef.current.set(key, res);
            composingRef.current.delete(key);
          });
        }
        return null;
      };

      const drawPlayer = (opts: Parameters<typeof drawChibi>[1], config: AvatarConfig) => {
        const c = composed(config);
        if (c) drawStaticChar(ctx, opts, c.canvas, c.w, c.h);
        else drawChibi(ctx, opts); // 합성 전 폴백
      };

      for (const r of remotesRef.current.values()) {
        drawPlayer({
          x: r.x, y: r.y, facing: r.facing, st: r.st, bodyColor: colorFor(r.id),
          name: r.name, now, bubble: bubbleFor(r.id, now),
        }, r.avatar);
      }
      const LL = localRef.current;
      drawPlayer({
        x: LL.x, y: LL.y, facing: LL.facing, st: LL.st, bodyColor: colorFor(myIdRef.current),
        name: "나", now, isMe: true, bubble: bubbleFor(-1, now),
      }, myAvatarRef.current);

      // ── 전경(foreground) — 투명 컷아웃 PNG(town_fg.png) 가 있을 때만 캐릭터 위에 덮음.
      //    (슬라이스 재드로 방식은 반투명 벽/레이어 아티팩트가 있어 제거함)
      if (fgRef.current) {
        ctx.drawImage(fgRef.current, 0, 0, WORLD_W, WORLD_H);
      }

      ctx.restore();
    };

    const step = (now: number) => {
      raf = requestAnimationFrame(step);
      const L = localRef.current;
      const keys = keysRef.current;

      // ── 입력 → 수평 속도 ──
      let moving = false;
      if (keys["ArrowLeft"]) { L.vx = -MOVE_SPEED; L.facing = "l"; moving = true; }
      else if (keys["ArrowRight"]) { L.vx = MOVE_SPEED; L.facing = "r"; moving = true; }
      else { L.vx = 0; }

      // ── 점프 / 하강 ──
      const jumpKey = keys["Alt"] || keys[" "];
      if (jumpKey && L.onGround) {
        if (keys["ArrowDown"]) {
          // 발판 아래로 — solid 가 아닌 발판을 잠시 무시하고 떨어짐
          L.dropUntil = now + DROP_GRACE_MS;
          L.onGround = false;
          L.vy = 1;
        } else {
          L.vy = JUMP_V;
          L.onGround = false;
        }
        keys["Alt"] = false; keys[" "] = false; // 단발 점프 (홀드 연속점프 방지)
      }

      // ── 중력 ──
      L.vy = Math.min(L.vy + GRAVITY, MAX_FALL);

      // ── 수평 이동 + 벽 ──
      L.x += L.vx;
      if (L.x < PLAYER_W / 2) L.x = PLAYER_W / 2;
      if (L.x > WORLD_W - PLAYER_W / 2) L.x = WORLD_W - PLAYER_W / 2;

      // ── 수직 이동 + 발판 착지 ──
      const prevFeet = L.y; // 이전 발 위치
      L.y += L.vy;
      const feet = L.y;
      L.onGround = false;
      if (L.vy >= 0) {
        const dropping = now < L.dropUntil;
        for (const f of FOOTHOLDS) {
          if (L.x < f.x || L.x > f.x + f.w) continue;
          if (!f.solid && dropping) continue; // 하강 중엔 one-way 통과
          // 발이 발판 윗면을 통과(위→아래)했으면 착지
          if (prevFeet <= f.y + 1 && feet >= f.y) {
            L.y = f.y;
            L.vy = 0;
            L.onGround = true;
            break;
          }
        }
      }
      // 월드 바닥 안전망
      if (L.y > WORLD_H) { L.y = SPAWN_Y; L.x = SPAWN_X; L.vy = 0; }

      // ── 애니메이션 상태 ──
      L.st = !L.onGround ? "jump" : moving ? "walk" : "idle";

      // ── 위치 송신 (throttle 80ms + 상태 변화 시 즉시) ──
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        const changed = L.st !== prevSt || L.facing !== prevFacing;
        if (now - lastSent > 80 || changed) {
          ws.send(JSON.stringify({
            t: "move", x: Math.round(L.x), y: Math.round(L.y),
            vx: L.vx, facing: L.facing, st: L.st,
          } as ClientMsg));
          lastSent = now;
          prevSt = L.st; prevFacing = L.facing;
        }
      }

      // ── 원격 플레이어 보간 (lerp + 데드레커닝) ──
      for (const r of remotesRef.current.values()) {
        r.tx += r.vx; // 다음 패킷까지 추측 항법
        r.x += (r.tx - r.x) * 0.25;
        r.y += (r.ty - r.y) * 0.25;
      }

      draw(now);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── 채팅 전송 ──────────────────────────────────────────────────────────────
  const sendChat = () => {
    const text = chatValue.trim();
    const ws = wsRef.current;
    if (text && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ t: "chat", text } as ClientMsg));
    }
    setChatValue("");
  };

  return (
    <div className="plaza-wrap">
      <div className="plaza-bar">
        <span className="plaza-title">🌳 광장</span>
        <span className={`plaza-dot ${status}`} />
        <span className="plaza-status">
          {status === "open" ? `접속 중 · ${count}명` : status === "connecting" ? "연결 중…" : "연결 끊김"}
        </span>
        <span className="plaza-hint">← → 이동 · Alt 점프 · ↓+Alt 내려가기 · Enter 채팅</span>
        <div className="plaza-tools">
          <button type="button" className={`plaza-tool${panel === "shop" ? " on" : ""}`} onClick={() => setPanel((p) => (p === "shop" ? null : "shop"))}>🛒 상점</button>
          <button type="button" className={`plaza-tool${panel === "creator" ? " on" : ""}`} onClick={() => setPanel((p) => (p === "creator" ? null : "creator"))}>🎨 캐릭터 <kbd>C</kbd></button>
          <button type="button" className={`plaza-tool${panel === "paint" ? " on" : ""}`} onClick={() => setPanel((p) => (p === "paint" ? null : "paint"))}>🎯 그림퀴즈</button>
          <button type="button" className={`plaza-tool${panel === "wheel" ? " on" : ""}`} onClick={() => setPanel((p) => (p === "wheel" ? null : "wheel"))}>🎡 돌림판</button>
          <button type="button" className={`plaza-tool${panel === "omok" ? " on" : ""}`} onClick={() => setPanel((p) => (p === "omok" ? null : "omok"))}>⚫ 오목</button>
        </div>
      </div>

      <div className="plaza-stage">
        <canvas
          ref={canvasRef}
          width={WORLD_W}
          height={WORLD_H}
          className="plaza-canvas"
          tabIndex={0}
        />
        {panel === "shop" && <ShopPanel onClose={() => setPanel(null)} />}
        {panel === "paint" && (
          <PaintBoard
            send={wsSend}
            register={(h) => { boardHandlerRef.current = h; }}
            onClose={() => setPanel(null)}
            participants={participants}
            chatLog={chatLog}
            game={game}
            startGame={(difficulty) => wsSend({ t: "game_start", difficulty })}
          />
        )}
        {panel === "wheel" && (
          <WheelRoom
            send={wsSend}
            register={(h) => { boardHandlerRef.current = h; }}
            onClose={() => setPanel(null)}
            participants={participants}
            chatLog={chatLog}
          />
        )}
        {panel === "omok" && (
          <OmokRoom
            send={wsSend}
            register={(h) => { boardHandlerRef.current = h; }}
            onClose={() => setPanel(null)}
            participants={participants}
          />
        )}
        {/* 최초(아바타 없음) = 강제 / 툴바 = 편집(닫기 가능) */}
        {loaded && (!avatar || panel === "creator") && (
          <CharacterCreator
            initial={avatar}
            onSave={(cfg) => { void setAvatar(cfg); setPanel(null); }}
            onClose={avatar ? () => setPanel(null) : undefined}
          />
        )}

        {/* 광장 채팅 로그 (메모리, DB 저장 안 함) */}
        {chatLog.length > 0 && (
          <div className="plaza-chatlog">
            {chatLog.slice(-9).map((l, i) => (
              <div key={i} className="plaza-chatlog-line"><b>{l.name}</b> {l.text}</div>
            ))}
          </div>
        )}
      </div>

      <form
        className="plaza-chat"
        onSubmit={(e) => { e.preventDefault(); sendChat(); inputRef.current?.blur(); }}
      >
        <input
          ref={inputRef}
          className="plaza-chat-input"
          value={chatValue}
          onChange={(e) => setChatValue(e.target.value)}
          onFocus={() => { inputFocusedRef.current = true; }}
          onBlur={() => { inputFocusedRef.current = false; }}
          placeholder="메시지를 입력하고 Enter…"
          maxLength={200}
        />
        <button type="submit" className="plaza-chat-send">전송</button>
      </form>
    </div>
  );
}
