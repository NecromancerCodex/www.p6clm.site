/**
 * uiStore — 화면/레이아웃 UI 상태 (Zustand)
 *
 * 슬라이스 구성:
 *   - layoutSlice : 모바일 사이드바 open/close
 */
import { create } from "zustand";

import { createLayoutSlice } from "./ui/layoutSlice";
import type { UiStore } from "./ui/types";

export type { UiStore } from "./ui/types";

export const useUiStore = create<UiStore>()((...a) => ({
  ...createLayoutSlice(...a),
}));
