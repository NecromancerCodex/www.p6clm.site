import { BarChart2 } from "lucide-react";

export const metadata = { title: "진행도 | p6 CLM" };

export default function ProgressPage() {
  return (
    <div className="ws-inner-pad">
      <div className="ws-section-title">
        <BarChart2 size={18} strokeWidth={1.8} />
        진행도
      </div>
      <p className="ws-section-desc">
        현장 분석 요청의 처리 현황과 NCR 생성 이력을 확인할 수 있습니다.
      </p>
      <div className="ws-placeholder">
        <BarChart2 size={40} strokeWidth={1} />
        <span>진행도 데이터를 불러오는 중...</span>
      </div>
    </div>
  );
}
