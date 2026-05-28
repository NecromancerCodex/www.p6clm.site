import { ProgressDashboard } from "../../../components/organisms/ProgressDashboard";

export const metadata = { title: "문서저장소 | p6 CLM" };

export default function ProgressPage() {
  return (
    <div className="ws-inner-pad ws-inner-pad--progress">
      <ProgressDashboard />
    </div>
  );
}
