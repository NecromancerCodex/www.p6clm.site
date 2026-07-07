"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

import { usePlazaStore } from "../../stores/plazaStore";
import {
  loadManifest, composeAvatar, partUrl, partKey, isPaid,
  PAID_CATS, CATEGORY_PRICE, CATEGORY_LABELS, DEFAULT_AVATAR,
  type PartsManifest, type AvatarConfig,
} from "../../lib/plaza/parts";

/** 상점 — 카테고리별 파츠 구매 + 구매 전 미리보기(내 아바타에 합성). */
export function ShopPanel({ onClose }: { onClose: () => void }) {
  const currency = usePlazaStore((s) => s.currency);
  const inventory = usePlazaStore((s) => s.inventory);
  const avatar = usePlazaStore((s) => s.avatar);
  const buy = usePlazaStore((s) => s.buy);

  const [manifest, setManifest] = useState<PartsManifest | null>(null);
  const [cat, setCat] = useState<string>("hair");
  const [sel, setSel] = useState<string | null>(null); // 미리보기 선택 shape
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => { void loadManifest().then(setManifest); }, []);

  const tabs = useMemo(
    () => (manifest ? PAID_CATS.filter((c) => manifest.categories[c]) : []),
    [manifest],
  );
  const owned = useMemo(() => new Set(inventory), [inventory]);
  const price = CATEGORY_PRICE[cat] ?? 0;
  const c = manifest?.categories[cat];

  // 미리보기 합성: 내 아바타 + 선택 아이템(있으면) — 원피스 상호배제 반영
  useEffect(() => {
    if (!manifest) return;
    const base: AvatarConfig = { ...DEFAULT_AVATAR, ...(avatar || {}) };
    if (sel) {
      base[cat] = sel;
      if (cat === "dress") { delete base.top; delete base.bottom; }
      else if (cat === "top" || cat === "bottom") { delete base.dress; }
    }
    let alive = true;
    void composeAvatar(manifest, base).then((res) => {
      if (!alive || !res) return;
      const cv = previewRef.current; if (!cv) return;
      const ctx = cv.getContext("2d"); if (!ctx) return;
      ctx.clearRect(0, 0, cv.width, cv.height);
      const scale = Math.min(cv.width / res.w, cv.height / res.h);
      const dw = res.w * scale, dh = res.h * scale;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(res.canvas, (cv.width - dw) / 2, cv.height - dh, dw, dh);
    });
    return () => { alive = false; };
  }, [manifest, avatar, cat, sel]);

  const handleBuy = async (key: string) => {
    setBusy(key); setMsg(null);
    const r = await buy(key);
    setBusy(null);
    setMsg(r.ok ? "구매 완료! 🎨 캐릭터에서 착용하세요." : r.error || "구매 실패");
  };

  const selKey = sel ? partKey(cat, sel) : null;
  const selOwned = selKey ? owned.has(selKey) : false;

  return (
    <div className="plaza-panel plaza-panel--wide">
      <div className="plaza-panel-head">
        <span className="plaza-panel-title">🛒 상점</span>
        <span className="plaza-coin">🪙 {currency.toLocaleString()}</span>
        <button type="button" className="plaza-panel-x" onClick={onClose} aria-label="닫기"><X size={16} /></button>
      </div>

      <div className="plaza-creator-tabs" style={{ padding: "10px 14px 0" }}>
        {tabs.map((t) => (
          <button key={t} type="button" className={`plaza-creator-tab${cat === t ? " on" : ""}`} onClick={() => { setCat(t); setSel(null); }}>
            {CATEGORY_LABELS[t] || t}
          </button>
        ))}
      </div>

      {msg && <p className="plaza-shop-msg">{msg}</p>}

      <div className="plaza-shop-body">
        {/* 미리보기 */}
        <div className="plaza-shop-preview">
          <canvas ref={previewRef} width={150} height={225} />
          <div className="plaza-shop-preview-info">
            {sel ? (
              <>
                <div className="plaza-shop-preview-name">{CATEGORY_LABELS[cat]} #{sel}</div>
                <button
                  type="button" className="plaza-buy"
                  disabled={!selKey || selOwned || currency < price || busy === selKey}
                  onClick={() => selKey && void handleBuy(selKey)}
                >
                  {selOwned ? "보유중" : currency < price ? "재화 부족" : busy === selKey ? "구매 중…" : `구매 🪙${price}`}
                </button>
              </>
            ) : <div className="plaza-shop-preview-hint">아이템을 눌러<br />미리보기</div>}
          </div>
        </div>

        {/* 그리드 */}
        <div className="plaza-grid plaza-shop-grid">
          {manifest && c && c.items.map((shape) => {
            const key = partKey(cat, shape);
            const have = owned.has(key);
            const url = partUrl(manifest, cat, shape);
            return (
              <button
                key={shape}
                type="button"
                className={`plaza-card plaza-card--shop${sel === shape ? " sel" : ""}`}
                onClick={() => setSel(shape)}
              >
                <div className="plaza-shop-thumb">{url && <img src={url} alt="" loading="lazy" />}</div>
                {have ? <span className="plaza-card-badge">보유</span> : <span className="plaza-card-price">🪙{isPaid(cat) ? price : 0}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
