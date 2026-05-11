"use client";

interface SpinnerProps {
  size?: "sm" | "md";
  className?: string;
}

export function Spinner({ size = "md", className = "" }: SpinnerProps) {
  return <span className={`spinner spinner-${size} ${className}`.trim()} aria-label="로딩 중" />;
}
