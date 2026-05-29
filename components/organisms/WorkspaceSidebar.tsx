"use client";

import { Bot, BarChart2, CalendarRange, Info, ChevronRight, ChevronDown, HardHat, X, Plus, MessageSquare, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Backdrop } from "../atoms/Backdrop";
import { IconButton } from "../atoms/IconButton";
import { useUiStore } from "../../stores/uiStore";
import { useChatStore } from "../../stores/chatStore";

const NAV_ITEMS = [
  { path: "/home", label: "AI 대화·문서작성", icon: Bot },
];

// 공정관리 — 확장형 그룹 (pmisx 구조 재현)
const PROCESS_GROUP = {
  label: "공정관리",
  icon: CalendarRange,
  basePath: "/schedule",
  sections: [
    {
      title: "공정 파일 업로드",
      items: [
        { path: "/schedule",               label: "공정 파일 업로드" },
        { path: "/schedule/schedule-files", label: "스케줄 파일" },
        { path: "/schedule/milestones",     label: "마일스톤 관리" },
      ],
    },
    {
      title: "공정 조회",
      items: [
        { path: "/schedule/construction", label: "공정표" },
        { path: "/schedule/progress",     label: "공정 진도율" },
        { path: "/schedule/resource",     label: "자원 계획·실적" },
        { path: "/schedule/performance",  label: "실적 분석" },
      ],
    },
  ],
};

const NAV_ITEMS_AFTER = [
  { path: "/progress", label: "문서저장소", icon: BarChart2 },
  { path: "/about",    label: "소개",   icon: Info     },
];

export function WorkspaceSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const closeSidebar = useUiStore((s) => s.closeSidebar);

  // 채팅 세션 (3C)
  const sessions = useChatStore((s) => s.sessions);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const loadSession = useChatStore((s) => s.loadSession);
  const newChat = useChatStore((s) => s.newChat);
  const deleteSession = useChatStore((s) => s.deleteSession);

  const inProcess = pathname.startsWith(PROCESS_GROUP.basePath);
  const [processOpen, setProcessOpen] = useState(inProcess);

  /** 최근 대화 목록 로드 (mount 1회) */
  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const handleNewChat = () => {
    newChat();
    closeSidebar();
    if (pathname !== "/home") router.push("/home");
  };

  const handleSessionClick = (id: number) => {
    void loadSession(id);
    closeSidebar();
    if (pathname !== "/home") router.push("/home");
  };

  const handleDeleteSession = (e: React.MouseEvent, id: number, title: string | null) => {
    e.stopPropagation();
    if (!window.confirm(`"${title || "새 대화"}" 대화를 삭제할까요?`)) return;
    void deleteSession(id);
  };

  /** 공정관리 경로 진입 시 그룹 자동 펼침 */
  useEffect(() => {
    if (inProcess) setProcessOpen(true);
  }, [inProcess]);

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

  const renderFlat = ({ path, label, icon: Icon }: { path: string; label: string; icon: typeof Bot }) => {
    const active = pathname === path;
    return (
      <Link key={path} href={path} className={`ws-nav-item${active ? " active" : ""}`} onClick={closeSidebar}>
        <Icon size={17} strokeWidth={active ? 2.2 : 1.8} />
        <span>{label}</span>
        {active && <ChevronRight size={13} strokeWidth={2} style={{ marginLeft: "auto", opacity: 0.5 }} />}
      </Link>
    );
  };

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
          <IconButton label="사이드바 닫기" className="ws-sidebar-close" onClick={closeSidebar}>
            <X size={18} strokeWidth={2} />
          </IconButton>
        </div>

        <nav className="ws-nav">
          {NAV_ITEMS.map(renderFlat)}

          {/* 채팅 세션 (3C) — 새 채팅 + 최근 대화 */}
          <button type="button" className="ws-newchat-btn" onClick={handleNewChat}>
            <Plus size={15} strokeWidth={2.4} />
            <span>새 채팅</span>
          </button>
          {sessions.length > 0 && (
            <div className="ws-chat-list">
              {sessions.map((s) => {
                const active = currentSessionId === s.id && pathname === "/home";
                return (
                  <div
                    key={s.id}
                    className={`ws-chat-item${active ? " active" : ""}`}
                    onClick={() => handleSessionClick(s.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSessionClick(s.id); }}
                  >
                    <MessageSquare size={13} strokeWidth={1.8} className="ws-chat-icon" />
                    <span className="ws-chat-title">{s.title || "새 대화"}</span>
                    <button
                      type="button"
                      className="ws-chat-del"
                      aria-label="대화 삭제"
                      onClick={(e) => handleDeleteSession(e, s.id, s.title)}
                    >
                      <Trash2 size={12} strokeWidth={1.8} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* 공정관리 확장 그룹 */}
          <button
            type="button"
            className={`ws-nav-item ws-nav-group${inProcess ? " active" : ""}`}
            onClick={() => setProcessOpen((v) => !v)}
            aria-expanded={processOpen}
          >
            <PROCESS_GROUP.icon size={17} strokeWidth={inProcess ? 2.2 : 1.8} />
            <span>{PROCESS_GROUP.label}</span>
            {processOpen ? (
              <ChevronDown size={14} strokeWidth={2} style={{ marginLeft: "auto", opacity: 0.6 }} />
            ) : (
              <ChevronRight size={14} strokeWidth={2} style={{ marginLeft: "auto", opacity: 0.6 }} />
            )}
          </button>

          {processOpen && (
            <div className="ws-subnav">
              {PROCESS_GROUP.sections.map((sec) => (
                <div key={sec.title} className="ws-subnav-section">
                  <div className="ws-subnav-title">{sec.title}</div>
                  {sec.items.map((it) => {
                    const active = pathname === it.path;
                    return (
                      <Link
                        key={it.path}
                        href={it.path}
                        className={`ws-subnav-item${active ? " active" : ""}`}
                        onClick={closeSidebar}
                      >
                        <span className="ws-subnav-dot" />
                        {it.label}
                      </Link>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          {NAV_ITEMS_AFTER.map(renderFlat)}
        </nav>

        <div className="ws-sidebar-footer">
          <span>v0.4.0 — 공정관리 PoC</span>
        </div>
      </aside>
    </>
  );
}
