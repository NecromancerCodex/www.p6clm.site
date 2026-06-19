/**
 * uiStore 공통 타입
 *
 * 화면/레이아웃 관련 UI 상태(슬라이스 단위로 확장 가능).
 * 현재는 모바일 사이드바 열림 여부만 관리하지만,
 * 향후 모달/토스트/테마 등은 별도 슬라이스로 추가.
 */

export interface LayoutSlice {
  sidebarOpen: boolean;          // 모바일 드로어 열림
  openSidebar: () => void;
  closeSidebar: () => void;
  toggleSidebar: () => void;
  sidebarCollapsed: boolean;     // 데스크탑 사이드바 접힘
  setSidebarCollapsed: (v: boolean) => void;
  toggleSidebarCollapsed: () => void;
}

export type UiStore = LayoutSlice;
