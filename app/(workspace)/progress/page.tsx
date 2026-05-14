import { BarChart2 } from "lucide-react";

import { ProgressDashboard } from "../../../components/organisms/ProgressDashboard";

export const metadata = { title: "진행도 | p6 CLM" };

export default function ProgressPage() {
  return (
    <div className="ws-inner-pad ws-inner-pad--progress">
      <div className="ws-section-title">
        <BarChart2 size={18} strokeWidth={1.8} />
        진행도
      </div>
      <p className="ws-section-desc">
        문서 작성에서 생성되어 NeonDB(<code>clm_analysis_records</code>)에 저장된 이력을 문서
        종류별로 모아 보여 줍니다. 최신 생성이 위쪽 그룹에 가깝게 정렬됩니다.
      </p>
      <ProgressDashboard />
    </div>
  );
}
