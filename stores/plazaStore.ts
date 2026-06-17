/**
 * plazaStore — 광장 프로필(재화·보유 파츠·아바타) 상태 (Zustand).
 *
 * 위치/채팅은 PlazaCanvas 내부 ref(WS)로 휘발 처리하고, 영속 데이터인
 * 재화·보유 파츠·아바타 설정만 이 스토어가 백엔드와 동기화한다.
 * 상점(구매)과 크리에이터(착용)가 함께 구독한다.
 */
import { create } from "zustand";

import { fetchProfile, buyItem, saveAvatar } from "../lib/plaza/api";
import type { AvatarConfig } from "../lib/plaza/parts";

interface PlazaState {
  loaded: boolean;
  loading: boolean;
  error: string | null;
  currency: number;
  inventory: string[]; // 보유 파츠 "<cat>:<shape>"
  avatar: AvatarConfig | null;

  load: () => Promise<void>;
  buy: (itemKey: string) => Promise<{ ok: boolean; error?: string }>;
  setAvatar: (config: AvatarConfig) => Promise<void>;
  setCurrency: (n: number) => void;
}

export const usePlazaStore = create<PlazaState>((set, get) => ({
  loaded: false,
  loading: false,
  error: null,
  currency: 0,
  inventory: [],
  avatar: null,

  load: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const p = await fetchProfile();
      set({ currency: p.currency, inventory: p.inventory, avatar: p.avatar, loaded: true });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "프로필 로드 실패" });
    } finally {
      set({ loading: false });
    }
  },

  setCurrency: (n) => set({ currency: n }),

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
      set({ currency: p.currency, inventory: p.inventory });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "구매 실패" };
    }
  },
}));
