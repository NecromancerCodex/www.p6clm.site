import type { ReactNode } from "react";

import { MobileTopbar } from "../../components/molecules/MobileTopbar";
import { WorkspaceSidebar } from "../../components/organisms/WorkspaceSidebar";
import { AuthGuard } from "../../components/organisms/AuthGuard";
import PlanWatcher from "../../components/schedule/PlanWatcher";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <div className="ws-shell">
        <WorkspaceSidebar />
        <div className="ws-main">
          <MobileTopbar />
          <main className="ws-content">{children}</main>
        </div>
        {/* 플래닝 백그라운드 완료 알림 — 다른 페이지에 있어도 토스트→검토 이동 */}
        <PlanWatcher />
      </div>
    </AuthGuard>
  );
}
