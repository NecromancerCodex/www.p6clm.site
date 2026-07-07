"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

import {
  loadManifest, composeAvatar, partUrl, partKey, isPaid,
  CATEGORY_LABELS, CATEGORY_ORDER, OPTIONAL_CATS, DEFAULT_AVATAR,
  type PartsManifest, type AvatarConfig,
} from "../../lib/plaza/parts";
import { usePlazaStore } from "../../stores/plazaStore";

function parseStem(stem: string | undefined): { shape: string; color: string } {
  const m = (stem || "").match(/^(\d+)([a-z]?)$/);
  return { shape: m?.[1] ?? "", color: m?.[2] ?? "" };
}

/** 캐릭터 크리에이터 — 파츠/색상 선택 + 실시간 미리보기. */
export function CharacterCreator({
  initial, onSave, onClose,
}: {
  initial: AvatarConfig | null;
  onSave: (config: AvatarConfig) => void;
  onClose?: () => void;
}) {
  const [manifest, setManifest] = useState<PartsManifest | null>(null);
  const [config, setConfig] = useState<AvatarConfig>({ ...DEFAULT_AVATAR, ...(initial || {}) });
  const [activeCat, setActiveCat] = useState<string>("body");
  const [busy, setBusy] = useState(false);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const inventory = usePlazaStore((s) => s.inventory);
  const owned = useMemo(() => new Set(inventory), [inventory]);

  useEffect(() => { void loadManifest().then(setManifest); }, []);

  // 탭 목록 (매니페스트에 존재하는 카테고리만)
  const tabs = useMemo(
    () => (manifest ? CATEGORY_ORDER.filter((c) => manifest.categories[c]) : []),
    [manifest],
  );

  // 실시간 미리보기 합성
  useEffect(() => {
    if (!manifest) return;
    let alive = true;
    void composeAvatar(manifest, config).then((res) => {
      if (!alive || !res) return;
      const c = previewRef.current;
      if (!c) return;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, c.width, c.height);
      const scale = Math.min(c.width / res.w, c.height / res.h);
      const dw = res.w * scale, dh = res.h * scale;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(res.canvas, (c.width - dw) / 2, c.height - dh, dw, dh);
    });
    return () => { alive = false; };
  }, [manifest, config]);

  if (!manifest) {
    return (
      <div className="plaza-charsel-backdrop"><div className="plaza-creator"><p className="plaza-panel-empty">불러오는 중…</p></div></div>
    );
  }

  const cat = manifest.categories[activeCat];
  const { shape: curShape, color: curColor } = parseStem(config[activeCat]);
  const hasColors = (cat?.colors.length ?? 0) > 1;

  const setPart = (shape: string, color: string) =>
    setConfig((c) => {
      const n = { ...c, [activeCat]: `${shape}${color}` };
      // 원피스 ↔ 상하의 상호배제 (겹쳐 입기 방지)
      if (activeCat === "dress") { delete n.top; delete n.bottom; }
      else if (activeCat === "top" || activeCat === "bottom") { delete n.dress; }
      return n;
    });
  const clearPart = () =>
    setConfig((c) => { const n = { ...c }; delete n[activeCat]; return n; });

  const confirm = () => { setBusy(true); onSave(config); };

  return (
    <div className="plaza-charsel-backdrop">
      <div className="plaza-creator">
        <div className="plaza-panel-head">
          <span className="plaza-panel-title">캐릭터 만들기</span>
          {onClose && <button type="button" className="plaza-panel-x" onClick={onClose} aria-label="닫기"><X size={16} /></button>}
        </div>

        <div className="plaza-creator-body">
          {/* 미리보기 */}
          <div className="plaza-creator-preview">
            <canvas ref={previewRef} width={220} height={330} />
          </div>

          {/* 선택 패널 */}
          <div className="plaza-creator-panel">
            <div className="plaza-creator-tabs">
              {tabs.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`plaza-creator-tab${activeCat === c ? " on" : ""}`}
                  onClick={() => setActiveCat(c)}
                >
                  {CATEGORY_LABELS[c] || c}
                </button>
              ))}
            </div>

            {/* 색상 행 */}
            {hasColors && (
              <div className="plaza-creator-colors">
                {cat.colors.map((col) => {
                  const stem = `${curShape || cat.items[0]}${col}`;
                  const url = partUrl(manifest, activeCat, stem);
                  return (
                    <button
                      key={col || "base"}
                      type="button"
                      className={`plaza-color-chip${curColor === col ? " on" : ""}`}
                      onClick={() => setPart(curShape || cat.items[0], col)}
                      title={col || "기본"}
                    >
                      {url && <img src={url} alt="" loading="lazy" />}
                    </button>
                  );
                })}
              </div>
            )}

            {/* 모양 그리드 — 유료 카테고리는 보유한 것만 노출 */}
            {(() => {
              const paid = isPaid(activeCat);
              const visible = paid ? cat.items.filter((s) => owned.has(partKey(activeCat, s))) : cat.items;
              const showNone = OPTIONAL_CATS.has(activeCat);
              if (paid && visible.length === 0 && !showNone) {
                return <p className="plaza-panel-empty">아직 보유한 {CATEGORY_LABELS[activeCat]}가 없어요.<br />상점에서 구매하세요!</p>;
              }
              return (
                <div className="plaza-creator-grid">
                  {showNone && (
                    <button
                      type="button"
                      className={`plaza-part-card${!config[activeCat] ? " on" : ""}`}
                      onClick={clearPart}
                    >
                      <span className="plaza-part-none">없음</span>
                    </button>
                  )}
                  {visible.map((shape) => {
                    const url = partUrl(manifest, activeCat, `${shape}${curColor}`);
                    return (
                      <button
                        key={shape}
                        type="button"
                        className={`plaza-part-card${curShape === shape ? " on" : ""}`}
                        onClick={() => setPart(shape, curColor)}
                      >
                        {url && <img src={url} alt="" loading="lazy" />}
                      </button>
                    );
                  })}
                  {paid && (
                    <div className="plaza-part-card plaza-part-shop-hint">
                      <span className="plaza-part-none">+ 상점</span>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>

        <button type="button" className="plaza-charsel-confirm" disabled={busy} onClick={confirm}>
          {busy ? "저장 중…" : "이 캐릭터로 시작"}
        </button>
      </div>
    </div>
  );
}
