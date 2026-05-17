import type { StateCreator } from "zustand";

import type { ChatStore, InputSlice } from "./types";

export const createInputSlice: StateCreator<ChatStore, [], [], InputSlice> = (set) => ({
  input: "",
  setInput: (input) => set({ input }),
});
