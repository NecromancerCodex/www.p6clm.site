/**
 * plazaStore — 광장 프로필(재화·인벤토리·장착) 상태 (Zustand).
 *
 * 위치/채팅은 PlazaCanvas 내부 ref(WS)로 휘발 처리하고, 영속 데이터인
 * 재화·보유·장착만 이 스토어가 백엔드와 동기화한다. 패널(인벤/장비/상점)과
 * PlazaCanvas(내 캐릭터 외형)가 함께 구독한다.
 */
import { create } from "zustand";

import { fetchProfile, buyItem, equipItem, saveAvatar } from "../lib/plaza/api";
import type { Look } from "../lib/plaza/protocol";
import type { AvatarConfig } from "../lib/plaza/parts";
import { getItem } from "../lib/plaza/catalog";

interface PlazaState {
  loaded: boolean;
  loading: boolean;
  error: string | null;
  currency: number;
  inventory: string[];
  equipped: Look;
  avatar: AvatarConfig | null;

  load: () => Promise<void>;
  buy: (itemKey: string) => Promise<{ ok: boolean; error?: string }>;
  /** 슬롯 토글 장착. 이미 그 아이템이 장착돼 있으면 해제. */
  toggleEquip: (itemKey: string) => Promise<void>;
  unequip: (slot: string) => Promise<void>;
  setAvatar: (config: AvatarConfig) => Promise<void>;
}

export const usePlazaStore = create<PlazaState>((set, get) => ({
  loaded: false,
  loading: false,
  error: null,
  currency: 0,
  inventory: [],
  equipped: {},
  avatar: null,

  load: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const p = await fetchProfile();
      set({ currency: p.currency, inventory: p.inventory, equipped: p.equipped, avatar: p.avatar, loaded: true });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "프로필 로드 실패" });
    } finally {
      set({ loading: false });
    }
  },

  setAvatar: async (config) => {
    try {
      const p = await saveAvatar(config);
      set({ avatar: p.avatar });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "아바타 저장 실패" });
    }
  },

  buy: async (itemKey) => {
    try {
      const p = await buyItem(itemKey);
      set({ currency: p.currency, inventory: p.inventory, equipped: p.equipped });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "구매 실패" };
    }
  },

  toggleEquip: async (itemKey) => {
    const item = getItem(itemKey);
    if (!item) return;
    const already = get().equipped[item.slot] === itemKey;
    try {
      const p = await equipItem(item.slot, already ? null : itemKey);
      set({ currency: p.currency, inventory: p.inventory, equipped: p.equipped });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "장착 실패" });
    }
  },

  unequip: async (slot) => {
    try {
      const p = await equipItem(slot, null);
      set({ currency: p.currency, inventory: p.inventory, equipped: p.equipped });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "해제 실패" });
    }
  },
}));
