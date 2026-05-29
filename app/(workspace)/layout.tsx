import type { ReactNode } from "react";

import { MobileTopbar } from "../../components/molecules/MobileTopbar";
import { WorkspaceSidebar } from "../../components/organisms/WorkspaceSidebar";
import { AuthGuard } from "../../components/organisms/AuthGuard";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <div className="ws-shell">
        <WorkspaceSidebar />
        <div className="ws-main">
          <MobileTopbar />
          <main className="ws-content">{children}</main>
        </div>
      </div>
    </AuthGuard>
  );
}
