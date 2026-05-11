import type { ReactNode } from "react";

import { WorkspaceSidebar } from "../../components/organisms/WorkspaceSidebar";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <div className="ws-shell">
      <WorkspaceSidebar />
      <main className="ws-content">{children}</main>
    </div>
  );
}
