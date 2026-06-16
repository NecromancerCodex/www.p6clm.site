"use client";

import { useEffect, useRef } from "react";

import { drawItemIcon } from "../../lib/plaza/render";
import type { Item } from "../../lib/plaza/catalog";

/** 아이템을 작은 캔버스에 그려 보여주는 아이콘. */
export function ItemIcon({ item, size = 48 }: { item: Item; size?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (ctx) drawItemIcon(ctx, item, size);
  }, [item, size]);
  return <canvas ref={ref} width={size} height={size} className="plaza-item-icon" />;
}
