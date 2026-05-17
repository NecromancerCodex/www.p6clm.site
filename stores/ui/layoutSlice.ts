import type { StateCreator } from "zustand";

import type { LayoutSlice, UiStore } from "./types";

export const createLayoutSlice: StateCreator<UiStore, [], [], LayoutSlice> = (set) => ({
  sidebarOpen: false,
  openSidebar: () => set({ sidebarOpen: true }),
  closeSidebar: () => set({ sidebarOpen: false }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
});
