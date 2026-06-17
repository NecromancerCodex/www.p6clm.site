/**
 * 광장 프로필/상점/장착 REST 클라이언트.
 *
 * Backend: /api/v1/plaza/{profile,shop/buy,equip}  (api_router, 세션 쿠키 인증)
 * Frontend proxy: /api/clm (next.config rewrite → /api/v1)
 */
import type { Look } from "./protocol";

const API_BASE = "/api/clm";

export interface PlazaProfile {
  currency: number;
  inventory: string[];
  equipped: Look;
  character: string | null;
  avatar: Record<string, string> | null;
}

async function parse(res: Response): Promise<PlazaProfile> {
  if (!res.ok) {
    let detail = `요청 실패 (${res.status})`;
    try {
      const j = await res.json();
      if (j?.detail) detail = j.detail;
    } catch { /* ignore */ }
    throw new Error(detail);
  }
  return res.json();
}

export async function fetchProfile(): Promise<PlazaProfile> {
  return parse(await fetch(`${API_BASE}/plaza/profile`, { cache: "no-store" }));
}

export async function buyItem(itemKey: string): Promise<PlazaProfile> {
  return parse(
    await fetch(`${API_BASE}/plaza/shop/buy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_key: itemKey }),
    }),
  );
}

export async function equipItem(slot: string, itemKey: string | null): Promise<PlazaProfile> {
  return parse(
    await fetch(`${API_BASE}/plaza/equip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot, item_key: itemKey }),
    }),
  );
}

export async function setCharacter(character: string): Promise<PlazaProfile> {
  return parse(
    await fetch(`${API_BASE}/plaza/character`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ character }),
    }),
  );
}

export async function saveAvatar(avatar: Record<string, string>): Promise<PlazaProfile> {
  return parse(
    await fetch(`${API_BASE}/plaza/avatar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avatar }),
    }),
  );
}
