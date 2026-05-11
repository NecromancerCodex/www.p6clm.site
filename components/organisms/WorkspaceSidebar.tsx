"use client";

import { Bot, FileText, BarChart2, Info, ChevronRight, HardHat } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { path: "/home",     label: "AI 대화",   icon: Bot      },
  { path: "/document", label: "문서 작성", icon: FileText },
  { path: "/progress", label: "진행도",    icon: BarChart2 },
  { path: "/about",    label: "소개",      icon: Info     },
];

export function WorkspaceSidebar() {
  const pathname = usePathname();

  return (
    <aside className="ws-sidebar">
      <div className="ws-logo">
        <div className="ws-logo-mark">
          <HardHat size={18} strokeWidth={2} />
        </div>
        <div className="ws-logo-text">
          <strong>p6 CLM</strong>
          <span>건설 현장 AI</span>
        </div>
      </div>

      <nav className="ws-nav">
        {NAV_ITEMS.map(({ path, label, icon: Icon }) => {
          const active = pathname === path;
          return (
            <Link
              key={path}
              href={path}
              className={`ws-nav-item${active ? " active" : ""}`}
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
  );
}
