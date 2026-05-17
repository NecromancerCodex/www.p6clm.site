import type { StateCreator } from "zustand";

import type { ChatStore, MediaSlice } from "./types";

export const createMediaSlice: StateCreator<ChatStore, [], [], MediaSlice> = (set, get) => ({
  pendingImage: null,
  pendingImagePreview: null,

  setPendingImage: (file) => {
    if (!file) {
      const prev = get().pendingImagePreview;
      if (prev) URL.revokeObjectURL(prev);
      set({ pendingImage: null, pendingImagePreview: null });
      return;
    }
    const preview = URL.createObjectURL(file);
    set({ pendingImage: file, pendingImagePreview: preview });
  },

  clearPendingImage: () => {
    const prev = get().pendingImagePreview;
    if (prev) URL.revokeObjectURL(prev);
    set({ pendingImage: null, pendingImagePreview: null });
  },
});
