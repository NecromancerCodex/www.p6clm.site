/**
 * 광장 캐릭터/아이템 렌더링 — 순수 canvas 함수 (자산 없음, 도형으로 그림).
 *
 * drawChibi: 2등신(머리 큰 비율) 캐릭터 + 장착 외형(모자/상의/무기/망토) 오버레이.
 * drawItemIcon: 인벤/상점 패널용 아이템 아이콘.
 * 외형 데이터는 lib/plaza/catalog.ts (slot+kind+color) 가 결정.
 */
import { CATALOG, getItem, type Item } from "./catalog";
import type { AnimState, Facing, Look } from "./protocol";

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
  look?: Look;
  isMe?: boolean;
  bubble?: { text: string };
  avatar?: HTMLImageElement | null; // 지정 시 절차적 치비 대신 스프라이트 렌더
}

interface Layout {
  x: number;
  feetY: number;
  bodyTopY: number;
  bodyBottomY: number;
  headCX: number;
  headCY: number;
  dir: number; // 1=오른쪽, -1=왼쪽
}

export function drawChibi(ctx: CanvasRenderingContext2D, o: ChibiOpts) {
  const dir = o.facing === "r" ? 1 : -1;
  const bob = o.st === "walk" ? Math.abs(Math.sin(o.now / 90)) * 2.5 : o.st === "jump" ? -1.5 : 0;
  const feetY = o.y;
  const bodyBottomY = feetY - LEG_LEN - bob;
  const bodyTopY = bodyBottomY - BODY_H;
  const headCY = bodyTopY - HEAD_R + 6;
  const L: Layout = { x: o.x, feetY, bodyTopY, bodyBottomY, headCX: o.x, headCY, dir };
  const look = o.look || {};
  const top = getItem(look.top);

  ctx.save();

  // 그림자
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath(); ctx.ellipse(o.x, feetY + 1, BODY_W * 0.5, 5, 0, 0, Math.PI * 2); ctx.fill();

  // ── 아바타 스프라이트 (지정 시 절차적 치비 대신) ──
  if (o.avatar && o.avatar.complete && o.avatar.naturalWidth > 0) {
    const dh = 80;
    const dw = dh * (o.avatar.naturalWidth / o.avatar.naturalHeight);
    const topY = feetY - dh - bob;
    ctx.save();
    if (o.facing === "l") { ctx.translate(o.x, 0); ctx.scale(-1, 1); ctx.translate(-o.x, 0); }
    ctx.drawImage(o.avatar, o.x - dw / 2, topY, dw, dh);
    ctx.restore();
    drawNameTag(ctx, o.x, feetY, o.name, !!o.isMe);
    if (o.bubble) drawBubble(ctx, o.x, topY - 4, o.bubble.text);
    ctx.restore();
    return;
  }

  // 망토 (몸 뒤)
  if (look.cape) drawCape(ctx, getItem(look.cape)!, L, o.now);

  // 다리 (걷기 스윙)
  const swing = o.st === "walk" ? Math.sin(o.now / 80) * 4 : 0;
  drawLeg(ctx, o.x - 6, bodyBottomY, swing);
  drawLeg(ctx, o.x + 6, bodyBottomY, -swing);

  // 뒤쪽 팔
  drawArm(ctx, o.x - dir * (BODY_W / 2 - 1), bodyTopY + 5, top ? (top.color2 || top.color) : o.bodyColor);

  // 몸통 (상의)
  const bx = o.x - BODY_W / 2;
  ctx.fillStyle = top ? top.color : o.bodyColor;
  roundRect(ctx, bx, bodyTopY, BODY_W, BODY_H, 7); ctx.fill();
  if (o.isMe) { ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 2; ctx.stroke(); }
  if (top) drawTopDetail(ctx, top, L);

  // 앞쪽 팔 + 무기
  const handX = o.x + dir * (BODY_W / 2 - 1);
  const handY = bodyTopY + 5;
  drawArm(ctx, handX, handY, top ? (top.color2 || top.color) : o.bodyColor);
  if (look.weapon) drawWeapon(ctx, getItem(look.weapon)!, handX + dir * 4, handY + 4, 1, dir);

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

  // 모자 (머리 위)
  if (look.hat) drawHat(ctx, getItem(look.hat)!, o.x, headCY, 1, dir);

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

// ── 장비 (몸 위) ─────────────────────────────────────────────────────────────────
function drawHat(ctx: CanvasRenderingContext2D, item: Item, cx: number, cy: number, s: number, dir: number) {
  const topY = cy - HEAD_R * s;
  ctx.save();
  if (item.kind === "hardhat") {
    ctx.fillStyle = item.color;
    ctx.beginPath(); ctx.arc(cx, topY + 6 * s, 15 * s, Math.PI, 0); ctx.fill();
    roundRect(ctx, cx - 19 * s, topY + 4 * s, 38 * s, 5 * s, 2 * s); ctx.fill(); // 챙
    ctx.fillStyle = item.color2 || item.color; // 능선
    roundRect(ctx, cx - 2 * s, topY - 9 * s, 4 * s, 16 * s, 2 * s); ctx.fill();
  } else if (item.kind === "cap") {
    ctx.fillStyle = item.color;
    ctx.beginPath(); ctx.arc(cx, topY + 5 * s, 14 * s, Math.PI, 0); ctx.fill();
    ctx.fillStyle = item.color2 || item.color;
    roundRect(ctx, cx + dir * 4 * s, topY + 3 * s, dir * 18 * s, 4 * s, 2 * s); ctx.fill(); // 챙
  } else if (item.kind === "crown") {
    ctx.fillStyle = item.color;
    const w = 30 * s, h = 16 * s, bx = cx - w / 2, by = topY - 2 * s;
    ctx.beginPath();
    ctx.moveTo(bx, by + h);
    ctx.lineTo(bx, by + 4 * s); ctx.lineTo(bx + w * 0.2, by + h * 0.55);
    ctx.lineTo(bx + w * 0.5, by - 2 * s); ctx.lineTo(bx + w * 0.8, by + h * 0.55);
    ctx.lineTo(bx + w, by + 4 * s); ctx.lineTo(bx + w, by + h);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = item.color2 || "#ff5d8f";
    ctx.beginPath(); ctx.arc(cx, by + h * 0.7, 2.6 * s, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawTopDetail(ctx: CanvasRenderingContext2D, item: Item, L: Layout) {
  const cx = L.x, ty = L.bodyTopY;
  ctx.save();
  if (item.kind === "vest") {
    ctx.fillStyle = item.color2 || "#fff"; // 반사 띠
    roundRect(ctx, cx - BODY_W / 2 + 3, ty + 5, BODY_W - 6, 3, 1); ctx.fill();
    roundRect(ctx, cx - BODY_W / 2 + 3, ty + 10, BODY_W - 6, 3, 1); ctx.fill();
  } else if (item.kind === "suit") {
    ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = 1.5; // 라펠
    ctx.beginPath(); ctx.moveTo(cx, ty + 1); ctx.lineTo(cx - 6, ty + 10); ctx.moveTo(cx, ty + 1); ctx.lineTo(cx + 6, ty + 10); ctx.stroke();
    ctx.fillStyle = item.color2 || "#c0392b"; // 넥타이
    ctx.beginPath(); ctx.moveTo(cx, ty + 2); ctx.lineTo(cx - 2.5, ty + 6); ctx.lineTo(cx, ty + 14); ctx.lineTo(cx + 2.5, ty + 6); ctx.closePath(); ctx.fill();
  } else {
    ctx.fillStyle = "rgba(0,0,0,0.12)"; // 단추선
    roundRect(ctx, cx - 1, ty + 3, 2, BODY_H - 6, 1); ctx.fill();
  }
  ctx.restore();
}

function drawWeapon(ctx: CanvasRenderingContext2D, item: Item, x: number, y: number, s: number, dir: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir, 1);
  if (item.kind === "hammer") {
    ctx.fillStyle = item.color2 || "#7a4a22"; // 손잡이
    roundRect(ctx, -2 * s, -2 * s, 4 * s, 22 * s, 2 * s); ctx.fill();
    ctx.fillStyle = item.color; // 머리
    roundRect(ctx, -9 * s, -8 * s, 18 * s, 9 * s, 2 * s); ctx.fill();
  } else if (item.kind === "wrench") {
    ctx.fillStyle = item.color;
    roundRect(ctx, -2 * s, -2 * s, 4 * s, 22 * s, 2 * s); ctx.fill();
    ctx.beginPath(); ctx.arc(0, -6 * s, 6 * s, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = item.color2 || "#6e747d";
    ctx.beginPath(); ctx.arc(0, -6 * s, 2.6 * s, 0, Math.PI * 2); ctx.fill();
  } else if (item.kind === "drill") {
    ctx.fillStyle = item.color; // 본체
    roundRect(ctx, -6 * s, -4 * s, 14 * s, 12 * s, 3 * s); ctx.fill();
    ctx.fillStyle = item.color2 || "#414549"; // 손잡이
    roundRect(ctx, -5 * s, 6 * s, 6 * s, 14 * s, 2 * s); ctx.fill();
    ctx.fillStyle = "#cfd3d8"; // 비트
    roundRect(ctx, 7 * s, -1 * s, 12 * s, 4 * s, 1 * s); ctx.fill();
  }
  ctx.restore();
}

function drawCape(ctx: CanvasRenderingContext2D, item: Item, L: Layout, now: number) {
  const wave = Math.sin(now / 200) * 4;
  ctx.save();
  const g = ctx.createLinearGradient(0, L.bodyTopY, 0, L.feetY);
  g.addColorStop(0, item.color);
  g.addColorStop(1, item.color2 || item.color);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(L.x - BODY_W / 2 + 2, L.bodyTopY + 1);
  ctx.lineTo(L.x + BODY_W / 2 - 2, L.bodyTopY + 1);
  ctx.quadraticCurveTo(L.x + BODY_W / 2 + 6 + wave, L.feetY - 8, L.x + 8 + wave, L.feetY - 2);
  ctx.lineTo(L.x - 8 + wave, L.feetY - 2);
  ctx.quadraticCurveTo(L.x - BODY_W / 2 - 6 + wave, L.feetY - 8, L.x - BODY_W / 2 + 2, L.bodyTopY + 1);
  ctx.closePath(); ctx.fill();
  ctx.restore();
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

// ── 아이템 아이콘 (패널용) ─────────────────────────────────────────────────────────
/** size×size 박스 중앙에 아이템을 그린다. */
export function drawItemIcon(ctx: CanvasRenderingContext2D, item: Item, size: number) {
  const cx = size / 2, cy = size / 2;
  ctx.clearRect(0, 0, size, size);
  if (item.slot === "hat") {
    drawHat(ctx, item, cx, cy + size * 0.18, size / 34, 1);
  } else if (item.slot === "weapon") {
    ctx.save(); ctx.translate(0, -size * 0.18); drawWeapon(ctx, item, cx, cy, size / 26, 1); ctx.restore();
  } else if (item.slot === "top") {
    drawTopIcon(ctx, item, cx, cy, size / 40);
  } else if (item.slot === "cape") {
    drawCapeIcon(ctx, item, cx, cy, size / 40);
  }
}

function drawTopIcon(ctx: CanvasRenderingContext2D, item: Item, cx: number, cy: number, s: number) {
  const w = 26 * s, h = 22 * s;
  ctx.fillStyle = item.color;
  // 몸통
  roundRect(ctx, cx - w / 2, cy - h / 2 + 3 * s, w, h, 5 * s); ctx.fill();
  // 소매
  roundRect(ctx, cx - w / 2 - 6 * s, cy - h / 2 + 4 * s, 8 * s, 10 * s, 3 * s); ctx.fill();
  roundRect(ctx, cx + w / 2 - 2 * s, cy - h / 2 + 4 * s, 8 * s, 10 * s, 3 * s); ctx.fill();
  // 디테일
  if (item.kind === "vest") {
    ctx.fillStyle = item.color2 || "#fff";
    roundRect(ctx, cx - w / 2 + 3 * s, cy - 3 * s, w - 6 * s, 3 * s, 1); ctx.fill();
    roundRect(ctx, cx - w / 2 + 3 * s, cy + 4 * s, w - 6 * s, 3 * s, 1); ctx.fill();
  } else if (item.kind === "suit") {
    ctx.fillStyle = item.color2 || "#c0392b";
    ctx.beginPath(); ctx.moveTo(cx, cy - h / 2 + 4 * s); ctx.lineTo(cx - 3 * s, cy); ctx.lineTo(cx, cy + 8 * s); ctx.lineTo(cx + 3 * s, cy); ctx.closePath(); ctx.fill();
  }
}

function drawCapeIcon(ctx: CanvasRenderingContext2D, item: Item, cx: number, cy: number, s: number) {
  const g = ctx.createLinearGradient(0, cy - 14 * s, 0, cy + 16 * s);
  g.addColorStop(0, item.color); g.addColorStop(1, item.color2 || item.color);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(cx - 10 * s, cy - 14 * s);
  ctx.lineTo(cx + 10 * s, cy - 14 * s);
  ctx.lineTo(cx + 15 * s, cy + 16 * s);
  ctx.lineTo(cx - 15 * s, cy + 16 * s);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.2)";
  roundRect(ctx, cx - 10 * s, cy - 14 * s, 20 * s, 4 * s, 2); ctx.fill();
}

export { CATALOG };
