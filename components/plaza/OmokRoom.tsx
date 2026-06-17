"use client";

import { useEffect, useRef, useState } from "react";
import { X, RotateCcw, Bot, LogIn } from "lucide-react";

import type { ClientMsg, ServerMsg } from "../../lib/plaza/protocol";
import type { Participant } from "./PlazaCanvas";
import { AvatarThumb } from "./AvatarThumb";

const N = 15;
const PAD = 18;          // 보드 여백
const CELL = 22;         // 칸 간격
const SIZE = PAD * 2 + CELL * (N - 1);

type OmokState = {
  board: number[][]; turn: number; status: "waiting" | "playing" | "done";
  black: number | null; white: number | null; winner: number | null; vsAI: boolean;
};

/** 오목 룸 — 2인 대국 + 관전, 상대 없으면 AI. 그림퀴즈/돌림판과 독립 세션. */
export function OmokRoom({
  send, register, onClose, participants,
}: {
  send: (m: ClientMsg) => void;
  register: (h: ((m: ServerMsg) => void) | null) => void;
  onClose: () => void;
  participants: Participant[];
}) {
  const myId = participants.find((p) => p.me)?.id ?? -1;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [st, setSt] = useState<OmokState | null>(null);

  useEffect(() => {
    const handler = (m: ServerMsg) => { if (m.t === "omok_state") setSt(m); };
    register(handler);
    send({ t: "omok_sync" });
    return () => register(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 보드 그리기
  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    ctx.fillStyle = "#e3b96b"; ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.strokeStyle = "rgba(60,40,15,0.7)"; ctx.lineWidth = 1;
    for (let i = 0; i < N; i++) {
      const p = PAD + i * CELL;
      ctx.beginPath(); ctx.moveTo(PAD, p); ctx.lineTo(SIZE - PAD, p); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(p, PAD); ctx.lineTo(p, SIZE - PAD); ctx.stroke();
    }
    // 화점
    ctx.fillStyle = "rgba(60,40,15,0.8)";
    for (const [hx, hy] of [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]]) {
      ctx.beginPath(); ctx.arc(PAD + hx * CELL, PAD + hy * CELL, 3, 0, Math.PI * 2); ctx.fill();
    }
    const bd = st?.board;
    if (bd) {
      for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) {
        const v = bd[x][y]; if (!v) continue;
        const cx = PAD + x * CELL, cy = PAD + y * CELL;
        const g = ctx.createRadialGradient(cx - 3, cy - 3, 1, cx, cy, CELL / 2 - 1);
        if (v === 1) { g.addColorStop(0, "#555"); g.addColorStop(1, "#000"); }
        else { g.addColorStop(0, "#fff"); g.addColorStop(1, "#bbb"); }
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, CELL / 2 - 1.5, 0, Math.PI * 2); ctx.fill();
      }
    }
  }, [st]);

  const myColor = st ? (myId === st.black ? 1 : myId === st.white ? 2 : 0) : 0;
  const seated = myColor !== 0;
  const myTurn = st?.status === "playing" && seated && st.turn === myColor;

  const click = (e: React.PointerEvent) => {
    if (!st || !myTurn) return;
    const c = canvasRef.current!; const r = c.getBoundingClientRect();
    const px = (e.clientX - r.left) * (SIZE / r.width);
    const py = (e.clientY - r.top) * (SIZE / r.height);
    const x = Math.round((px - PAD) / CELL), y = Math.round((py - PAD) / CELL);
    if (x < 0 || x >= N || y < 0 || y >= N) return;
    if (st.board[x][y] !== 0) return;
    send({ t: "omok_move", x, y });
  };

  const nameOf = (pid: number | null) =>
    pid == null ? "비어 있음" : pid === 0 ? "🤖 AI" : (participants.find((p) => p.id === pid)?.name ?? "?");
  const avatarOf = (pid: number | null) => (pid && pid !== 0 ? participants.find((p) => p.id === pid)?.avatar : undefined);

  const seat = (color: number) => {
    const pid = color === 1 ? st?.black ?? null : st?.white ?? null;
    const av = avatarOf(pid);
    const isTurn = st?.status === "playing" && st.turn === color;
    return (
      <div className={`plaza-omok-seat${isTurn ? " turn" : ""}`}>
        <span className={`plaza-omok-stone ${color === 1 ? "b" : "w"}`} />
        {av ? <AvatarThumb config={av} w={40} h={48} /> : <span className="plaza-omok-noav" />}
        <span className="plaza-pcard-name">{nameOf(pid)}{pid === myId ? "(나)" : ""}</span>
      </div>
    );
  };

  const statusText = () => {
    if (!st) return "불러오는 중…";
    if (st.status === "waiting") return "참가하여 좌석을 채우세요 (흑/백)";
    if (st.status === "done") return st.winner ? `${st.winner === 1 ? "흑" : "백"} (${nameOf(st.winner === 1 ? st.black : st.white)}) 승리! 🏆` : "종료";
    return `${st.turn === 1 ? "흑" : "백"} 차례${myTurn ? " — 당신!" : ""}`;
  };

  return (
    <div className="plaza-board-backdrop" onClick={onClose}>
      <div className="plaza-room plaza-omok" onClick={(e) => e.stopPropagation()}>
        <div className="plaza-panel-head">
          <span className="plaza-panel-title">⚫ 오목</span>
          <span className="plaza-game-status">{statusText()}</span>
          <button type="button" className="plaza-panel-x" onClick={onClose} aria-label="닫기"><X size={16} /></button>
        </div>

        <div className="plaza-omok-body">
          {seat(2)}
          <div className="plaza-omok-boardwrap">
            <canvas ref={canvasRef} width={SIZE} height={SIZE} className="plaza-omok-canvas"
              onPointerDown={click} style={{ cursor: myTurn ? "pointer" : "default" }} />
            {st?.status === "done" && <div className="plaza-omok-over">{statusText()}</div>}
          </div>
          {seat(1)}

          <div className="plaza-omok-controls">
            {!seated && st?.status !== "playing" && (
              <button type="button" className="plaza-game-start" onClick={() => send({ t: "omok_join" })}>
                <LogIn size={14} /> 참가
              </button>
            )}
            {seated && st?.status === "waiting" && (
              <>
                <button type="button" className="plaza-game-start" onClick={() => send({ t: "omok_start", vsAI: false })}>대국 시작</button>
                <button type="button" className="plaza-diff-btn" onClick={() => send({ t: "omok_start", vsAI: true })}>
                  <Bot size={13} /> AI와 시작
                </button>
              </>
            )}
            {seated && st?.status === "done" && (
              <button type="button" className="plaza-game-start" onClick={() => send({ t: "omok_reset" })}>
                <RotateCcw size={14} /> 한 판 더
              </button>
            )}
            {!seated && st?.status === "playing" && <span className="plaza-omok-spec">👀 관전 중</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
