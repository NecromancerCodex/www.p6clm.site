/**
 * 광장 캐릭터 크리에이터 — 파츠 매니페스트 + 레이어 합성.
 *
 * 파츠(444×700 정렬 레이어)를 z순서로 캔버스에 합성해 아바타 1장을 만든다.
 * 매니페스트는 public/plaza/parts/manifest.json (카테고리별 shape·color).
 * config = { category: "<shape><color>" }  (예: { body:"3", hair:"5c", top:"2" })
 */

export interface PartCategory {
  dir: string;       // public/plaza/parts/ 하위 경로 (예: "hair/COLOR", "EYEBROWS")
  items: string[];   // shape 번호 문자열 ["1","2",...]
  colors: string[];  // 색 접미사 ["", "b", ...] (없으면 [])
}
export interface PartsManifest {
  categories: Record<string, PartCategory>;
}

/** category → "<shape><color>" 파일 stem. null/없음 = 미착용. */
export type AvatarConfig = Record<string, string>;

const PARTS_BASE = "/plaza/parts";

// 합성 z순서 (뒤 → 앞). manifest 에 없는 카테고리는 무시됨.
export const Z_ORDER = [
  "hair_back", "body", "bottom", "dress", "top", "shoes", "gloves",
  "eyebrows", "eyelashes", "pupils", "mouth", "beard", "bangs", "hair", "hair_bonus",
];

// 크리에이터 탭 노출 순서 + 한글 라벨
export const CATEGORY_LABELS: Record<string, string> = {
  body: "피부", hair: "헤어", hair_back: "뒷머리", bangs: "앞머리", hair_bonus: "헤어 장식",
  eyebrows: "눈썹", eyelashes: "속눈썹", pupils: "눈동자", mouth: "입", beard: "수염",
  top: "상의", bottom: "하의", dress: "원피스", shoes: "신발", gloves: "장갑",
};
export const CATEGORY_ORDER = [
  "body", "hair", "bangs", "hair_back", "pupils", "eyebrows", "eyelashes", "mouth",
  "top", "bottom", "dress", "shoes", "gloves", "hair_bonus", "beard",
];

// 필수(미착용 불가) vs 선택(없음 허용) 카테고리
export const OPTIONAL_CATS = new Set([
  "hair_back", "hair_bonus", "beard", "dress", "gloves", "eyelashes",
]);

/** 기본 아바타 — 신규 유저가 크리에이터를 안 거쳐도 완전한 캐릭터. */
export const DEFAULT_AVATAR: AvatarConfig = {
  body: "1", hair_back: "1", hair: "1", bangs: "1",
  pupils: "1", eyebrows: "1", eyelashes: "1", mouth: "1",
  top: "1", bottom: "1", shoes: "1",
};

export function partUrl(m: PartsManifest, cat: string, stem: string): string | null {
  const c = m.categories[cat];
  if (!c) return null;
  return `${PARTS_BASE}/${c.dir}/${stem}.png`;
}

// 매니페스트 단일 로드 (캐시)
let _manifestPromise: Promise<PartsManifest> | null = null;
export function loadManifest(): Promise<PartsManifest> {
  if (!_manifestPromise) {
    _manifestPromise = fetch(`${PARTS_BASE}/manifest.json`, { cache: "force-cache" })
      .then((r) => r.json());
  }
  return _manifestPromise;
}

// 이미지 로드 캐시
const _imgCache = new Map<string, Promise<HTMLImageElement>>();
function loadImg(src: string): Promise<HTMLImageElement> {
  let p = _imgCache.get(src);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
    _imgCache.set(src, p);
  }
  return p;
}

export interface ComposedAvatar {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
}

/** config 를 z순서로 합성 → 내용 영역만 트림한 캔버스 반환. */
export async function composeAvatar(m: PartsManifest, config: AvatarConfig): Promise<ComposedAvatar | null> {
  const W = 444, H = 700;
  const layers = await Promise.all(
    Z_ORDER.map(async (cat) => {
      const stem = config[cat];
      if (!stem) return null;
      const url = partUrl(m, cat, stem);
      if (!url) return null;
      try { return await loadImg(url); } catch { return null; }
    }),
  );
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  for (const img of layers) if (img) ctx.drawImage(img, 0, 0, W, H);

  // 내용 bbox 트림 (발 정렬 위해)
  const { data } = ctx.getImageData(0, 0, W, H);
  let minX = W, minY = H, maxX = 0, maxY = 0, found = false;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] > 8) {
        found = true;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (!found) return null;
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  const out = document.createElement("canvas");
  out.width = cw; out.height = ch;
  out.getContext("2d")!.drawImage(canvas, minX, minY, cw, ch, 0, 0, cw, ch);
  return { canvas: out, w: cw, h: ch };
}
