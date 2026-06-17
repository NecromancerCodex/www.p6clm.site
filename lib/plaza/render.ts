/**
 * 광장 캐릭터 렌더링 — 순수 canvas 함수.
 *
 * drawStaticChar: 합성 아바타(파츠) + 의사 스켈레톤 모션.
 * drawChibi: 아바타 합성 전 폴백용 간단 치비.
 */
import type { AnimState, Facing } from "./protocol";

// ── 공유 프리미티브 ─────────────────────────────────────────────────────────────
export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const ch of text) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = ch; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

// ── 캐릭터 ──────────────────────────────────────────────────────────────────────
const HEAD_R = 16;
const BODY_W = 26;
const BODY_H = 17;
const LEG_LEN = 9;
const SKIN = "#ffe0bd";

export interface ChibiOpts {
  x: number;
  y: number; // 발 위치(지면 접점)
  facing: Facing;
  st: AnimState;
  bodyColor: string;
  name: string;
  now: number;
  isMe?: boolean;
  bubble?: { text: string };
}

export function drawChibi(ctx: CanvasRenderingContext2D, o: ChibiOpts) {
  const dir = o.facing === "r" ? 1 : -1;
  const bob = o.st === "walk" ? Math.abs(Math.sin(o.now / 90)) * 2.5 : o.st === "jump" ? -1.5 : 0;
  const feetY = o.y;
  const bodyBottomY = feetY - LEG_LEN - bob;
  const bodyTopY = bodyBottomY - BODY_H;
  const headCY = bodyTopY - HEAD_R + 6;
  ctx.save();

  // 그림자
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath(); ctx.ellipse(o.x, feetY + 1, BODY_W * 0.5, 5, 0, 0, Math.PI * 2); ctx.fill();

  // 다리 (걷기 스윙)
  const swing = o.st === "walk" ? Math.sin(o.now / 80) * 4 : 0;
  drawLeg(ctx, o.x - 6, bodyBottomY, swing);
  drawLeg(ctx, o.x + 6, bodyBottomY, -swing);

  // 뒤쪽 팔
  drawArm(ctx, o.x - dir * (BODY_W / 2 - 1), bodyTopY + 5, o.bodyColor);

  // 몸통
  const bx = o.x - BODY_W / 2;
  ctx.fillStyle = o.bodyColor;
  roundRect(ctx, bx, bodyTopY, BODY_W, BODY_H, 7); ctx.fill();
  if (o.isMe) { ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 2; ctx.stroke(); }

  // 앞쪽 팔
  drawArm(ctx, o.x + dir * (BODY_W / 2 - 1), bodyTopY + 5, o.bodyColor);

  // 머리
  ctx.fillStyle = SKIN;
  ctx.beginPath(); ctx.arc(o.x, headCY, HEAD_R, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.06)"; // 살짝 음영
  ctx.beginPath(); ctx.arc(o.x - dir * 5, headCY + 4, HEAD_R * 0.7, 0, Math.PI * 2); ctx.fill();
  // 머리카락 (앞머리)
  ctx.fillStyle = "#5a3b24";
  ctx.beginPath();
  ctx.arc(o.x, headCY - 2, HEAD_R, Math.PI * 1.05, Math.PI * 2 - 0.05);
  ctx.closePath(); ctx.fill();
  // 눈
  ctx.fillStyle = "#2a2320";
  const eyeY = headCY + 2;
  ctx.beginPath(); ctx.arc(o.x + dir * 2 - 4, eyeY, 2.1, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(o.x + dir * 2 + 5, eyeY, 2.1, 0, Math.PI * 2); ctx.fill();
  // 볼터치
  ctx.fillStyle = "rgba(255,150,150,0.45)";
  ctx.beginPath(); ctx.arc(o.x - 6, eyeY + 5, 2.6, 0, Math.PI * 2); ctx.arc(o.x + 8, eyeY + 5, 2.6, 0, Math.PI * 2); ctx.fill();

  // 이름표
  drawNameTag(ctx, o.x, feetY, o.name, !!o.isMe);

  // 말풍선
  if (o.bubble) drawBubble(ctx, o.x, headCY - HEAD_R - 8, o.bubble.text);

  ctx.restore();
}

function drawNameTag(ctx: CanvasRenderingContext2D, x: number, feetY: number, name: string, isMe: boolean) {
  ctx.font = "600 12px system-ui, sans-serif";
  ctx.textAlign = "center";
  const tw = ctx.measureText(name).width;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  roundRect(ctx, x - tw / 2 - 6, feetY + 5, tw + 12, 17, 8); ctx.fill();
  ctx.fillStyle = isMe ? "#ffe066" : "#fff";
  ctx.fillText(name, x, feetY + 17);
}

// ── 정지 이미지 캐릭터 + 의사(pseudo) 스켈레톤 모션 ───────────────────────────────
// 캐릭터 = 단일 치비 일러스트(여백 트림, 하단=발). 걷기 프레임이 없어서
// 합성 이미지를 허리에서 잘라 좌/우 다리 조각을 반대로 회전(시저 워크)시킨다.
// (옷·신발이 통짜라 분리 레이어가 없으므로 이미지 분할이 유일한 방법)
const CHAR_H = 104; // 표시 높이(px)
const HIP = 0.56;   // 허리 분할 지점 (위→아래 비율)

/** 다리 조각 — 힙 피벗 기준 회전 후 그리기. */
function drawLegPiece(
  ctx: CanvasRenderingContext2D, src: CanvasImageSource,
  sx: number, sy: number, sw: number, sh: number,
  dx: number, dy: number, dw: number, dh: number,
  px: number, py: number, ang: number,
) {
  ctx.save();
  ctx.translate(px, py); ctx.rotate(ang); ctx.translate(-px, -py);
  ctx.drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh);
  ctx.restore();
}

export function drawStaticChar(
  ctx: CanvasRenderingContext2D, o: ChibiOpts, src: CanvasImageSource, srcW: number, srcH: number,
) {
  if (!srcH) return;
  const baseScale = CHAR_H / srcH;
  const walk = o.st === "walk";

  // 비걷기 모션 (idle 숨쉬기 / jump 늘이기)
  let bobY = 0, sy = 1, sxs = 1;
  if (o.st === "jump") { sy = 1.06; sxs = 0.96; }
  else if (walk) { bobY = -Math.abs(Math.sin(o.now / 140)) * 3; } // 걸음 상하
  else { bobY = Math.sin(o.now / 650) * 1.6; sy = 1 + Math.sin(o.now / 650) * 0.015; }

  const dw = srcW * baseScale * sxs;
  const dh = CHAR_H * sy;
  const feetY = o.y;
  const topY = feetY - dh + bobY;
  const left = o.x - dw / 2;

  ctx.save();
  // 그림자
  const shScale = 1 - Math.min(0.4, Math.abs(bobY) / 20);
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath(); ctx.ellipse(o.x, feetY, dw * 0.3 * shScale, 5 * shScale, 0, 0, Math.PI * 2); ctx.fill();

  if (o.isMe) {
    ctx.strokeStyle = "rgba(255,224,102,0.8)"; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.ellipse(o.x, feetY + 1, dw * 0.32, 6, 0, 0, Math.PI * 2); ctx.stroke();
  }

  ctx.imageSmoothingEnabled = true;
  ctx.save();
  if (o.facing === "l") { ctx.translate(o.x, 0); ctx.scale(-1, 1); ctx.translate(-o.x, 0); }

  if (walk) {
    const hipSrcY = srcH * HIP;
    const legSrcH = srcH - hipSrcY;
    const upperDH = dh * HIP;
    const legDH = dh - upperDH;
    const hipY = topY + upperDH;
    const ang = Math.sin(o.now / 140) * 0.24; // 다리 스윙 각 (~14°)
    // 다리(뒤) — 좌/우 반대 회전, 허리 피벗
    drawLegPiece(ctx, src, 0, hipSrcY, srcW / 2, legSrcH, left, hipY, dw / 2, legDH, o.x, hipY, ang);
    drawLegPiece(ctx, src, srcW / 2, hipSrcY, srcW / 2, legSrcH, o.x, hipY, dw / 2, legDH, o.x, hipY, -ang);
    // 상체(앞) — 허리 이음새를 덮는다
    ctx.drawImage(src, 0, 0, srcW, hipSrcY, left, topY, dw, upperDH);
  } else {
    ctx.drawImage(src, left, topY, dw, dh);
  }
  ctx.restore();

  drawNameTag(ctx, o.x, feetY, o.name, !!o.isMe);
  if (o.bubble) drawBubble(ctx, o.x, topY + 4, o.bubble.text);
  ctx.restore();
}

function drawLeg(ctx: CanvasRenderingContext2D, x: number, topY: number, dy: number) {
  ctx.fillStyle = "#3a2f28";
  roundRect(ctx, x - 4, topY, 8, LEG_LEN + dy, 3); ctx.fill();
  ctx.fillStyle = "#22201e"; // 신발
  roundRect(ctx, x - 5, topY + LEG_LEN + dy - 3, 11, 4, 2); ctx.fill();
}

function drawArm(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.fillStyle = color;
  roundRect(ctx, x - 4, y, 8, 14, 4); ctx.fill();
  ctx.fillStyle = SKIN; // 손
  ctx.beginPath(); ctx.arc(x, y + 14, 4, 0, Math.PI * 2); ctx.fill();
}


// ── 말풍선 ──────────────────────────────────────────────────────────────────────
function drawBubble(ctx: CanvasRenderingContext2D, cx: number, bottomY: number, text: string) {
  ctx.save();
  ctx.font = "13px system-ui, sans-serif";
  ctx.textAlign = "left";
  const maxW = 220;
  const lines = wrapText(ctx, text, maxW);
  const lineH = 17, padX = 10, padY = 7;
  let bw = 0;
  for (const ln of lines) bw = Math.max(bw, ctx.measureText(ln).width);
  bw = Math.min(bw, maxW) + padX * 2;
  const bh = lines.length * lineH + padY * 2;
  const bx = cx - bw / 2, by = bottomY - bh;
  ctx.fillStyle = "rgba(255,255,255,0.97)";
  ctx.strokeStyle = "rgba(0,0,0,0.12)"; ctx.lineWidth = 1;
  roundRect(ctx, bx, by, bw, bh, 10); ctx.fill(); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 6, by + bh); ctx.lineTo(cx + 6, by + bh); ctx.lineTo(cx, by + bh + 8);
  ctx.closePath(); ctx.fillStyle = "rgba(255,255,255,0.97)"; ctx.fill();
  ctx.fillStyle = "#222"; ctx.textAlign = "left";
  lines.forEach((ln, i) => ctx.fillText(ln, bx + padX, by + padY + 13 + i * lineH));
  ctx.restore();
}

