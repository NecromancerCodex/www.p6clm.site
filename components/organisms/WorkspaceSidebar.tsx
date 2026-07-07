"use client";

import { Bot, BarChart2, CalendarRange, Info, ChevronRight, ChevronDown, HardHat, X, Plus, MessageSquare, Trash2, LogOut, Phone, Mountain, Gamepad2, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Backdrop } from "../atoms/Backdrop";
import { IconButton } from "../atoms/IconButton";
import { useUiStore } from "../../stores/uiStore";
import { useChatStore } from "../../stores/chatStore";
import { logout, fetchMe } from "../../lib/auth";

const NAV_ITEMS = [
  { path: "/home", label: "AI 대화", icon: Bot },
  { path: "/plaza", label: "광장", icon: Gamepad2 }, // 2D 플랫포머 실시간 대화방
];

// 공정관리 — 확장형 그룹. 대시보드(4D)가 기본 진입점.
// soon: true = 라우트 미연결 placeholder ('준비 중', 비활성). 나중에 path 연결만 하면 됨.
const PROCESS_GROUP = {
  label: "공정관리",
  icon: CalendarRange,
  basePaths: ["/fourd", "/schedule"], // 이 중 하나에 있으면 그룹 자동 펼침
  items: [
    { path: "/fourd",             label: "대시보드" },
    { path: "/schedule/plan",     label: "공정표 빌더" },
    { path: "/schedule/progress", label: "공정 진도율" },
    { path: "/schedule/resource", label: "자원 계획" },
  ] as { path: string; label: string; soon?: boolean }[],
};

// 공정관리 그룹 뒤 — 문서 저장소 → (전화내역, admin) → 소개 순.
const NAV_DOCS = { path: "/progress", label: "문서 저장소", icon: BarChart2 };
const NAV_EARTHWORK = { path: "/earthwork", label: "토공 / 지반", icon: Mountain }; // 시추 3D 지층·물량
const NAV_CALLS_ADMIN = { path: "/calls", label: "전화내역", icon: Phone }; // admin 전용
const NAV_ABOUT = { path: "/about", label: "소개", icon: Info };

export function WorkspaceSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const closeSidebar = useUiStore((s) => s.closeSidebar);
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const setCollapsed = useUiStore((s) => s.setSidebarCollapsed);
  const toggleCollapsed = useUiStore((s) => s.toggleSidebarCollapsed);

  // 채팅 세션 (3C)
  const sessions = useChatStore((s) => s.sessions);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const loadSession = useChatStore((s) => s.loadSession);
  const newChat = useChatStore((s) => s.newChat);
  const deleteSession = useChatStore((s) => s.deleteSession);

  const inProcess = PROCESS_GROUP.basePaths.some((p) => pathname.startsWith(p));
  const [processOpen, setProcessOpen] = useState(inProcess);

  // admin 여부 (전화 내역 메뉴 노출 제어) — fetchMe 는 AuthGuard 가 이미 호출, 캐시 재사용
  const [isAdmin, setIsAdmin] = useState(false);

  /** 데스크탑 접힘 상태 복원 (mount 1회, localStorage) */
  useEffect(() => {
    try {
      if (localStorage.getItem("ws-collapsed") === "1") setCollapsed(true);
    } catch { /* 무시 */ }
  }, [setCollapsed]);

  /** 최근 대화 목록 로드 (mount 1회) */
  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  /** admin 여부 확인 (mount 1회) */
  useEffect(() => {
    let alive = true;
    void fetchMe().then((u) => {
      if (alive) setIsAdmin(u?.role === "admin");
    });
    return () => { alive = false; };
  }, []);

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

      {/* 데스크탑 접힘 시 — 펼치기 플로팅 버튼 */}
      {collapsed && (
        <button
          type="button"
          className="ws-expand-fab"
          aria-label="사이드바 펼치기"
          title="사이드바 펼치기"
          onClick={toggleCollapsed}
        >
          <PanelLeftOpen size={18} strokeWidth={2} />
        </button>
      )}

      <aside
        className={`ws-sidebar${sidebarOpen ? " is-open" : ""}${collapsed ? " is-collapsed" : ""}`}
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
          <IconButton label="사이드바 접기" className="ws-sidebar-collapse" onClick={toggleCollapsed}>
            <PanelLeftClose size={18} strokeWidth={2} />
          </IconButton>
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
              <div className="ws-subnav-section">
                {PROCESS_GROUP.items.map((it) => {
                  // 준비 중(soon) — 라우트 미연결, 비활성 표시
                  if (it.soon) {
                    return (
                      <span
                        key={it.path}
                        className="ws-subnav-item is-soon"
                        aria-disabled="true"
                        title="준비 중"
                      >
                        <span className="ws-subnav-dot" />
                        {it.label}
                        <span className="ws-subnav-badge">준비 중</span>
                      </span>
                    );
                  }
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
            </div>
          )}

          {/* 문서 저장소 → (전화내역, admin) → 소개 */}
          {renderFlat(NAV_DOCS)}
          {renderFlat(NAV_EARTHWORK)}
          {isAdmin && renderFlat(NAV_CALLS_ADMIN)}
          {renderFlat(NAV_ABOUT)}
        </nav>

        <div className="ws-sidebar-footer">
          <button
            type="button"
            className="ws-logout-btn"
            onClick={async () => { await logout(); router.replace("/login"); }}
          >
            <LogOut size={15} strokeWidth={1.9} />
            <span>로그아웃</span>
          </button>
          <span className="ws-version">v0.4.0 — 공정관리 PoC</span>
        </div>
      </aside>
    </>
  );
}
