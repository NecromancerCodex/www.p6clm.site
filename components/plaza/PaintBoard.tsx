"use client";

import { useEffect, useRef, useState } from "react";
import { X, Trash2, Eraser, Pencil } from "lucide-react";

import type { ClientMsg, ServerMsg, Stroke } from "../../lib/plaza/protocol";

const BW = 640, BH = 420;
const COLORS = ["#222222", "#e03131", "#f08c00", "#f5c518", "#2f9e44", "#1971c2", "#7048e8", "#e64980", "#ffffff"];
const SIZES = [3, 6, 12, 22];

/** 광장 공유 그림판 — 여러 명이 같이 그리는 화이트보드(휘발성). */
export function PaintBoard({
  send, register, onClose,
}: {
  send: (m: ClientMsg) => void;
  register: (h: ((m: ServerMsg) => void) | null) => void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const [color, setColor] = useState("#222222");
  const [width, setWidth] = useState(6);
  const [eraser, setEraser] = useState(false);

  const drawing = useRef(false);
  const curPts = useRef<number[][]>([]); // 현재 스트로크 누적 (전송 배치)
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

  // ── 초기화 + 수신 핸들러 등록 ──
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d") ?? null;
    ctxRef.current = ctx;
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

  const toCanvas = (e: React.PointerEvent): [number, number] => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return [(e.clientX - r.left) * (BW / r.width), (e.clientY - r.top) * (BH / r.height)];
  };

  const effColor = () => (eraserRef.current ? "#ffffff" : colorRef.current);

  const flush = () => {
    if (curPts.current.length >= 2) {
      send({ t: "draw", pts: curPts.current.slice(), c: effColor(), w: widthRef.current });
      curPts.current = [curPts.current[curPts.current.length - 1]]; // 연속성 유지
    }
  };

  const onDown = (e: React.PointerEvent) => {
    drawing.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const p = toCanvas(e);
    curPts.current = [p];
    drawPoly([p], effColor(), widthRef.current); // 점 찍기
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const p = toCanvas(e);
    const prev = curPts.current[curPts.current.length - 1];
    drawPoly([prev, p], effColor(), widthRef.current); // 로컬 즉시
    curPts.current.push(p);
    if (curPts.current.length >= 10) flush();
  };
  const onUp = () => { if (drawing.current) { flush(); drawing.current = false; curPts.current = []; } };

  return (
    <div className="plaza-board-backdrop" onClick={onClose}>
      <div className="plaza-board" onClick={(e) => e.stopPropagation()}>
        <div className="plaza-panel-head">
          <span className="plaza-panel-title">🖌️ 공유 그림판</span>
          <button type="button" className="plaza-panel-x" onClick={onClose} aria-label="닫기"><X size={16} /></button>
        </div>

        <div className="plaza-board-tools">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`plaza-board-color${!eraser && color === c ? " on" : ""}`}
              style={{ background: c }}
              onClick={() => { setColor(c); setEraser(false); }}
              aria-label={`색 ${c}`}
            />
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

        <canvas
          ref={canvasRef}
          width={BW}
          height={BH}
          className="plaza-board-canvas"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={onUp}
        />
      </div>
    </div>
  );
}
