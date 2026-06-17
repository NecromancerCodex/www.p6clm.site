"use client";

import { useEffect, useRef } from "react";

import { loadManifest, composeAvatar, type AvatarConfig } from "../../lib/plaza/parts";

/** 아바타 설정을 합성해 작은 캔버스에 그려주는 미리보기 (참가자 카드용). */
export function AvatarThumb({ config, w = 54, h = 64 }: { config: AvatarConfig; w?: number; h?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    let alive = true;
    void loadManifest().then((m) => composeAvatar(m, config)).then((res) => {
      if (!alive || !res) return;
      const c = ref.current; if (!c) return;
      const ctx = c.getContext("2d"); if (!ctx) return;
      ctx.clearRect(0, 0, c.width, c.height);
      const scale = Math.min(c.width / res.w, c.height / res.h);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(res.canvas, (c.width - res.w * scale) / 2, c.height - res.h * scale, res.w * scale, res.h * scale);
    });
    return () => { alive = false; };
  }, [config]);
  return <canvas ref={ref} width={w} height={h} className="plaza-pcard-av" />;
}
