"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";

import { usePlazaStore } from "../../stores/plazaStore";
import {
  loadManifest, partUrl, partKey, PAID_CATS, CATEGORY_PRICE, CATEGORY_LABELS,
  type PartsManifest,
} from "../../lib/plaza/parts";

/** 상점 — 카테고리별 파츠(헤어·옷 등) 구매. 색상 변경은 무료(크리에이터). */
export function ShopPanel({ onClose }: { onClose: () => void }) {
  const currency = usePlazaStore((s) => s.currency);
  const inventory = usePlazaStore((s) => s.inventory);
  const buy = usePlazaStore((s) => s.buy);

  const [manifest, setManifest] = useState<PartsManifest | null>(null);
  const [cat, setCat] = useState<string>("hair");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { void loadManifest().then(setManifest); }, []);

  const tabs = useMemo(
    () => (manifest ? PAID_CATS.filter((c) => manifest.categories[c]) : []),
    [manifest],
  );
  const owned = useMemo(() => new Set(inventory), [inventory]);

  const handleBuy = async (key: string) => {
    setBusy(key); setMsg(null);
    const r = await buy(key);
    setBusy(null);
    setMsg(r.ok ? "구매 완료! 🎨 캐릭터에서 착용하세요." : r.error || "구매 실패");
  };

  const c = manifest?.categories[cat];
  const price = CATEGORY_PRICE[cat] ?? 0;

  return (
    <div className="plaza-panel plaza-panel--wide">
      <div className="plaza-panel-head">
        <span className="plaza-panel-title">🛒 상점</span>
        <span className="plaza-coin">🪙 {currency.toLocaleString()}</span>
        <button type="button" className="plaza-panel-x" onClick={onClose} aria-label="닫기"><X size={16} /></button>
      </div>

      <div className="plaza-creator-tabs" style={{ padding: "10px 14px 0" }}>
        {tabs.map((t) => (
          <button key={t} type="button" className={`plaza-creator-tab${cat === t ? " on" : ""}`} onClick={() => setCat(t)}>
            {CATEGORY_LABELS[t] || t}
          </button>
        ))}
      </div>

      {msg && <p className="plaza-shop-msg">{msg}</p>}

      <div className="plaza-grid">
        {manifest && c && c.items.map((shape) => {
          const key = partKey(cat, shape);
          const have = owned.has(key);
          const poor = currency < price;
          const url = partUrl(manifest, cat, shape); // 기본 색 썸네일
          return (
            <div key={shape} className="plaza-card plaza-card--shop">
              <div className="plaza-shop-thumb">{url && <img src={url} alt="" loading="lazy" />}</div>
              <span className="plaza-card-price">🪙 {price.toLocaleString()}</span>
              <button
                type="button"
                className="plaza-buy"
                disabled={have || poor || busy === key}
                onClick={() => void handleBuy(key)}
              >
                {have ? "보유중" : poor ? "재화 부족" : busy === key ? "구매 중…" : "구매"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
