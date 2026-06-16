"use client";

import { useState } from "react";
import { X } from "lucide-react";

import { usePlazaStore } from "../../stores/plazaStore";
import { ALL_ITEMS, SLOT_LABEL } from "../../lib/plaza/catalog";
import { ItemIcon } from "./ItemIcon";

/** 상점 — 카탈로그 아이템 구매. 보유한 것은 '보유중'으로 비활성. */
export function ShopPanel({ onClose }: { onClose: () => void }) {
  const currency = usePlazaStore((s) => s.currency);
  const inventory = usePlazaStore((s) => s.inventory);
  const buy = usePlazaStore((s) => s.buy);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const owned = new Set(inventory);

  const handleBuy = async (key: string) => {
    setBusy(key);
    setMsg(null);
    const r = await buy(key);
    setBusy(null);
    setMsg(r.ok ? "구매 완료! 인벤토리에서 장착하세요." : r.error || "구매 실패");
  };

  return (
    <div className="plaza-panel plaza-panel--wide">
      <div className="plaza-panel-head">
        <span className="plaza-panel-title">🛒 상점</span>
        <span className="plaza-coin">🪙 {currency.toLocaleString()}</span>
        <button type="button" className="plaza-panel-x" onClick={onClose} aria-label="닫기"><X size={16} /></button>
      </div>
      {msg && <p className="plaza-shop-msg">{msg}</p>}
      <div className="plaza-grid">
        {ALL_ITEMS.map((item) => {
          const have = owned.has(item.key);
          const poor = currency < item.price;
          return (
            <div key={item.key} className="plaza-card plaza-card--shop" title={item.desc}>
              <ItemIcon item={item} />
              <span className="plaza-card-name">{item.name}</span>
              <span className="plaza-card-slot">{SLOT_LABEL[item.slot]}</span>
              <span className="plaza-card-price">🪙 {item.price.toLocaleString()}</span>
              <button
                type="button"
                className="plaza-buy"
                disabled={have || poor || busy === item.key}
                onClick={() => void handleBuy(item.key)}
              >
                {have ? "보유중" : poor ? "재화 부족" : busy === item.key ? "구매 중…" : "구매"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
