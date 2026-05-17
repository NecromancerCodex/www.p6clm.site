"use client";

interface BackdropProps {
  open: boolean;
  onClick: () => void;
  label?: string;
}

export function Backdrop({ open, onClick, label = "닫기" }: BackdropProps) {
  return (
    <button
      type="button"
      aria-label={label}
      tabIndex={open ? 0 : -1}
      onClick={onClick}
      className={`ui-backdrop${open ? " is-open" : ""}`}
    />
  );
}
