"use client";

import { useEffect, useRef, useState } from "react";
import { X, LogIn, LogOut, RotateCcw, Bot } from "lucide-react";

import type { ClientMsg, ServerMsg } from "../../lib/plaza/protocol";
import type { Participant } from "./PlazaCanvas";
import { AvatarThumb } from "./AvatarThumb";

// 캔버스(악어 머리) 좌표계 — 표시 크기와 무관, 비율 고정
const CW = 420;
const CH = 300;
const TEETH_X0 = 50;
const TEETH_X1 = CW - 50;
const TOOTH_TOP = 92;   // 윗니가 매달린 y
const TOOTH_H = 54;     // 윗니 길이
const TOOTH_W = 22;     // 윗니 폭
const BITE_DROP = 80;   // 입 다물 때 상악이 내려오는 거리

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

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
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

  // 악어 그리기 (bite = 입 다문 정도)
  const drawGator = (bite: number) => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    const s = stRef.current;
    const n = s?.count ?? 12;
    const drop = bite * BITE_DROP;
    ctx.clearRect(0, 0, CW, CH);

    // 입 안(어두운 빨강)
    ctx.fillStyle = "#4a0f1a";
    rr(ctx, 22, 70, CW - 44, CH - 130, 16); ctx.fill();

    // ── 하악(고정) + 아랫니 ──
    ctx.fillStyle = "#2f8f3f";
    rr(ctx, 6, CH - 64, CW - 12, 84, 22); ctx.fill();
    ctx.fillStyle = "#f3f1e6";
    for (let i = 0; i < n; i++) {
      const g = toothGeom(i + 0.5, n + 1);
      if (g.cx < TEETH_X0 || g.cx > TEETH_X1) continue;
      ctx.beginPath();
      ctx.moveTo(g.x, CH - 64); ctx.lineTo(g.x + g.w, CH - 64);
      ctx.lineTo(g.cx, CH - 64 - 22); ctx.closePath(); ctx.fill();
    }

    // ── 상악(입 다물면 drop 만큼 하강) + 윗니(클릭 대상) ──
    ctx.save();
    ctx.translate(0, drop);
    ctx.fillStyle = "#3aa04e";
    rr(ctx, 6, -46, CW - 12, 138, 26); ctx.fill();
    // 콧등 하이라이트
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    rr(ctx, 30, -38, CW - 60, 22, 11); ctx.fill();
    // 콧구멍
    ctx.fillStyle = "#256b30";
    ctx.beginPath(); ctx.ellipse(CW / 2 - 34, -26, 7, 10, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(CW / 2 + 34, -26, 7, 10, 0, 0, Math.PI * 2); ctx.fill();
    // 눈 (두 혹)
    for (const ex of [CW / 2 - 70, CW / 2 + 70]) {
      ctx.fillStyle = "#3aa04e";
      ctx.beginPath(); ctx.arc(ex, -54, 20, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(ex, -54, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#1a2332";
      ctx.beginPath(); ctx.arc(ex + 2, -52, 5, 0, Math.PI * 2); ctx.fill();
    }
    // 윗니
    for (let i = 0; i < n; i++) {
      const g = toothGeom(i, n);
      const pressed = !!s?.teeth?.[i];
      const isTrap = s?.status === "done" && s.trap === i;
      const h = pressed ? TOOTH_H * 0.34 : TOOTH_H;
      ctx.fillStyle = isTrap ? "#ff5252" : pressed ? "#9a5b4e" : "#f7f5ea";
      ctx.beginPath();
      ctx.moveTo(g.x, TOOTH_TOP); ctx.lineTo(g.x + g.w, TOOTH_TOP);
      ctx.lineTo(g.cx, TOOTH_TOP + h); ctx.closePath(); ctx.fill();
      if (isTrap) {  // 함정 표식
        ctx.fillStyle = "#fff"; ctx.font = "700 14px system-ui";
        ctx.textAlign = "center"; ctx.fillText("💥", g.cx, TOOTH_TOP + 18);
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
    if (py < TOOTH_TOP - 10 || py > TOOTH_TOP + TOOTH_H + 12) return;
    for (let i = 0; i < s.count; i++) {
      if (s.teeth[i]) continue;
      const g = toothGeom(i, s.count);
      if (px >= g.x - 4 && px <= g.x + g.w + 4) { send({ t: "gator_press", tooth: i }); return; }
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
