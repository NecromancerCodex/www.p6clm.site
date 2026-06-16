"use client";

import { useEffect, useRef, useState } from "react";

import { CHARACTERS, type CharacterDef } from "../../lib/plaza/characters";

/** 캐릭터 1종의 idle 프레임(시트 좌상단 32×64)을 확대해 보여주는 미리보기. */
function CharacterPreview({ src, size = 80 }: { src: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.imageSmoothingEnabled = false;
      const fw = 32, fh = 64;
      const scale = c.height / fh;
      const dw = fw * scale;
      ctx.drawImage(img, 0, 0, fw, fh, (c.width - dw) / 2, 0, dw, c.height);
    };
    img.src = src;
  }, [src]);
  return <canvas ref={ref} width={size} height={size * 2} className="plaza-char-preview" />;
}

/** 최초 입장 캐릭터 선택 모달 (1회). */
export function CharacterSelect({ onChoose }: { onChoose: (key: string) => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = (c: CharacterDef) => {
    if (busy) return;
    setBusy(true);
    onChoose(c.key);
  };

  return (
    <div className="plaza-charsel-backdrop">
      <div className="plaza-charsel">
        <h2 className="plaza-charsel-title">캐릭터 선택</h2>
        <p className="plaza-charsel-desc">광장에서 사용할 캐릭터를 골라주세요. (최초 1회)</p>
        <div className="plaza-charsel-grid">
          {CHARACTERS.map((c) => (
            <button
              key={c.key}
              type="button"
              className={`plaza-charsel-card${picked === c.key ? " sel" : ""}`}
              onClick={() => setPicked(c.key)}
              onDoubleClick={() => confirm(c)}
            >
              <CharacterPreview src={c.src} />
              <span className="plaza-charsel-name">{c.label}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="plaza-charsel-confirm"
          disabled={!picked || busy}
          onClick={() => { const c = CHARACTERS.find((x) => x.key === picked); if (c) confirm(c); }}
        >
          {busy ? "설정 중…" : picked ? "이 캐릭터로 시작" : "캐릭터를 선택하세요"}
        </button>
      </div>
    </div>
  );
}
