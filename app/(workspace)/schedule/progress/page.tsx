import { ScheduleProgress } from "../../../../components/process/ScheduleProgress";

export const metadata = { title: "공정 진도율 | p6 CLM" };

export default function ScheduleProgressPage() {
  return (
    <div className="ws-docs-wrap">
      <ScheduleProgress />
    </div>
  );
}
