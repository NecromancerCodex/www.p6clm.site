/**
 * 광장 아이템 카탈로그 — 외형/이름/가격의 source of truth.
 *
 * 백엔드(app/api/v1/plaza_endpoints.py _CATALOG)는 key·slot·price 만 검증용으로
 * 들고 있다. 여기 추가/수정 시 백엔드 _CATALOG 도 같은 key·slot·price 로 맞출 것.
 * 외형은 lib/plaza/render.ts 가 slot+kind+color 로 도형을 그린다(자산 없음).
 *
 * 건설 테마 — 안전모/작업복/형광조끼/망치/렌치/드릴 등 앱 정체성과 맞춤.
 */

export type Slot = "hat" | "top" | "weapon" | "cape";

export interface Item {
  key: string;
  name: string;
  slot: Slot;
  price: number;
  color: string;
  color2?: string;
  kind: string;
  desc?: string;
}

export const SLOT_ORDER: Slot[] = ["hat", "top", "weapon", "cape"];
export const SLOT_LABEL: Record<Slot, string> = {
  hat: "모자",
  top: "상의",
  weapon: "무기",
  cape: "망토",
};

export const CATALOG: Record<string, Item> = {
  // ── 모자 ──
  hat_hardhat: { key: "hat_hardhat", name: "안전모", slot: "hat", price: 800, color: "#ffd000", color2: "#e0b400", kind: "hardhat", desc: "현장의 기본. 머리는 소중하니까." },
  hat_cap:     { key: "hat_cap",     name: "작업모", slot: "hat", price: 300, color: "#3f6fb0", color2: "#2c4f80", kind: "cap", desc: "가볍고 시원한 캡 모자." },
  hat_crown:   { key: "hat_crown",   name: "황금 왕관", slot: "hat", price: 5000, color: "#ffcf33", color2: "#ff5d8f", kind: "crown", desc: "광장의 지배자임을 증명한다." },

  // ── 상의 ──
  top_workshirt: { key: "top_workshirt", name: "작업복", slot: "top", price: 400, color: "#3a7d44", color2: "#2c6135", kind: "shirt", desc: "튼튼한 현장 작업복." },
  top_vest:      { key: "top_vest",      name: "형광 조끼", slot: "top", price: 1200, color: "#c6ff2e", color2: "#9bd000", kind: "vest", desc: "멀리서도 잘 보이는 안전 조끼." },
  top_suit:      { key: "top_suit",      name: "정장", slot: "top", price: 2500, color: "#2b2f3a", color2: "#c0392b", kind: "suit", desc: "현장소장님의 위엄." },

  // ── 무기 ──
  weapon_hammer: { key: "weapon_hammer", name: "망치", slot: "weapon", price: 600, color: "#9aa0a8", color2: "#7a4a22", kind: "hammer", desc: "두드리면 대부분 해결된다." },
  weapon_wrench: { key: "weapon_wrench", name: "렌치", slot: "weapon", price: 900, color: "#b0b6bf", color2: "#6e747d", kind: "wrench", desc: "조이고 풀고, 만능 공구." },
  weapon_drill:  { key: "weapon_drill",  name: "드릴", slot: "weapon", price: 1800, color: "#e53935", color2: "#414549", kind: "drill", desc: "위이이잉— 강력한 임팩트 드릴." },

  // ── 망토 ──
  cape_blue: { key: "cape_blue", name: "파란 망토", slot: "cape", price: 1500, color: "#1e88e5", color2: "#0d47a1", kind: "cape", desc: "바람에 휘날리는 푸른 망토." },
  cape_gold: { key: "cape_gold", name: "황금 망토", slot: "cape", price: 4000, color: "#ffca28", color2: "#ff8f00", kind: "cape", desc: "광장에서 가장 빛나는 등." },
};

export const ALL_ITEMS: Item[] = Object.values(CATALOG);

export function getItem(key: string | undefined | null): Item | undefined {
  return key ? CATALOG[key] : undefined;
}
