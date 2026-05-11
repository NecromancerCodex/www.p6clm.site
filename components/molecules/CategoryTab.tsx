"use client";

import type { CategoryId } from "../../stores/docStore";

interface CategoryTabProps {
  id: CategoryId;
  label: string;
  icon: string;
  color: string;
  active: boolean;
  onClick: () => void;
}

export function CategoryTab({ id, label, icon, color, active, onClick }: CategoryTabProps) {
  return (
    <button
      type="button"
      className={`dag-cat-btn dag-cat-${color}${active ? " is-active" : ""}`}
      onClick={onClick}
    >
      <span className="dag-cat-icon">{icon}</span>
      <span>{label}</span>
    </button>
  );
}
