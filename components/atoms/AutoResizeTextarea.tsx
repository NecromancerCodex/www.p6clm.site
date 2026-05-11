"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  forwardRef,
  type TextareaHTMLAttributes,
} from "react";

interface AutoResizeTextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  maxHeight?: number;
}

export const AutoResizeTextarea = forwardRef<
  HTMLTextAreaElement,
  AutoResizeTextareaProps
>(({ maxHeight = 180, className = "", onChange, ...rest }, ref) => {
  const innerRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => innerRef.current!);

  const resize = useCallback(() => {
    const el = innerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, [maxHeight]);

  useEffect(() => {
    resize();
  }, [rest.value, resize]);

  return (
    <textarea
      ref={innerRef}
      className={className}
      rows={1}
      onChange={(e) => {
        resize();
        onChange?.(e);
      }}
      {...rest}
    />
  );
});

AutoResizeTextarea.displayName = "AutoResizeTextarea";
