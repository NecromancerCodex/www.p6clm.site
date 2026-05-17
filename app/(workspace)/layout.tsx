import type { ReactNode } from "react";

import { MobileTopbar } from "../../components/molecules/MobileTopbar";
import { WorkspaceSidebar } from "../../components/organisms/WorkspaceSidebar";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <div className="ws-shell">
      <WorkspaceSidebar />
      <div className="ws-main">
        <MobileTopbar />
        <main className="ws-content">{children}</main>
      </div>
    </div>
  );
}
