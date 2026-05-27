import { Construction } from "lucide-react";

export function SchedulePlaceholder({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="ws-inner-pad">
      <div className="ws-section-title">
        <Construction size={18} strokeWidth={1.8} />
        {title}
      </div>
      <p className="ws-section-desc">{desc}</p>
      <div className="sch-placeholder">
        <Construction size={36} strokeWidth={1.4} />
        <strong>준비 중</strong>
        <span>이 화면은 PoC 다음 단계에서 구현됩니다.</span>
      </div>
    </div>
  );
}
