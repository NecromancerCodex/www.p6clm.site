"use client";

import { useEffect, useRef, useState } from "react";
import { X, LogIn, LogOut, RotateCcw, Bot } from "lucide-react";

import type { ClientMsg, ServerMsg } from "../../lib/plaza/protocol";
import type { Participant } from "./PlazaCanvas";
import { AvatarThumb } from "./AvatarThumb";

// 캔버스(악어 머리) 좌표계 — 표시 크기와 무관, 비율 고정
const CW = 460;
const CH = 360;
const TEETH_X0 = 70;
const TEETH_X1 = CW - 70;
const GUM_Y = 162;            // 윗잇몸 라인(윗니가 매달림)
const TOOTH_TOP = GUM_Y;      // 윗니 시작 y
const TOOTH_H = 58;           // 윗니 길이
const TOOTH_W = 26;           // 윗니 폭
const LGUM_Y = CH - 84;       // 아랫잇몸 라인
const BITE_DROP = 64;         // 입 다물 때 상악이 내려오는 거리

type GatorState = {
  teeth: number[]; turn: number | null; status: "waiting" | "playing" | "done";
  players: number[]; loser: number | null; vsAI: boolean; count: number; trap: number;
};

/** i 번째 윗니의 기하 (클릭 판정 + 그리기 공용). */
function toothGeom(i: number, n: number) {
  const span = (TEETH_X1 - TEETH_X0) / n;
  const cx = TEETH_X0 + span * (i + 0.5);
  return { cx, x: cx - TOOTH_W / 2, w: TOOTH_W };
}

/** 윗면만 둥근 사각형(잇몸 바닥은 직선) 경로. */
function topRound(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
}

/** 광택 이빨 — 위(상악)/아래(하악) 공용. up=true 면 위로 뾰족. */
function tooth(ctx: CanvasRenderingContext2D, cx: number, base: number, w: number, h: number, up: boolean, kind: "" | "pressed" | "trap") {
  const tip = up ? base - h : base + h;
  const g = ctx.createLinearGradient(0, up ? tip : base, 0, up ? base : tip);
  if (kind === "trap") { g.addColorStop(0, "#ff9d9d"); g.addColorStop(1, "#ff3b3b"); }
  else if (kind === "pressed") { g.addColorStop(0, "#b9a89c"); g.addColorStop(1, "#8c7a6e"); }
  else { g.addColorStop(0, "#ffffff"); g.addColorStop(1, "#ddd6c0"); }
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, base);
  ctx.lineTo(cx + w / 2, base);
  const mid = base + (up ? -h * 0.45 : h * 0.45);
  ctx.quadraticCurveTo(cx + w / 2, mid, cx, tip);
  ctx.quadraticCurveTo(cx - w / 2, mid, cx - w / 2, base);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(60,40,20,0.18)"; ctx.lineWidth = 1; ctx.stroke();
}

function eye(ctx: CanvasRenderingContext2D, ex: number, ey: number, green: CanvasGradient | string) {
  ctx.fillStyle = green;
  ctx.beginPath(); ctx.arc(ex, ey, 26, 0, Math.PI * 2); ctx.fill();          // 눈두덩 혹
  ctx.fillStyle = "#fdfdf6";
  ctx.beginPath(); ctx.arc(ex, ey + 2, 15, 0, Math.PI * 2); ctx.fill();      // 흰자
  ctx.fillStyle = "#1a2230";
  ctx.beginPath(); ctx.arc(ex + 3, ey + 4, 7, 0, Math.PI * 2); ctx.fill();   // 눈동자
  ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.arc(ex, ey, 3, 0, Math.PI * 2); ctx.fill();           // 하이라이트
  // 윗눈꺼풀
  ctx.fillStyle = green;
  ctx.beginPath(); ctx.moveTo(ex - 18, ey - 4);
  ctx.quadraticCurveTo(ex, ey - 26, ex + 18, ey - 4);
  ctx.quadraticCurveTo(ex, ey - 10, ex - 18, ey - 4); ctx.closePath(); ctx.fill();
}

/** 악어이빨 룸 — 차례대로 이빨을 누르다 함정 이빨을 누른 사람이 패배. 독립 세션. */
export function GatorRoom({
  send, register, onClose, participants,
}: {
  send: (m: ClientMsg) => void;
  register: (h: ((m: ServerMsg) => void) | null) => void;
  onClose: () => void;
  participants: Participant[];
}) {
  const myId = participants.find((p) => p.me)?.id ?? -1;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [st, setSt] = useState<GatorState | null>(null);
  const stRef = useRef<GatorState | null>(null);
  const biteRef = useRef(0);  // 0..1 입 다무는 정도(애니메이션)
  const rafRef = useRef(0);

  useEffect(() => {
    const handler = (m: ServerMsg) => { if (m.t === "gator_state") { stRef.current = m; setSt(m); } };
    register(handler);
    send({ t: "gator_sync" });
    return () => { register(null); cancelAnimationFrame(rafRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 악어 그리기 (bite = 입 다문 정도 0..1)
  const drawGator = (bite: number) => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    const s = stRef.current;
    const n = s?.count ?? 12;
    const drop = bite * BITE_DROP;
    ctx.clearRect(0, 0, CW, CH);

    const green = ctx.createLinearGradient(0, 0, 0, CH);
    green.addColorStop(0, "#67c46d"); green.addColorStop(0.55, "#3fa34d"); green.addColorStop(1, "#287a35");

    // ── 입 안(붉은 그라데이션) + 혀 ──
    const mouth = ctx.createLinearGradient(0, GUM_Y - 20, 0, LGUM_Y + 20);
    mouth.addColorStop(0, "#8a1b2c"); mouth.addColorStop(1, "#3a0810");
    ctx.fillStyle = mouth;
    ctx.beginPath(); ctx.ellipse(CW / 2, (GUM_Y + LGUM_Y) / 2, CW / 2 - 44, (LGUM_Y - GUM_Y) / 2 + 26, 0, 0, Math.PI * 2); ctx.fill();
    const tongue = ctx.createRadialGradient(CW / 2, LGUM_Y - 4, 8, CW / 2, LGUM_Y - 4, 150);
    tongue.addColorStop(0, "#ff8694"); tongue.addColorStop(1, "#cf3a4a");
    ctx.fillStyle = tongue;
    ctx.beginPath(); ctx.ellipse(CW / 2, LGUM_Y + 8, 130, 42, 0, Math.PI, 0); ctx.fill();

    // ── 하악(고정) + 아랫니 ──
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.3)"; ctx.shadowBlur = 12; ctx.shadowOffsetY = 3;
    ctx.fillStyle = green;
    ctx.beginPath();
    ctx.moveTo(18, LGUM_Y - 6);
    ctx.lineTo(CW - 18, LGUM_Y - 6);
    ctx.lineTo(CW - 18, CH - 26);
    ctx.arcTo(CW - 18, CH - 6, CW - 44, CH - 6, 22);
    ctx.lineTo(44, CH - 6);
    ctx.arcTo(18, CH - 6, 18, CH - 26, 22);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    for (let i = 0; i < n; i++) {                          // 아랫니(윗니와 엇갈리게)
      const g = toothGeom(i, n);
      const lx = g.cx + (TEETH_X1 - TEETH_X0) / n / 2;
      if (lx > TEETH_X1 - 4) continue;
      tooth(ctx, lx, LGUM_Y - 4, TOOTH_W * 0.82, TOOTH_H * 0.62, true, "");
    }

    // ── 상악(입 다물면 drop 만큼 하강) ──
    ctx.save();
    ctx.translate(0, drop);

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.35)"; ctx.shadowBlur = 16; ctx.shadowOffsetY = 4;
    ctx.fillStyle = green;
    topRound(ctx, 16, 60, CW - 32, GUM_Y - 60, 70);        // 스나우트(주둥이)
    ctx.fill();
    ctx.restore();

    // 콧등 하이라이트
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    topRound(ctx, 70, 74, CW - 140, 34, 17); ctx.fill();
    // 비늘 돌기(머리 위)
    ctx.fillStyle = "#36963f";
    for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.arc(CW / 2 + i * 30, 64, 8, 0, Math.PI * 2); ctx.fill(); }
    // 콧구멍(주둥이 끝)
    for (const nx of [CW / 2 - 28, CW / 2 + 28]) {
      ctx.fillStyle = "#2c7d3c"; ctx.beginPath(); ctx.arc(nx, 92, 13, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#14391a"; ctx.beginPath(); ctx.ellipse(nx, 92, 4, 7, 0, 0, Math.PI * 2); ctx.fill();
    }
    // 눈(좌우 큰 혹)
    eye(ctx, 60, 52, green);
    eye(ctx, CW - 60, 52, green);

    // 윗니
    for (let i = 0; i < n; i++) {
      const g = toothGeom(i, n);
      const kind: "" | "pressed" | "trap" =
        (s?.status === "done" && s.trap === i) ? "trap" : (s?.teeth?.[i] ? "pressed" : "");
      const h = TOOTH_H * (i % 2 === 0 ? 1 : 0.86);        // 길이 살짝 교차
      tooth(ctx, g.cx, GUM_Y, TOOTH_W, h, false, kind);
      if (kind === "trap") {
        ctx.font = "16px system-ui"; ctx.textAlign = "center";
        ctx.fillText("💥", g.cx, GUM_Y + 26);
      }
    }
    ctx.restore();
  };

  // 상태 변화 → 그리기. done 진입 시 '쾅' 애니메이션.
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    if (st?.status === "done") {
      const t0 = performance.now();
      const tick = (now: number) => {
        const k = Math.min(1, (now - t0) / 360);
        biteRef.current = k * k;  // ease-in
        drawGator(biteRef.current);
        if (k < 1) rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } else {
      biteRef.current = 0;
      drawGator(0);
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [st]);

  const seated = !!st?.players?.includes(myId);
  const myTurn = st?.status === "playing" && st.turn === myId;

  const press = (e: React.PointerEvent) => {
    const s = stRef.current;
    if (!s || s.status !== "playing" || s.turn !== myId) return;
    const c = canvasRef.current!; const r = c.getBoundingClientRect();
    const px = (e.clientX - r.left) * (CW / r.width);
    const py = (e.clientY - r.top) * (CH / r.height);
    if (py < TOOTH_TOP - 12 || py > TOOTH_TOP + TOOTH_H + 14) return;
    for (let i = 0; i < s.count; i++) {
      if (s.teeth[i]) continue;
      const g = toothGeom(i, s.count);
      if (px >= g.x - 5 && px <= g.x + g.w + 5) { send({ t: "gator_press", tooth: i }); return; }
    }
  };

  const nameOf = (pid: number | null) =>
    pid == null ? "?" : pid === 0 ? "🤖 AI" : (participants.find((p) => p.id === pid)?.name ?? "?");
  const avatarOf = (pid: number) => (pid !== 0 ? participants.find((p) => p.id === pid)?.avatar : undefined);

  const statusText = () => {
    if (!st) return "불러오는 중…";
    if (st.status === "waiting") return "참가하여 시작하세요 (2명 이상)";
    if (st.status === "done") {
      return st.loser === myId ? "앗! 당신이 물렸어요 😖"
        : `${nameOf(st.loser)} 물림! 😆 (다른 사람 생존)`;
    }
    return `${nameOf(st.turn)} 차례${myTurn ? " — 당신!" : ""}`;
  };

  return (
    <div className="plaza-board-backdrop" onClick={onClose}>
      <div className="plaza-room plaza-gator" onClick={(e) => e.stopPropagation()}>
        <div className="plaza-panel-head">
          <span className="plaza-panel-title">🐊 악어이빨</span>
          <span className="plaza-game-status">{statusText()}</span>
          <button type="button" className="plaza-panel-x" onClick={onClose} aria-label="닫기"><X size={16} /></button>
        </div>

        <div className="plaza-gator-body">
          {/* 참가자 칩 */}
          <div className="plaza-gator-players">
            {(st?.players ?? []).map((pid) => {
              const av = avatarOf(pid);
              const isTurn = st?.status === "playing" && st.turn === pid;
              const isLoser = st?.status === "done" && st.loser === pid;
              return (
                <div key={pid} className={`plaza-gator-chip${isTurn ? " turn" : ""}${isLoser ? " loser" : ""}`}>
                  {av ? <AvatarThumb config={av} w={34} h={40} /> : <span className="plaza-gator-aiav">🤖</span>}
                  <span className="plaza-pcard-name">{nameOf(pid)}{pid === myId ? "(나)" : ""}</span>
                  {isLoser && <span className="plaza-gator-bite">💥</span>}
                </div>
              );
            })}
            {(st?.players?.length ?? 0) === 0 && <span className="plaza-gator-empty">아직 참가자가 없어요</span>}
          </div>

          {/* 악어 */}
          <div className="plaza-gator-canvaswrap">
            <canvas ref={canvasRef} width={CW} height={CH} className="plaza-gator-canvas"
              onPointerDown={press} style={{ cursor: myTurn ? "pointer" : "default" }} />
            {myTurn && <div className="plaza-gator-hint">이빨 하나를 눌러요… 🤞</div>}
          </div>

          {/* 컨트롤 */}
          <div className="plaza-omok-controls">
            {!seated && st?.status !== "playing" && (
              <button type="button" className="plaza-game-start"
                disabled={(st?.players?.length ?? 0) >= 6} onClick={() => send({ t: "gator_join" })}>
                <LogIn size={14} /> 참가
              </button>
            )}
            {seated && st?.status === "waiting" && (
              <>
                <button type="button" className="plaza-game-start"
                  disabled={(st?.players?.length ?? 0) < 2} onClick={() => send({ t: "gator_start", vsAI: false })}>
                  게임 시작
                </button>
                <button type="button" className="plaza-diff-btn" onClick={() => send({ t: "gator_start", vsAI: true })}>
                  <Bot size={13} /> AI와 시작
                </button>
              </>
            )}
            {seated && st?.status === "done" && (
              <button type="button" className="plaza-game-start" onClick={() => send({ t: "gator_reset" })}>
                <RotateCcw size={14} /> 한 판 더
              </button>
            )}
            {seated && (
              <button type="button" className="plaza-omok-leave" onClick={() => send({ t: "gator_leave" })}>
                <LogOut size={14} /> 나가기
              </button>
            )}
            {!seated && st?.status === "playing" && <span className="plaza-omok-spec">👀 관전 중</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
