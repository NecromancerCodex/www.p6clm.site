"use client";

import { useEffect, useRef, useState } from "react";
import { X, Send, RotateCw } from "lucide-react";

import type { ClientMsg, ServerMsg } from "../../lib/plaza/protocol";
import type { Participant, ChatLine } from "./PlazaCanvas";
import { AvatarThumb } from "./AvatarThumb";

const SEG_COLORS = ["#ff6b6b", "#4dabf7", "#51cf66", "#ffd43b", "#cc5de8", "#ff922b", "#20c997", "#f783ac"];
const WS = 320; // 휠 캔버스 크기

/** 돌림판(룰렛) 룸 — 가운데 바늘이 돌다 한 명 지목. 그림퀴즈와 동일 룸 UI. */
export function WheelRoom({
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
  const chatLogRef = useRef<HTMLDivElement | null>(null);
  const [chatValue, setChatValue] = useState("");
  const [spinOrder, setSpinOrder] = useState<number[] | null>(null);
  const [rot, setRot] = useState(0);
  const [dur, setDur] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [winnerId, setWinnerId] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(0);
  const rotRef = useRef(0);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 400);
    return () => window.clearInterval(id);
  }, []);

  const nameOf = (id: number) => participants.find((p) => p.id === id)?.name ?? "?";
  const bubbleOf = (id: number): string | undefined => {
    for (let i = chatLog.length - 1; i >= 0; i--) {
      if (chatLog[i].id === id) return nowMs - chatLog[i].ts < 4500 ? chatLog[i].text : undefined;
    }
    return undefined;
  };
  // 스핀 중/직후엔 서버가 준 순서 유지, 그 외엔 현재 참가자 순서
  const wheelIds = spinOrder ?? participants.map((p) => p.id);

  // 휠 그리기
  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    const n = Math.max(1, wheelIds.length);
    const seg = (Math.PI * 2) / n;
    const cx = WS / 2, cy = WS / 2, r = WS / 2 - 4;
    ctx.clearRect(0, 0, WS, WS);
    for (let i = 0; i < n; i++) {
      const a0 = -Math.PI / 2 + i * seg;
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, a0, a0 + seg); ctx.closePath();
      ctx.fillStyle = SEG_COLORS[i % SEG_COLORS.length]; ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 2; ctx.stroke();
      // 이름
      ctx.save();
      ctx.translate(cx, cy); ctx.rotate(a0 + seg / 2);
      ctx.fillStyle = "#1a2332"; ctx.font = "700 13px system-ui, sans-serif";
      ctx.textAlign = "right"; ctx.textBaseline = "middle";
      ctx.fillText(nameOf(wheelIds[i]).slice(0, 7), r - 12, 0);
      ctx.restore();
    }
    // 가운데 허브
    ctx.beginPath(); ctx.arc(cx, cy, 16, 0, Math.PI * 2);
    ctx.fillStyle = "#222e44"; ctx.fill();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinOrder, participants]);

  // 채팅 자동 스크롤
  useEffect(() => { const el = chatLogRef.current; if (el) el.scrollTop = el.scrollHeight; }, [chatLog]);

  // 스핀 메시지 수신 → 모두 동일 결과로 애니메이션
  useEffect(() => {
    const handler = (m: ServerMsg) => {
      if (m.t !== "wheel_spin") return;
      const order = m.order;
      setSpinOrder(order);
      const n = Math.max(1, order.length);
      const segDeg = 360 / n;
      const idx = Math.max(0, order.indexOf(m.targetId));
      const center = idx * segDeg + segDeg / 2;
      const jitter = (Math.random() - 0.5) * segDeg * 0.6;
      const cur = rotRef.current;
      const delta = m.turns * 360 + (((360 - (center + jitter)) - (cur % 360)) + 720) % 360;
      const final = cur + delta;
      rotRef.current = final;
      setDur(m.dur);
      setSpinning(true);
      setWinnerId(null);
      setRot(final);
      window.setTimeout(() => { setSpinning(false); setWinnerId(m.targetId); }, m.dur + 120);
    };
    register(handler);
    return () => register(null);
  }, [register]);

  const submitChat = (e: React.FormEvent) => {
    e.preventDefault();
    const t = chatValue.trim();
    if (t) sendChat(t);
    setChatValue("");
  };

  const card = (i: number) => {
    const p = participants[i] ?? null;
    if (!p) return <div key={i} className="plaza-pcard plaza-pcard--empty">비어 있음</div>;
    const bubble = bubbleOf(p.id);
    return (
      <div key={i} className={`plaza-pcard${p.me ? " me" : ""}${winnerId === p.id ? " correct" : ""}`}>
        {bubble && <div className="plaza-pcard-bubble">{bubble}</div>}
        <AvatarThumb config={p.avatar} />
        <div className="plaza-pcard-info"><span className="plaza-pcard-name">{p.me ? `${p.name}(나)` : p.name}</span></div>
        {winnerId === p.id && <span className="plaza-pcard-badge">지목!</span>}
      </div>
    );
  };

  return (
    <div className="plaza-board-backdrop" onClick={onClose}>
      <div className="plaza-room" onClick={(e) => e.stopPropagation()}>
        <div className="plaza-panel-head">
          <span className="plaza-panel-title">🎡 돌림판</span>
          <span className="plaza-game-status">참가 {participants.length}명 · 돌리면 한 명 지목</span>
          <button type="button" className="plaza-game-start" disabled={spinning || participants.length < 2}
            onClick={() => send({ t: "wheel_spin" })}>
            <RotateCw size={14} /> 돌리기
          </button>
          <button type="button" className="plaza-panel-x" onClick={onClose} aria-label="닫기"><X size={16} /></button>
        </div>

        <div className="plaza-room-body">
          <div className="plaza-room-side">{[0, 1, 2, 3].map(card)}</div>

          <div className="plaza-room-center">
            <div className="plaza-wheel-wrap">
              <div className="plaza-wheel-pointer" />
              <canvas
                ref={canvasRef} width={WS} height={WS} className="plaza-wheel"
                style={{ transform: `rotate(${rot}deg)`, transition: spinning ? `transform ${dur}ms cubic-bezier(0.18,0.7,0.16,1)` : "none" }}
              />
              {winnerId !== null && !spinning && (
                <div className="plaza-wheel-result">🎯 {nameOf(winnerId)} 지목!</div>
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
                  placeholder="메시지 입력…" maxLength={200} />
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
