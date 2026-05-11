"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost" | "icon";
  size?: "sm" | "md";
  children: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...rest
}: ButtonProps) {
  const base = "btn";
  const v = `btn-${variant}`;
  const s = `btn-${size}`;
  return (
    <button className={`${base} ${v} ${s} ${className}`.trim()} {...rest}>
      {children}
    </button>
  );
}
