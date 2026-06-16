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

import { useEffect, useRef, useState } from "react";

import {
  plazaWsUrl,
  type AnimState,
  type Facing,
  type ClientMsg,
  type ServerMsg,
  type PlayerSnapshot,
} from "../../lib/plaza/protocol";

// ── 월드 / 물리 상수 ──────────────────────────────────────────────────────────
const WORLD_W = 1000;
const WORLD_H = 647;
const GRAVITY = 0.65;
const MOVE_SPEED = 3.3;
const JUMP_V = -12.5;
const MAX_FALL = 16;
const PLAYER_W = 30;
const PLAYER_H = 44;
const DROP_GRACE_MS = 250; // 하강 시 발판 무시 시간

// 스폰 지점 — 백엔드 _SPAWN_X/_SPAWN_Y 와 동일
const SPAWN_X = 500;
const SPAWN_Y = 540;

/**
 * 발판(foothold) — 충돌 데이터. 배경의 나뭇가지 단도 이 좌표로 함께 그려져
 * "보이는 발판 = 실제 콜라이더"가 정확히 일치한다 (별도 미세조정 불필요).
 * solid: 양방향 막힘(땅). 그 외: 위에서만 착지하는 one-way 발판(↓+점프로 통과).
 */
interface Foothold {
  x: number;
  w: number;
  y: number; // 윗면 y
  solid?: boolean;
}
const FOOTHOLDS: Foothold[] = [
  { x: 0, w: WORLD_W, y: 600, solid: true }, // 바닥 (잔디 윗면)
  { x: 250, w: 180, y: 470 }, // 나무 좌측 가지
  { x: 575, w: 180, y: 470 }, // 나무 우측 가지
  { x: 360, w: 285, y: 360 }, // 나무 중앙 단
  { x: 410, w: 185, y: 250 }, // 나무 상단 (알 둥지 아래)
];

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
}

interface Bubble {
  text: string;
  until: number;
}

export function PlazaCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 연결/표시용 React 상태 (저빈도)
  const [status, setStatus] = useState<"connecting" | "open" | "closed">("connecting");
  const [count, setCount] = useState(1);
  const [chatValue, setChatValue] = useState("");

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
          remotesRef.current.clear();
          for (const p of msg.roster) addRemote(p);
          setCount(remotesRef.current.size + 1);
          break;
        }
        case "join": {
          addRemote(msg.p);
          setCount(remotesRef.current.size + 1);
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
          break;
        }
        case "leave": {
          remotesRef.current.delete(msg.id);
          bubblesRef.current.delete(msg.id);
          setCount(remotesRef.current.size + 1);
          break;
        }
      }
    };

    function addRemote(p: PlayerSnapshot) {
      if (p.id === myIdRef.current) return;
      remotesRef.current.set(p.id, {
        id: p.id, name: p.name, x: p.x, y: p.y, tx: p.x, ty: p.y,
        vx: 0, facing: p.facing, st: p.st,
      });
    }

    return () => {
      closedByUs = true;
      if (pingTimer) clearInterval(pingTimer);
      ws.close();
      wsRef.current = null;
    };
  }, []);

  // ── 키 입력 ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (inputFocusedRef.current) return; // 채팅 입력 중엔 게임 키 무시
      const k = e.key;
      if (k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowDown" || k === "Alt" || k === " ") {
        keysRef.current[k] = true;
        e.preventDefault(); // Alt 메뉴 포커스·스페이스 스크롤 방지
      }
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

    // 한 프레임 렌더 — 배경 + 발판(디버그) + 원격/로컬 캐릭터.
    const draw = (now: number) => {
      const cw = ctx.canvas.width;
      const ch = ctx.canvas.height;
      const scale = cw / WORLD_W; // 가로 맞춤 (height 는 WORLD_H*scale)

      ctx.clearRect(0, 0, cw, ch);

      ctx.save();
      ctx.scale(scale, scale);

      // 절차적 배경(오리지널) — 보이는 나뭇가지 단이 FOOTHOLDS 와 동일 좌표.
      drawBackground(ctx, now);

      for (const r of remotesRef.current.values()) {
        drawCharacter(ctx, r.x, r.y, r.facing, r.st, colorFor(r.id), r.name, now, bubblesRef.current.get(r.id));
      }
      const LL = localRef.current;
      drawCharacter(ctx, LL.x, LL.y, LL.facing, LL.st, colorFor(myIdRef.current), "나", now, bubblesRef.current.get(-1), true);

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
      </div>

      <div className="plaza-stage">
        <canvas
          ref={canvasRef}
          width={WORLD_W}
          height={WORLD_H}
          className="plaza-canvas"
          tabIndex={0}
        />
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

// ── 배경 (오리지널, 절차적) ─────────────────────────────────────────────────────
// "나무 마을" 분위기를 캔버스로 직접 그린다. 외부 이미지 자산 없음.
// 나뭇가지 단(ledge)은 FOOTHOLDS 와 같은 좌표라 보이는 발판 = 실제 충돌면.
function drawBackground(ctx: CanvasRenderingContext2D, now: number) {
  // 하늘
  const sky = ctx.createLinearGradient(0, 0, 0, WORLD_H);
  sky.addColorStop(0, "#5bb8ef");
  sky.addColorStop(0.55, "#9fd9f5");
  sky.addColorStop(1, "#d6efd2");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);

  // 햇무리
  const sun = ctx.createRadialGradient(840, 110, 8, 840, 110, 150);
  sun.addColorStop(0, "rgba(255,251,224,0.95)");
  sun.addColorStop(1, "rgba(255,251,224,0)");
  ctx.fillStyle = sun;
  ctx.fillRect(600, 0, 400, 300);

  // 흐르는 구름
  const t = now * 0.012;
  const span = WORLD_W + 240;
  drawCloud(ctx, ((140 + t) % span) - 120, 95, 1.0);
  drawCloud(ctx, ((560 + t * 0.7) % span) - 120, 150, 0.8);
  drawCloud(ctx, ((860 + t * 0.5) % span) - 120, 65, 1.15);

  // 먼 언덕
  ctx.fillStyle = "#bfe39a";
  blob(ctx, -60, 600, [[0, -90], [180, -150], [380, -100], [540, -150], [760, -90], [1060, -130], [1060, 60], [-60, 60]]);
  ctx.fillStyle = "#a9d985";
  blob(ctx, -60, 600, [[0, -40], [260, -90], [520, -50], [820, -95], [1060, -55], [1060, 60], [-60, 60]]);

  // 중앙 큰 나무
  drawTree(ctx);

  // 잔디 땅 (solid foothold y=600)
  ctx.fillStyle = "#6fae3e";
  ctx.fillRect(0, 600, WORLD_W, WORLD_H - 600);
  ctx.fillStyle = "#5a4632"; // 흙
  ctx.fillRect(0, 622, WORLD_W, WORLD_H - 622);
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, 601); ctx.lineTo(WORLD_W, 601); ctx.stroke();

  // 나뭇가지 발판 (one-way FOOTHOLDS)
  for (const f of FOOTHOLDS) {
    if (f.solid) continue;
    drawLedge(ctx, f.x, f.y, f.w);
  }
}

function drawCloud(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.beginPath();
  ctx.ellipse(x, y, 42 * s, 26 * s, 0, 0, Math.PI * 2);
  ctx.ellipse(x + 40 * s, y + 6 * s, 34 * s, 22 * s, 0, 0, Math.PI * 2);
  ctx.ellipse(x - 38 * s, y + 8 * s, 30 * s, 20 * s, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawTree(ctx: CanvasRenderingContext2D) {
  const cx = 500;
  // 줄기
  const trunk = ctx.createLinearGradient(cx - 90, 0, cx + 90, 0);
  trunk.addColorStop(0, "#7b5a36");
  trunk.addColorStop(0.5, "#9c7444");
  trunk.addColorStop(1, "#6e4f30");
  ctx.fillStyle = trunk;
  ctx.beginPath();
  ctx.moveTo(cx - 70, 600);
  ctx.bezierCurveTo(cx - 95, 460, cx - 55, 360, cx - 60, 250);
  ctx.lineTo(cx + 60, 250);
  ctx.bezierCurveTo(cx + 55, 360, cx + 95, 460, cx + 70, 600);
  ctx.closePath();
  ctx.fill();
  // 줄기 결
  ctx.strokeStyle = "rgba(80,55,30,0.35)";
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(cx - 20, 580); ctx.bezierCurveTo(cx - 30, 460, cx - 10, 360, cx - 18, 270); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx + 22, 580); ctx.bezierCurveTo(cx + 30, 470, cx + 12, 370, cx + 20, 270); ctx.stroke();

  // 잎 덩어리 (윗단 발판 y≈250 위로 풍성하게)
  const leaves: Array<[number, number, number]> = [
    [cx, 150, 130], [cx - 120, 200, 90], [cx + 120, 200, 90],
    [cx - 70, 130, 80], [cx + 70, 130, 80], [cx, 90, 95],
  ];
  for (const [lx, ly, r] of leaves) {
    const g = ctx.createRadialGradient(lx - r * 0.3, ly - r * 0.3, r * 0.2, lx, ly, r);
    g.addColorStop(0, "#7bc26a");
    g.addColorStop(1, "#3f8f43");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(lx, ly, r, 0, Math.PI * 2); ctx.fill();
  }
}

// 나뭇가지 발판 — 윗면 y 가 충돌면. 둥근 통나무 + 잎 장식.
function drawLedge(ctx: CanvasRenderingContext2D, x: number, y: number, w: number) {
  const h = 16;
  ctx.fillStyle = "#8a6239";
  roundRect(ctx, x, y, w, h, 8); ctx.fill();
  ctx.fillStyle = "#6f4d2b";
  roundRect(ctx, x, y + h - 6, w, 6, 4); ctx.fill();
  // 윗면 이끼
  ctx.fillStyle = "#5aa84a";
  roundRect(ctx, x + 3, y - 3, w - 6, 7, 4); ctx.fill();
  // 잎 끝 장식
  ctx.fillStyle = "#4f9b46";
  ctx.beginPath(); ctx.arc(x + 6, y + 2, 9, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + w - 6, y + 2, 9, 0, Math.PI * 2); ctx.fill();
}

// 닫힌 다각형 채우기 헬퍼 (offset 기준 상대 좌표)
function blob(ctx: CanvasRenderingContext2D, ox: number, oy: number, pts: number[][]) {
  ctx.beginPath();
  pts.forEach(([dx, dy], i) => {
    const px = ox + dx, py = oy + dy;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  });
  ctx.closePath();
  ctx.fill();
}

// ── canvas 헬퍼 (모듈 레벨 — 순수 함수) ──────────────────────────────────────────
function drawCharacter(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, facing: Facing, st: AnimState,
  color: string, name: string, now: number, bubble: Bubble | undefined, isMe = false,
) {
  const bob = st === "walk" ? Math.sin(now / 90) * 2 : 0;
  const topY = y - PLAYER_H + bob;

  ctx.save();
  // 그림자
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath(); ctx.ellipse(x, y + 2, PLAYER_W * 0.5, 5, 0, 0, Math.PI * 2); ctx.fill();

  // 몸통 (둥근 사각형)
  ctx.fillStyle = color;
  roundRect(ctx, x - PLAYER_W / 2, topY, PLAYER_W, PLAYER_H, 8);
  ctx.fill();
  if (isMe) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.5; ctx.stroke(); }

  // 눈 (바라보는 방향)
  ctx.fillStyle = "#fff";
  const ex = facing === "r" ? x + 4 : x - 4;
  ctx.beginPath(); ctx.arc(ex, topY + 15, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#222";
  ctx.beginPath(); ctx.arc(ex + (facing === "r" ? 1.5 : -1.5), topY + 15, 2.3, 0, Math.PI * 2); ctx.fill();

  // 이름표
  ctx.font = "600 13px system-ui, sans-serif";
  ctx.textAlign = "center";
  const tw = ctx.measureText(name).width;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  roundRect(ctx, x - tw / 2 - 6, y + 6, tw + 12, 18, 9); ctx.fill();
  ctx.fillStyle = isMe ? "#ffe066" : "#fff";
  ctx.fillText(name, x, y + 19);

  // 말풍선
  if (bubble && bubble.until > now) {
    drawBubble(ctx, x, topY - 10, bubble.text);
  }
  ctx.restore();
}

function drawBubble(ctx: CanvasRenderingContext2D, cx: number, bottomY: number, text: string) {
  ctx.font = "13px system-ui, sans-serif";
  ctx.textAlign = "left";
  const maxW = 220;
  const lines = wrapText(ctx, text, maxW);
  const lineH = 17;
  const padX = 10, padY = 7;
  let bw = 0;
  for (const ln of lines) bw = Math.max(bw, ctx.measureText(ln).width);
  bw = Math.min(bw, maxW) + padX * 2;
  const bh = lines.length * lineH + padY * 2;
  const bx = cx - bw / 2;
  const by = bottomY - bh;

  ctx.fillStyle = "rgba(255,255,255,0.96)";
  ctx.strokeStyle = "rgba(0,0,0,0.12)";
  ctx.lineWidth = 1;
  roundRect(ctx, bx, by, bw, bh, 10); ctx.fill(); ctx.stroke();
  // 꼬리
  ctx.beginPath();
  ctx.moveTo(cx - 6, by + bh); ctx.lineTo(cx + 6, by + bh); ctx.lineTo(cx, by + bh + 8);
  ctx.closePath(); ctx.fillStyle = "rgba(255,255,255,0.96)"; ctx.fill();

  ctx.fillStyle = "#222";
  ctx.textAlign = "left";
  lines.forEach((ln, i) => ctx.fillText(ln, bx + padX, by + padY + 13 + i * lineH));
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const ch of text) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = ch; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines.slice(0, 4); // 최대 4줄
}
