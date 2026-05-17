"use client";

import { HardHat, Menu } from "lucide-react";

import { IconButton } from "../atoms/IconButton";
import { useUiStore } from "../../stores/uiStore";

/**
 * 모바일 전용 상단 바.
 * - 데스크탑(>= 768px)에서는 CSS로 숨겨진다.
 * - 햄버거를 누르면 uiStore.sidebarOpen 을 토글하고, 사이드바가 드로어로 슬라이드 인.
 */
export function MobileTopbar() {
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);

  return (
    <header className="ws-mobile-topbar">
      <IconButton
        label="사이드바 열기"
        className="ws-hamburger"
        onClick={toggleSidebar}
      >
        <Menu size={20} strokeWidth={2} />
      </IconButton>
      <div className="ws-mobile-brand">
        <span className="ws-mobile-brand-mark">
          <HardHat size={14} strokeWidth={2} />
        </span>
        <strong>p6 CLM</strong>
      </div>
    </header>
  );
}
