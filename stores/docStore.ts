/**
 * docStore — 문서 자동 작성 상태 (Zustand)
 *
 * 슬라이스 구성:
 *   - selectionSlice : 카테고리/문서 선택
 *   - inputSlice     : 컨텍스트/이미지 입력
 *   - generateSlice  : 파이프라인 호출 및 결과 상태
 *
 * 컴포넌트는 useDocStore 단일 훅으로 필요한 슬라이스만 선택적으로 구독한다.
 */
import { create } from "zustand";

import { createCrudSlice } from "./doc/crudSlice";
import { createGenerateSlice } from "./doc/generateSlice";
import { createInputSlice } from "./doc/inputSlice";
import { createSelectionSlice } from "./doc/selectionSlice";
import type { DocStore } from "./doc/types";

export type {
  CategoryId,
  DocStatus,
  DocStore,
  NCRDocument,
  SafetyCheckItem,
  SafetyInspectionDocument,
} from "./doc/types";

export const useDocStore = create<DocStore>()((...a) => ({
  ...createSelectionSlice(...a),
  ...createInputSlice(...a),
  ...createGenerateSlice(...a),
  ...createCrudSlice(...a),
}));
