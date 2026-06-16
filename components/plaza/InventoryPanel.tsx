"use client";

import { X } from "lucide-react";

import { usePlazaStore } from "../../stores/plazaStore";
import { getItem, SLOT_LABEL, type Item } from "../../lib/plaza/catalog";
import { ItemIcon } from "./ItemIcon";

/** 인벤토리(I) — 보유 아이템 그리드. 클릭하면 장착/해제 토글. */
export function InventoryPanel({ onClose }: { onClose: () => void }) {
  const currency = usePlazaStore((s) => s.currency);
  const inventory = usePlazaStore((s) => s.inventory);
  const equipped = usePlazaStore((s) => s.equipped);
  const toggleEquip = usePlazaStore((s) => s.toggleEquip);

  const items = inventory.map(getItem).filter((i): i is Item => !!i);

  return (
    <div className="plaza-panel">
      <div className="plaza-panel-head">
        <span className="plaza-panel-title">🎒 인벤토리</span>
        <span className="plaza-coin">🪙 {currency.toLocaleString()}</span>
        <button type="button" className="plaza-panel-x" onClick={onClose} aria-label="닫기"><X size={16} /></button>
      </div>
      {items.length === 0 ? (
        <p className="plaza-panel-empty">보유한 아이템이 없습니다.<br />상점에서 장비를 구매해보세요!</p>
      ) : (
        <div className="plaza-grid">
          {items.map((item) => {
            const on = equipped[item.slot] === item.key;
            return (
              <button
                key={item.key}
                type="button"
                className={`plaza-card${on ? " equipped" : ""}`}
                onClick={() => void toggleEquip(item.key)}
                title={item.desc}
              >
                <ItemIcon item={item} />
                <span className="plaza-card-name">{item.name}</span>
                <span className="plaza-card-slot">{SLOT_LABEL[item.slot]}</span>
                {on && <span className="plaza-card-badge">장착중</span>}
              </button>
            );
          })}
        </div>
      )}
      <p className="plaza-panel-foot">아이템을 클릭하면 장착/해제됩니다.</p>
    </div>
  );
}
