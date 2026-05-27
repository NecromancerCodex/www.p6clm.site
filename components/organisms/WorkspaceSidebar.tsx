"use client";

import { Bot, FileText, BarChart2, CalendarRange, Info, ChevronRight, HardHat, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { Backdrop } from "../atoms/Backdrop";
import { IconButton } from "../atoms/IconButton";
import { useUiStore } from "../../stores/uiStore";

const NAV_ITEMS = [
  { path: "/home",     label: "AI 대화",   icon: Bot      },
  { path: "/document", label: "문서 작성", icon: FileText },
  { path: "/schedule", label: "공정관리", icon: CalendarRange },
  { path: "/progress", label: "진행도",    icon: BarChart2 },
  { path: "/about",    label: "소개",      icon: Info     },
];

export function WorkspaceSidebar() {
  const pathname = usePathname();
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const closeSidebar = useUiStore((s) => s.closeSidebar);

  /** 경로 바뀌면 모바일 드로어 자동 닫기 */
  useEffect(() => {
    closeSidebar();
  }, [pathname, closeSidebar]);

  /** 모바일 드로어 열려 있을 때 ESC로 닫기 + body 스크롤 잠금 */
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSidebar();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [sidebarOpen, closeSidebar]);

  return (
    <>
      <Backdrop open={sidebarOpen} onClick={closeSidebar} label="사이드바 닫기" />

      <aside
        className={`ws-sidebar${sidebarOpen ? " is-open" : ""}`}
        aria-hidden={!sidebarOpen ? undefined : "false"}
      >
        <div className="ws-logo">
          <div className="ws-logo-mark">
            <HardHat size={18} strokeWidth={2} />
          </div>
          <div className="ws-logo-text">
            <strong>p6 CLM</strong>
            <span>건설 현장 AI</span>
          </div>
          <IconButton
            label="사이드바 닫기"
            className="ws-sidebar-close"
            onClick={closeSidebar}
          >
            <X size={18} strokeWidth={2} />
          </IconButton>
        </div>

        <nav className="ws-nav">
          {NAV_ITEMS.map(({ path, label, icon: Icon }) => {
            const active = pathname === path;
            return (
              <Link
                key={path}
                href={path}
                className={`ws-nav-item${active ? " active" : ""}`}
                onClick={closeSidebar}
              >
                <Icon size={17} strokeWidth={active ? 2.2 : 1.8} />
                <span>{label}</span>
                {active && (
                  <ChevronRight size={13} strokeWidth={2} style={{ marginLeft: "auto", opacity: 0.5 }} />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="ws-sidebar-footer">
          <span>v0.3.0 — NCR 파이프라인</span>
        </div>
      </aside>
    </>
  );
}
