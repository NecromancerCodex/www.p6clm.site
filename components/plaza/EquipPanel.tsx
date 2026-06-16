"use client";

import { X } from "lucide-react";

import { usePlazaStore } from "../../stores/plazaStore";
import { getItem, SLOT_ORDER, SLOT_LABEL } from "../../lib/plaza/catalog";
import { ItemIcon } from "./ItemIcon";

/** 장비(E) — 슬롯별 장착 현황. 슬롯 클릭하면 해제. */
export function EquipPanel({ onClose }: { onClose: () => void }) {
  const equipped = usePlazaStore((s) => s.equipped);
  const unequip = usePlazaStore((s) => s.unequip);

  return (
    <div className="plaza-panel">
      <div className="plaza-panel-head">
        <span className="plaza-panel-title">🧢 장비</span>
        <button type="button" className="plaza-panel-x" onClick={onClose} aria-label="닫기"><X size={16} /></button>
      </div>
      <div className="plaza-slots">
        {SLOT_ORDER.map((slot) => {
          const item = getItem(equipped[slot]);
          return (
            <div key={slot} className={`plaza-slot${item ? " filled" : ""}`}>
              <span className="plaza-slot-label">{SLOT_LABEL[slot]}</span>
              {item ? (
                <button
                  type="button"
                  className="plaza-slot-item"
                  onClick={() => void unequip(slot)}
                  title="클릭하여 해제"
                >
                  <ItemIcon item={item} />
                  <span className="plaza-card-name">{item.name}</span>
                  <span className="plaza-slot-remove">해제</span>
                </button>
              ) : (
                <div className="plaza-slot-empty">비어 있음</div>
              )}
            </div>
          );
        })}
      </div>
      <p className="plaza-panel-foot">슬롯을 클릭하면 해제됩니다. 장착은 인벤토리(I)에서.</p>
    </div>
  );
}
