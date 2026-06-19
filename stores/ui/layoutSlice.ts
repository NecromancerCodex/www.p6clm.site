import type { StateCreator } from "zustand";

import type { LayoutSlice, UiStore } from "./types";

export const createLayoutSlice: StateCreator<UiStore, [], [], LayoutSlice> = (set) => ({
  sidebarOpen: false,
  openSidebar: () => set({ sidebarOpen: true }),
  closeSidebar: () => set({ sidebarOpen: false }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  sidebarCollapsed: false,
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
  toggleSidebarCollapsed: () =>
    set((s) => {
      const next = !s.sidebarCollapsed;
      try { localStorage.setItem("ws-collapsed", next ? "1" : "0"); } catch { /* SSR/사생활모드 무시 */ }
      return { sidebarCollapsed: next };
    }),
});
