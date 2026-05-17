import type { StateCreator } from "zustand";

import type { DocStore, SelectionSlice } from "./types";

export const createSelectionSlice: StateCreator<DocStore, [], [], SelectionSlice> = (set) => ({
  activeCat: "quality",
  activeDoc: "defect_report",

  setActiveCat: (activeCat) =>
    set({
      activeCat,
      // 카테고리 전환 시 다른 슬라이스 상태도 리셋
      activeDoc: null,
      status: "idle",
      ncrResult: null,
      sirResult: null,
      rawResult: "",
      errorMsg: "",
      imageFile: null,
      imagePreview: null,
      stepsLog: [],
    }),

  setActiveDoc: (activeDoc) =>
    set({
      activeDoc,
      status: "idle",
      ncrResult: null,
      sirResult: null,
      rawResult: "",
      errorMsg: "",
    }),
});
