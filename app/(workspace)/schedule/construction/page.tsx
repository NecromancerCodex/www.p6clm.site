import { GanttView } from "../../../../components/process/GanttView";

export const metadata = { title: "공정표 | p6 CLM" };

export default function ConstructionPage() {
  return (
    <div className="ws-docs-wrap">
      <GanttView />
    </div>
  );
}
