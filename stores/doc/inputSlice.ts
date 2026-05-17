import type { StateCreator } from "zustand";

import type { DocStore, InputSlice } from "./types";

export const createInputSlice: StateCreator<DocStore, [], [], InputSlice> = (set) => ({
  context: "",
  imageFile: null,
  imagePreview: null,

  setContext: (context) => set({ context }),
  setImage: (imageFile, imagePreview) => set({ imageFile, imagePreview }),
  clearImage: () => set({ imageFile: null, imagePreview: null }),
});
