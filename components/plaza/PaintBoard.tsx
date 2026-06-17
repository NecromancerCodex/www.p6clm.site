"use client";

import { useEffect, useRef, useState } from "react";
import { X, Trash2, Eraser, Pencil, Send, Play } from "lucide-react";

import type { ClientMsg, ServerMsg, Stroke } from "../../lib/plaza/protocol";
import type { Participant, ChatLine, GameView } from "./PlazaCanvas";
import { AvatarThumb } from "./AvatarThumb";

const BW = 640, BH = 420;
const COLORS = ["#222222", "#e03131", "#f08c00", "#f5c518", "#2f9e44", "#1971c2", "#7048e8", "#e64980", "#ffffff"];
const SIZES = [3, 6, 12, 22];

function PlayerCard({ p, game }: { p: Participant | null; game: GameView | null }) {
  if (!p) return <div className="plaza-pcard plaza-pcard--empty">비어 있음</div>;
  const score = game?.scores[String(p.id)] ?? 0;
  const isDrawer = game?.drawerId === p.id;
  const correct = game?.guessed.includes(p.id);
  return (
    <div className={`plaza-pcard${p.me ? " me" : ""}${correct ? " correct" : ""}`}>
      <AvatarThumb config={p.avatar} />
      <div className="plaza-pcard-info">
        <span className="plaza-pcard-name">{isDrawer && "✏️ "}{p.me ? `${p.name}(나)` : p.name}</span>
        {game && <span className="plaza-pcard-score">{score}점</span>}
      </div>
      {correct && <span className="plaza-pcard-badge">정답!</span>}
    </div>
  );
}

export function PaintBoard({
  send, register, onClose, participants, chatLog, sendChat, onChatFocus, game, startGame,
}: {
  send: (m: ClientMsg) => void;
  register: (h: ((m: ServerMsg) => void) | null) => void;
  onClose: () => void;
  participants: Participant[];
  chatLog: ChatLine[];
  sendChat: (text: string) => void;
  onChatFocus: (focused: boolean) => void;
  game: GameView | null;
  startGame: () => void;
}) {
  const myId = participants.find((p) => p.me)?.id ?? -1;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const [color, setColor] = useState("#222222");
  const [width, setWidth] = useState(6);
  const [eraser, setEraser] = useState(false);
  const [chatValue, setChatValue] = useState("");
  const [remain, setRemain] = useState(0);
  const chatLogRef = useRef<HTMLDivElement | null>(null);

  const drawing = useRef(false);
  const curPts = useRef<number[][]>([]);
  const colorRef = useRef(color);
  const widthRef = useRef(width);
  const eraserRef = useRef(eraser);
  useEffect(() => { colorRef.current = color; widthRef.current = width; eraserRef.current = eraser; }, [color, width, eraser]);

  const playing = game?.status === "playing";
  const isDrawer = !!game && game.drawerId === myId;
  const canDraw = !game ? true : playing && isDrawer;

  // 남은 시간 카운트다운 (Date.now()는 effect 안에서만)
  useEffect(() => {
    if (!playing || !game) return;
    const upd = () => setRemain(Math.max(0, Math.ceil((game.endsAt - Date.now()) / 1000)));
    const id = window.setInterval(upd, 250);
    return () => window.clearInterval(id);
  }, [playing, game]);

  const drawPoly = (pts: number[][], c: string, w: number) => {
    const ctx = ctxRef.current;
    if (!ctx || pts.length < 1) return;
    ctx.strokeStyle = c; ctx.fillStyle = c;
    ctx.lineWidth = w; ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (pts.length === 1) { ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], w / 2, 0, Math.PI * 2); ctx.fill(); return; }
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  };
  const clearBoard = () => {
    const ctx = ctxRef.current;
    if (ctx) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, BW, BH); }
  };

  useEffect(() => {
    ctxRef.current = canvasRef.current?.getContext("2d") ?? null;
    clearBoard();
    const handler = (m: ServerMsg) => {
      if (m.t === "draw") drawPoly(m.pts, m.c, m.w);
      else if (m.t === "board_clear") clearBoard();
      else if (m.t === "board_init") { clearBoard(); m.strokes.forEach((s: Stroke) => drawPoly(s.pts, s.c, s.w)); }
    };
    register(handler);
    send({ t: "board_open" });
    return () => register(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { const el = chatLogRef.current; if (el) el.scrollTop = el.scrollHeight; }, [chatLog]);

  const toCanvas = (e: React.PointerEvent): [number, number] => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return [(e.clientX - r.left) * (BW / r.width), (e.clientY - r.top) * (BH / r.height)];
  };
  const effColor = () => (eraserRef.current ? "#ffffff" : colorRef.current);
  const flush = () => {
    if (curPts.current.length >= 2) {
      send({ t: "draw", pts: curPts.current.slice(), c: effColor(), w: widthRef.current });
      curPts.current = [curPts.current[curPts.current.length - 1]];
    }
  };
  const onDown = (e: React.PointerEvent) => {
    if (!canDraw) return;
    drawing.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const p = toCanvas(e); curPts.current = [p]; drawPoly([p], effColor(), widthRef.current);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const p = toCanvas(e); const prev = curPts.current[curPts.current.length - 1];
    drawPoly([prev, p], effColor(), widthRef.current); curPts.current.push(p);
    if (curPts.current.length >= 10) flush();
  };
  const onUp = () => { if (drawing.current) { flush(); drawing.current = false; curPts.current = []; } };

  const submitChat = (e: React.FormEvent) => {
    e.preventDefault();
    const t = chatValue.trim();
    if (t) sendChat(t);
    setChatValue("");
  };

  const drawerName = game ? (participants.find((p) => p.id === game.drawerId)?.name ?? "?") : "";
  const card = (i: number) => <PlayerCard key={i} p={participants[i] ?? null} game={game} />;

  return (
    <div className="plaza-board-backdrop" onClick={onClose}>
      <div className="plaza-room" onClick={(e) => e.stopPropagation()}>
        <div className="plaza-panel-head">
          <span className="plaza-panel-title">🎯 그림퀴즈</span>
          {game ? (
            <span className="plaza-game-status">
              라운드 {game.round}/{game.total} · 출제자 <b>{drawerName}</b>
              {playing && <span className={`plaza-timer${remain <= 10 ? " low" : ""}`}> · ⏱ {remain}s</span>}
            </span>
          ) : (
            <span className="plaza-game-status">참가 {participants.length}명 · 2명 이상이면 시작 가능</span>
          )}
          {!game && (
            <button type="button" className="plaza-game-start" disabled={participants.length < 2} onClick={startGame}>
              <Play size={14} /> 게임 시작
            </button>
          )}
          <button type="button" className="plaza-panel-x" onClick={onClose} aria-label="닫기"><X size={16} /></button>
        </div>

        <div className="plaza-room-body">
          <div className="plaza-room-side">{[0, 1, 2, 3].map(card)}</div>

          <div className="plaza-room-center">
            {/* 제시어 바 */}
            {playing && (
              <div className="plaza-word-bar">
                {isDrawer
                  ? <>제시어: <b>{game!.myWord}</b> — 그려주세요!</>
                  : <>제시어 <b>{game!.wordLen}</b>글자 — 맞혀보세요! <span className="plaza-word-blanks">{"_ ".repeat(game!.wordLen)}</span></>}
              </div>
            )}

            {/* 도구 (그릴 수 있을 때만) */}
            {canDraw && (
              <div className="plaza-board-tools">
                {COLORS.map((c) => (
                  <button key={c} type="button" className={`plaza-board-color${!eraser && color === c ? " on" : ""}`}
                    style={{ background: c }} onClick={() => { setColor(c); setEraser(false); }} aria-label={`색 ${c}`} />
                ))}
                <span className="plaza-board-sep" />
                {SIZES.map((s) => (
                  <button key={s} type="button" className={`plaza-board-size${width === s ? " on" : ""}`} onClick={() => setWidth(s)}>
                    <span style={{ width: s, height: s }} />
                  </button>
                ))}
                <span className="plaza-board-sep" />
                <button type="button" className={`plaza-board-btn${!eraser ? " on" : ""}`} onClick={() => setEraser(false)} title="펜"><Pencil size={15} /></button>
                <button type="button" className={`plaza-board-btn${eraser ? " on" : ""}`} onClick={() => setEraser(true)} title="지우개"><Eraser size={15} /></button>
                <button type="button" className="plaza-board-btn" onClick={() => { clearBoard(); send({ t: "board_clear" }); }} title="전체 지우기"><Trash2 size={15} /></button>
              </div>
            )}

            <div className="plaza-canvas-wrap">
              <canvas ref={canvasRef} width={BW} height={BH}
                className={`plaza-board-canvas${canDraw ? "" : " locked"}`}
                onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} />

              {/* 라운드 종료 / 게임 오버 오버레이 */}
              {game?.over && (
                <div className="plaza-game-overlay">
                  <div className="plaza-game-overlay-title">🏆 게임 종료!</div>
                  <ol className="plaza-rank">
                    {Object.entries(game.over).sort((a, b) => b[1] - a[1]).map(([id, sc]) => (
                      <li key={id}>{participants.find((p) => p.id === Number(id))?.name ?? "?"} — <b>{sc}점</b></li>
                    ))}
                  </ol>
                </div>
              )}
              {!game?.over && game?.status === "intermission" && game.roundWord && (
                <div className="plaza-game-overlay">
                  <div className="plaza-game-overlay-title">정답은 <b>{game.roundWord}</b>!</div>
                  <div className="plaza-game-overlay-sub">다음 라운드 준비 중…</div>
                </div>
              )}
            </div>

            <div className="plaza-room-chat">
              <div className="plaza-room-chatlog" ref={chatLogRef}>
                {chatLog.map((l, i) => (
                  <div key={i} className="plaza-room-chatline"><b>{l.name}</b> {l.text}</div>
                ))}
              </div>
              <form className="plaza-room-chatform" onSubmit={submitChat}>
                <input className="plaza-chat-input" value={chatValue}
                  onChange={(e) => setChatValue(e.target.value)}
                  onFocus={() => onChatFocus(true)} onBlur={() => onChatFocus(false)}
                  placeholder={playing && !isDrawer ? "정답을 입력하세요…" : "메시지 입력…"} maxLength={200} />
                <button type="submit" className="plaza-board-btn" aria-label="전송"><Send size={15} /></button>
              </form>
            </div>
          </div>

          <div className="plaza-room-side">{[4, 5, 6, 7].map(card)}</div>
        </div>
      </div>
    </div>
  );
}
