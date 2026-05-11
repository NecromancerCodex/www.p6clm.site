"use client";

interface DocListItemProps {
  id: string;
  label: string;
  isNcr?: boolean;
  active: boolean;
  onClick: () => void;
}

export function DocListItem({ id, label, isNcr, active, onClick }: DocListItemProps) {
  return (
    <li>
      <button
        type="button"
        className={`dag-doc-item${active ? " is-active" : ""}${isNcr ? " dag-doc-ncr" : ""}`}
        onClick={onClick}
      >
        <span className="dag-doc-icon">{isNcr ? "📋" : "📄"}</span>
        <span className="dag-doc-label">{label}</span>
        {isNcr && <span className="dag-ncr-badge">NCR</span>}
        <span className="dag-doc-arrow">→</span>
      </button>
    </li>
  );
}
