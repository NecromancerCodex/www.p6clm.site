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
  type Look,
} from "../../lib/plaza/protocol";
import { drawChibi, roundRect } from "../../lib/plaza/render";
import { usePlazaStore } from "../../stores/plazaStore";
import { InventoryPanel } from "./InventoryPanel";
import { EquipPanel } from "./EquipPanel";
import { ShopPanel } from "./ShopPanel";

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

/**
 * 전경(foreground) 구역 — 캐릭터를 가려야 하는 "앞쪽" 구조물(외벽·기둥)을
 * **폴리곤**으로 정의. 캐릭터를 그린 뒤 이 폴리곤으로 클립해 원본 배경 픽셀을
 * 다시 덮어 그린다 → 곡면 외벽의 실제 윤곽을 따라 캐릭터가 뒤로 숨는다.
 * (색은 원본 그대로, 경계만 폴리곤 곡선) town_fg.png 가 있으면 그게 우선.
 * SHOW_FG=true 로 폴리곤 외곽선을 띄워 그림과 맞춰 조정.
 */
// 전경 가림은 2층 위쪽만 — 1층(바닥) 캐릭터는 가리지 않도록 여기서 끊는다.
// 바닥 캐릭터 머리 높이(≈566)보다 위. 2층(407)·계단 상단 캐릭터는 정상 가림.
const FG_BOTTOM = 548;
const FG_REGIONS: number[][][] = [
  // 좌측 외벽(곡면) — 우측 안쪽 윤곽을 따라
  [[0, 230], [388, 234], [300, 330], [190, 440], [172, FG_BOTTOM], [0, FG_BOTTOM]],
  // 우측 외벽(곡면) — 좌측 안쪽 윤곽을 따라 (창문 포함)
  [[1145, 236], [1092, 305], [1010, 430], [992, FG_BOTTOM], [WORLD_W, FG_BOTTOM], [WORLD_W, 236]],
  // 중앙 좌 기둥 (직사각 — 현재 잘 맞음)
  [[470, 150], [516, 150], [516, FG_BOTTOM], [470, FG_BOTTOM]],
  // 중앙 우 기둥
  [[864, 150], [914, 150], [914, FG_BOTTOM], [864, FG_BOTTOM]],
];

/** 폴리곤 bbox (clip 후 그 영역만 재드로해 비용 절감). */
function polyBBox(poly: number[][]): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [px, py] of poly) {
    if (px < minX) minX = px; if (px > maxX) maxX = px;
    if (py < minY) minY = py; if (py > maxY) maxY = py;
  }
  return [minX, minY, maxX - minX, maxY - minY];
}

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
  look: Look; // 장착 외형
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
  const [panel, setPanel] = useState<null | "inv" | "equip" | "shop">(null);

  // 프로필 스토어 (재화·인벤·장착)
  const equipped = usePlazaStore((s) => s.equipped);
  const loadProfile = usePlazaStore((s) => s.load);

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
  const avatarRef = useRef<HTMLImageElement | null>(null); // 내 캐릭터 스프라이트
  const myLookRef = useRef<Look>({}); // 내 장착 외형 (게임 루프용)

  // ── 배경/전경/아바타 이미지 + 프로필 로드 ─────────────────────────────────────
  useEffect(() => {
    const img = new Image();
    img.src = "/plaza/town.png";
    img.onload = () => { bgRef.current = img; };
    // 전경 컷아웃(있으면) — 없으면 onerror 로 조용히 무시하고 FG_REGIONS 폴백 사용
    const fg = new Image();
    fg.onload = () => { fgRef.current = fg; };
    fg.src = "/plaza/town_fg.png";
    // 내 캐릭터 아바타 스프라이트
    const av = new Image();
    av.onload = () => { avatarRef.current = av; };
    av.src = "/plaza/avatar_me.png";
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
        case "look": {
          const r = remotesRef.current.get(msg.id);
          if (r) r.look = msg.eq || {};
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
        vx: 0, facing: p.facing, st: p.st, look: p.look || {},
      });
    }

    return () => {
      closedByUs = true;
      if (pingTimer) clearInterval(pingTimer);
      ws.close();
      wsRef.current = null;
    };
  }, []);

  // ── 장착 외형 동기화: 변경/접속 시 WS look 송신 ───────────────────────────────
  useEffect(() => {
    myLookRef.current = equipped;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ t: "look", eq: equipped } as ClientMsg));
    }
  }, [equipped, status]);

  // ── 키 입력 ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (inputFocusedRef.current) return; // 채팅 입력 중엔 게임 키 무시
      const k = e.key;
      if (k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowDown" || k === "Alt" || k === " ") {
        keysRef.current[k] = true;
        e.preventDefault(); // Alt 메뉴 포커스·스페이스 스크롤 방지
      }
      // I=인벤토리, E=장비 (영문 키, 대소문자 모두)
      if (k === "i" || k === "I" || k === "ㅑ") { e.preventDefault(); setPanel((p) => (p === "inv" ? null : "inv")); }
      if (k === "e" || k === "E" || k === "ㄷ") { e.preventDefault(); setPanel((p) => (p === "equip" ? null : "equip")); }
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
        drawBackground(ctx, now); // 폴백 (이미지 로드 전/실패)
      }

      if (SHOW_FOOTHOLDS) {
        ctx.strokeStyle = "rgba(255,0,0,0.7)"; ctx.lineWidth = 3;
        for (const f of FOOTHOLDS) {
          ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.x + f.w, f.y); ctx.stroke();
        }
      }

      for (const r of remotesRef.current.values()) {
        drawChibi(ctx, {
          x: r.x, y: r.y, facing: r.facing, st: r.st, bodyColor: colorFor(r.id),
          name: r.name, now, look: r.look, bubble: bubbleFor(r.id, now),
        });
      }
      const LL = localRef.current;
      drawChibi(ctx, {
        x: LL.x, y: LL.y, facing: LL.facing, st: LL.st, bodyColor: colorFor(myIdRef.current),
        name: "나", now, look: myLookRef.current, isMe: true, bubble: bubbleFor(-1, now),
        avatar: avatarRef.current,
      });

      // ── 전경(foreground) — 캐릭터 위에 덮어 "건물 뒤로 숨김" 효과 ──
      if (fgRef.current) {
        ctx.drawImage(fgRef.current, 0, 0, WORLD_W, WORLD_H); // 정밀: 컷아웃 PNG
      } else if (bgRef.current) {
        for (const poly of FG_REGIONS) {
          const [bx, by, bw, bh] = polyBBox(poly);
          ctx.save();
          ctx.beginPath();
          poly.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
          ctx.closePath();
          ctx.clip();
          ctx.drawImage(bgRef.current, bx, by, bw, bh, bx, by, bw, bh); // 폴리곤 윤곽으로 원본 재드로
          ctx.restore();
        }
      }
      const SHOW_FG = false; // 전경 폴리곤 확인 시 true
      if (SHOW_FG) {
        ctx.strokeStyle = "rgba(0,120,255,0.85)"; ctx.lineWidth = 3;
        for (const poly of FG_REGIONS) {
          ctx.beginPath();
          poly.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
          ctx.closePath(); ctx.stroke();
        }
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
          <button type="button" className={`plaza-tool${panel === "inv" ? " on" : ""}`} onClick={() => setPanel((p) => (p === "inv" ? null : "inv"))}>🎒 인벤 <kbd>I</kbd></button>
          <button type="button" className={`plaza-tool${panel === "equip" ? " on" : ""}`} onClick={() => setPanel((p) => (p === "equip" ? null : "equip"))}>🧢 장비 <kbd>E</kbd></button>
          <button type="button" className={`plaza-tool${panel === "shop" ? " on" : ""}`} onClick={() => setPanel((p) => (p === "shop" ? null : "shop"))}>🛒 상점</button>
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
        {panel === "inv" && <InventoryPanel onClose={() => setPanel(null)} />}
        {panel === "equip" && <EquipPanel onClose={() => setPanel(null)} />}
        {panel === "shop" && <ShopPanel onClose={() => setPanel(null)} />}
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
const TREE_CX = 500;

// 줄기 반폭 — 위(좁음) → 아래(넓음). 가지가 줄기 옆면에서 뻗도록 좌표 계산에 사용.
function trunkHalf(y: number): number {
  const top = 230, bot = GROUND_Y;
  const r = Math.max(0, Math.min(1, (y - top) / (bot - top)));
  return 46 + r * 46; // 46 → 92
}

function drawBackground(ctx: CanvasRenderingContext2D, now: number) {
  // ── 하늘 ──
  const sky = ctx.createLinearGradient(0, 0, 0, WORLD_H);
  sky.addColorStop(0, "#3f9fe6");
  sky.addColorStop(0.42, "#82caee");
  sky.addColorStop(0.72, "#c2e7f1");
  sky.addColorStop(1, "#e9f4d8");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);

  // ── 태양 ──
  ctx.save();
  const glow = ctx.createRadialGradient(140, 120, 10, 140, 120, 190);
  glow.addColorStop(0, "rgba(255,252,228,0.95)");
  glow.addColorStop(0.4, "rgba(255,247,200,0.45)");
  glow.addColorStop(1, "rgba(255,247,200,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 380, 330);
  ctx.fillStyle = "rgba(255,253,238,0.95)";
  ctx.beginPath(); ctx.arc(140, 120, 46, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // ── 흐르는 구름 ──
  const t = now * 0.01;
  const span = WORLD_W + 260;
  drawCloud(ctx, ((180 + t) % span) - 130, 90, 1.05);
  drawCloud(ctx, ((620 + t * 0.65) % span) - 130, 150, 0.8);
  drawCloud(ctx, ((900 + t * 0.45) % span) - 130, 60, 1.25);

  // ── 먼 산 3겹 (패럴랙스 느낌) ──
  ctx.fillStyle = "#cfe6c0";
  blob(ctx, 0, GROUND_Y, [[-40, -150], [150, -230], [360, -160], [560, -250], [800, -170], [1040, -220], [1040, 80], [-40, 80]]);
  ctx.fillStyle = "#aed99a";
  blob(ctx, 0, GROUND_Y, [[-40, -90], [220, -170], [470, -110], [720, -180], [1040, -120], [1040, 80], [-40, 80]]);
  // 중간 언덕 위 작은 나무들
  for (const [bx, by, s] of [[120, 470, 1], [300, 455, 0.8], [820, 465, 1.1], [930, 450, 0.85]] as const) {
    drawBush(ctx, bx, by, 26 * s, "#7fb96a");
  }
  ctx.fillStyle = "#93cd7e";
  blob(ctx, 0, GROUND_Y, [[-40, -40], [260, -78], [540, -44], [820, -82], [1040, -50], [1040, 80], [-40, 80]]);

  // ── 양옆 돌기둥 (랜턴) ──
  drawPillar(ctx, 64, now);
  drawPillar(ctx, WORLD_W - 64, now);

  // ── 중앙 큰 나무 ──
  drawTree(ctx);

  // ── 잔디 땅 ──
  const grass = ctx.createLinearGradient(0, GROUND_Y, 0, GROUND_Y + 30);
  grass.addColorStop(0, "#79b94a");
  grass.addColorStop(1, "#5f9c38");
  ctx.fillStyle = grass;
  ctx.fillRect(0, GROUND_Y, WORLD_W, WORLD_H - GROUND_Y);
  ctx.fillStyle = "#5b4631"; // 흙
  ctx.fillRect(0, GROUND_Y + 26, WORLD_W, WORLD_H - GROUND_Y - 26);
  ctx.fillStyle = "rgba(70,52,34,0.5)"; // 흙 알갱이
  for (let i = 0; i < 26; i++) ctx.fillRect((i * 71) % WORLD_W, GROUND_Y + 34 + (i % 4) * 8, 6, 4);
  // 잔디 윗면 하이라이트
  ctx.fillStyle = "#8fce5b";
  ctx.fillRect(0, GROUND_Y, WORLD_W, 4);
  // 잔디 포기 + 꽃
  for (let i = 0; i < 30; i++) {
    const gx = 18 + i * 33;
    drawGrassTuft(ctx, gx, GROUND_Y + 2);
    if (i % 5 === 2) drawFlower(ctx, gx + 10, GROUND_Y + 1, i % 2 ? "#ff7aa8" : "#ffd34d");
  }

  // ── 나뭇가지 발판 (one-way FOOTHOLDS) ──
  for (const f of FOOTHOLDS) {
    if (f.solid) continue;
    drawLedge(ctx, f.x, f.y, f.w);
  }

  // ── 반딧불/꽃가루 파티클 ──
  ctx.save();
  for (let i = 0; i < 16; i++) {
    const px = (i * 137 + Math.sin(now / 1400 + i) * 60 + 50) % WORLD_W;
    const py = 140 + ((i * 53) % 360) + Math.sin(now / 900 + i * 2) * 22;
    const a = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(now / 600 + i));
    ctx.fillStyle = `rgba(255,250,190,${a.toFixed(3)})`;
    ctx.beginPath(); ctx.arc(px, py, 2.2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawCloud(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.94)";
  ctx.beginPath();
  ctx.ellipse(x, y, 44 * s, 27 * s, 0, 0, Math.PI * 2);
  ctx.ellipse(x + 44 * s, y + 7 * s, 35 * s, 23 * s, 0, 0, Math.PI * 2);
  ctx.ellipse(x - 42 * s, y + 9 * s, 31 * s, 20 * s, 0, 0, Math.PI * 2);
  ctx.ellipse(x + 16 * s, y - 12 * s, 30 * s, 22 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(210,232,245,0.6)"; // 아래 그림자
  ctx.beginPath(); ctx.ellipse(x, y + 16 * s, 78 * s, 12 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawBush(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x - r * 0.7, y, r * 0.7, 0, Math.PI * 2);
  ctx.arc(x + r * 0.7, y, r * 0.7, 0, Math.PI * 2);
  ctx.arc(x, y - r * 0.4, r * 0.85, 0, Math.PI * 2);
  ctx.fill();
}

function drawPillar(ctx: CanvasRenderingContext2D, x: number, now: number) {
  ctx.save();
  // 기둥
  const g = ctx.createLinearGradient(x - 22, 0, x + 22, 0);
  g.addColorStop(0, "#8d9099"); g.addColorStop(0.5, "#b9bcc4"); g.addColorStop(1, "#7d808a");
  ctx.fillStyle = g;
  roundRect(ctx, x - 20, 360, 40, GROUND_Y - 360 + 6, 6); ctx.fill();
  // 돌 이음선
  ctx.strokeStyle = "rgba(70,72,80,0.4)"; ctx.lineWidth = 2;
  for (let yy = 392; yy < GROUND_Y; yy += 36) { ctx.beginPath(); ctx.moveTo(x - 20, yy); ctx.lineTo(x + 20, yy); ctx.stroke(); }
  // 머릿돌
  ctx.fillStyle = "#9aa0aa";
  roundRect(ctx, x - 26, 346, 52, 20, 5); ctx.fill();
  // 랜턴 등불 (은은한 깜빡임)
  const flick = 0.6 + 0.25 * Math.sin(now / 240 + x);
  const lg = ctx.createRadialGradient(x, 330, 2, x, 330, 30);
  lg.addColorStop(0, `rgba(255,214,120,${(0.5 + flick * 0.4).toFixed(3)})`);
  lg.addColorStop(1, "rgba(255,214,120,0)");
  ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(x, 330, 30, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#3a3d44"; roundRect(ctx, x - 9, 320, 18, 22, 4); ctx.fill();
  ctx.fillStyle = `rgba(255,201,92,${flick.toFixed(3)})`; roundRect(ctx, x - 5, 324, 10, 14, 3); ctx.fill();
  ctx.restore();
}

function drawTree(ctx: CanvasRenderingContext2D) {
  const cx = TREE_CX;

  // ── 가지 (발판을 받치는 모양) — 캐노피·줄기보다 먼저(뒤에) ──
  ctx.strokeStyle = "#6e4f30";
  ctx.lineCap = "round";
  for (const f of FOOTHOLDS) {
    if (f.solid) continue;
    const ledgeMid = f.x + f.w / 2;
    const left = ledgeMid < cx;
    const fromX = cx + (left ? -1 : 1) * trunkHalf(f.y) * 0.7;
    const toX = left ? f.x + f.w - 14 : f.x + 14;
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(fromX, f.y + 22);
    ctx.quadraticCurveTo((fromX + toX) / 2, f.y + 4, toX, f.y + 6);
    ctx.stroke();
  }

  // ── 뿌리 ──
  ctx.fillStyle = "#6e4f30";
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + dir * 60, GROUND_Y - 40);
    ctx.quadraticCurveTo(cx + dir * 110, GROUND_Y - 6, cx + dir * 150, GROUND_Y + 6);
    ctx.lineTo(cx + dir * 90, GROUND_Y + 6);
    ctx.quadraticCurveTo(cx + dir * 70, GROUND_Y - 10, cx + dir * 30, GROUND_Y - 10);
    ctx.closePath(); ctx.fill();
  }

  // ── 줄기 ──
  const trunk = ctx.createLinearGradient(cx - 92, 0, cx + 92, 0);
  trunk.addColorStop(0, "#6e4f2f");
  trunk.addColorStop(0.45, "#9c7444");
  trunk.addColorStop(0.6, "#b08a55");
  trunk.addColorStop(1, "#67492c");
  ctx.fillStyle = trunk;
  ctx.beginPath();
  ctx.moveTo(cx - 92, GROUND_Y);
  ctx.bezierCurveTo(cx - 104, 500, cx - 58, 360, cx - 50, 240);
  ctx.quadraticCurveTo(cx, 224, cx + 50, 240);
  ctx.bezierCurveTo(cx + 58, 360, cx + 104, 500, cx + 92, GROUND_Y);
  ctx.closePath();
  ctx.fill();
  // 줄기 결
  ctx.strokeStyle = "rgba(70,48,26,0.4)"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(cx - 24, 580); ctx.bezierCurveTo(cx - 34, 460, cx - 12, 360, cx - 20, 260); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx + 26, 580); ctx.bezierCurveTo(cx + 34, 470, cx + 14, 370, cx + 22, 260); ctx.stroke();
  // 옹이
  ctx.fillStyle = "rgba(70,48,26,0.45)";
  ctx.beginPath(); ctx.ellipse(cx + 8, 430, 12, 16, 0, 0, Math.PI * 2); ctx.fill();

  // ── 매달린 간판 "광장" ──
  ctx.save();
  ctx.strokeStyle = "#5b3f24"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(cx - 34, 250); ctx.lineTo(cx - 34, 272); ctx.moveTo(cx + 34, 250); ctx.lineTo(cx + 34, 272); ctx.stroke();
  ctx.fillStyle = "#a9763e"; roundRect(ctx, cx - 52, 270, 104, 40, 8); ctx.fill();
  ctx.strokeStyle = "#7a5126"; ctx.lineWidth = 3; roundRect(ctx, cx - 52, 270, 104, 40, 8); ctx.stroke();
  ctx.fillStyle = "#fff6e0"; ctx.font = "700 24px system-ui, sans-serif"; ctx.textAlign = "center";
  ctx.fillText("광 장", cx, 298);
  ctx.restore();

  // ── 캐노피 (여러 겹 + 하이라이트) ──
  const clumps: Array<[number, number, number]> = [
    [cx, 150, 138], [cx - 132, 196, 92], [cx + 132, 196, 92],
    [cx - 78, 120, 84], [cx + 78, 120, 84], [cx, 78, 100],
    [cx - 40, 196, 70], [cx + 40, 196, 70],
  ];
  for (const [lx, ly, r] of clumps) {
    const g = ctx.createRadialGradient(lx - r * 0.35, ly - r * 0.4, r * 0.15, lx, ly, r);
    g.addColorStop(0, "#86cf6f");
    g.addColorStop(0.6, "#5cab4c");
    g.addColorStop(1, "#3c8a3e");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(lx, ly, r, 0, Math.PI * 2); ctx.fill();
  }
  // 잎 하이라이트 점
  ctx.fillStyle = "rgba(190,234,150,0.55)";
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const rr = 60 + (i % 5) * 22;
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rr, 150 + Math.sin(a) * rr * 0.7, 5, 0, Math.PI * 2); ctx.fill();
  }
}

// 나뭇가지 발판 — 윗면 y 가 충돌면. 둥근 통나무 + 잎 장식.
function drawLedge(ctx: CanvasRenderingContext2D, x: number, y: number, w: number) {
  const h = 18;
  ctx.save();
  // 그림자
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  roundRect(ctx, x + 4, y + 6, w, h, 9); ctx.fill();
  // 통나무
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, "#9c6f40"); g.addColorStop(1, "#6f4d2b");
  ctx.fillStyle = g;
  roundRect(ctx, x, y, w, h, 9); ctx.fill();
  // 윗면 이끼
  ctx.fillStyle = "#62b24f";
  roundRect(ctx, x + 3, y - 4, w - 6, 9, 5); ctx.fill();
  ctx.fillStyle = "#7cc863";
  roundRect(ctx, x + 3, y - 4, w - 6, 4, 4); ctx.fill();
  // 양끝 잎 장식
  ctx.fillStyle = "#4f9b46";
  for (const ex of [x + 8, x + w - 8]) {
    ctx.beginPath(); ctx.arc(ex, y + 1, 10, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawGrassTuft(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.strokeStyle = "#4f9434"; ctx.lineWidth = 2.2; ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.quadraticCurveTo(x - 4, y - 9, x - 6, y - 13);
  ctx.moveTo(x, y); ctx.quadraticCurveTo(x, y - 11, x + 1, y - 16);
  ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 4, y - 9, x + 7, y - 12);
  ctx.stroke();
}

function drawFlower(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.fillStyle = color;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    ctx.beginPath(); ctx.arc(x + Math.cos(a) * 3.6, y - 14 + Math.sin(a) * 3.6, 2.6, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = "#ffe9a8"; ctx.beginPath(); ctx.arc(x, y - 14, 2.2, 0, Math.PI * 2); ctx.fill();
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

