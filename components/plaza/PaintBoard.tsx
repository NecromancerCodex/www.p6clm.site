"use client";

import { useEffect, useRef, useState } from "react";
import { X, Trash2, Eraser, Pencil, Send } from "lucide-react";

import type { ClientMsg, ServerMsg, Stroke } from "../../lib/plaza/protocol";
import { loadManifest, composeAvatar, type AvatarConfig } from "../../lib/plaza/parts";
import type { Participant, ChatLine } from "./PlazaCanvas";

const BW = 640, BH = 420;
const COLORS = ["#222222", "#e03131", "#f08c00", "#f5c518", "#2f9e44", "#1971c2", "#7048e8", "#e64980", "#ffffff"];
const SIZES = [3, 6, 12, 22];
const SLOTS = 8;

/** 참가자 카드의 아바타 미리보기 (합성). */
function AvatarThumb({ config }: { config: AvatarConfig }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    let alive = true;
    void loadManifest().then((m) => composeAvatar(m, config)).then((res) => {
      if (!alive || !res) return;
      const c = ref.current; if (!c) return;
      const ctx = c.getContext("2d"); if (!ctx) return;
      ctx.clearRect(0, 0, c.width, c.height);
      const scale = Math.min(c.width / res.w, c.height / res.h);
      const dw = res.w * scale, dh = res.h * scale;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(res.canvas, (c.width - dw) / 2, c.height - dh, dw, dh);
    });
    return () => { alive = false; };
  }, [config]);
  return <canvas ref={ref} width={54} height={64} className="plaza-pcard-av" />;
}

function PlayerCard({ p }: { p: Participant | null }) {
  if (!p) return <div className="plaza-pcard plaza-pcard--empty">비어 있음</div>;
  return (
    <div className={`plaza-pcard${p.me ? " me" : ""}`}>
      <AvatarThumb config={p.avatar} />
      <span className="plaza-pcard-name">{p.me ? `${p.name} (나)` : p.name}</span>
    </div>
  );
}

/** 광장 공유 그림판 — 캐치마인드식 룸(가운데 보드 + 참가자 8 + 채팅). */
export function PaintBoard({
  send, register, onClose, participants, chatLog, sendChat, onChatFocus,
}: {
  send: (m: ClientMsg) => void;
  register: (h: ((m: ServerMsg) => void) | null) => void;
  onClose: () => void;
  participants: Participant[];
  chatLog: ChatLine[];
  sendChat: (text: string) => void;
  onChatFocus: (focused: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const [color, setColor] = useState("#222222");
  const [width, setWidth] = useState(6);
  const [eraser, setEraser] = useState(false);
  const [chatValue, setChatValue] = useState("");
  const chatLogRef = useRef<HTMLDivElement | null>(null);

  const drawing = useRef(false);
  const curPts = useRef<number[][]>([]);
  const colorRef = useRef(color);
  const widthRef = useRef(width);
  const eraserRef = useRef(eraser);
  useEffect(() => { colorRef.current = color; widthRef.current = width; eraserRef.current = eraser; }, [color, width, eraser]);

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

  // 채팅 로그 자동 스크롤
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

  const card = (i: number) => <PlayerCard key={i} p={participants[i] ?? null} />;

  return (
    <div className="plaza-board-backdrop" onClick={onClose}>
      <div className="plaza-room" onClick={(e) => e.stopPropagation()}>
        <div className="plaza-panel-head">
          <span className="plaza-panel-title">🖌️ 공유 그림판 · {participants.length}/{SLOTS}명</span>
          <button type="button" className="plaza-panel-x" onClick={onClose} aria-label="닫기"><X size={16} /></button>
        </div>

        <div className="plaza-room-body">
          <div className="plaza-room-side">{[0, 1, 2, 3].map(card)}</div>

          <div className="plaza-room-center">
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

            <canvas ref={canvasRef} width={BW} height={BH} className="plaza-board-canvas"
              onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} />

            <div className="plaza-room-chat">
              <div className="plaza-room-chatlog" ref={chatLogRef}>
                {chatLog.map((l, i) => (
                  <div key={i} className="plaza-room-chatline"><b>{l.name}</b> {l.text}</div>
                ))}
              </div>
              <form className="plaza-room-chatform" onSubmit={submitChat}>
                <input
                  className="plaza-chat-input" value={chatValue}
                  onChange={(e) => setChatValue(e.target.value)}
                  onFocus={() => onChatFocus(true)}
                  onBlur={() => onChatFocus(false)}
                  placeholder="메시지 입력…" maxLength={200}
                />
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
