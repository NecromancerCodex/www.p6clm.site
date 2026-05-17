/**
 * chatStore — ConstructBot 대화 상태 (Zustand)
 *
 * 슬라이스 구성:
 *   - messageSlice : 메시지/로딩/전송 액션
 *   - inputSlice   : 텍스트 입력
 *   - mediaSlice   : 이미지 첨부
 *
 * 컴포넌트는 useChatStore 단일 훅으로 필요한 슬라이스만 선택적으로 구독한다.
 */
import { create } from "zustand";

import { createInputSlice } from "./chat/inputSlice";
import { createMediaSlice } from "./chat/mediaSlice";
import { createMessageSlice } from "./chat/messageSlice";
import type { ChatStore } from "./chat/types";

export type { ChatStore, Message, TriggeredJob } from "./chat/types";

export const useChatStore = create<ChatStore>()((...a) => ({
  ...createMessageSlice(...a),
  ...createInputSlice(...a),
  ...createMediaSlice(...a),
}));
