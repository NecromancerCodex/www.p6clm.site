"use client";

/**
 * 자원 계획 — BIM(IFC)에서 추출한 '필요 자재' + 현장 '보유 자재' CRUD.
 *
 *  · IFC 업로드 → lib/fourd/ifc 파서로 부재 타입별 수량 집계 → 필요자재 자동 채움(교체).
 *  · 필요/보유 두 표 인라인 편집(이름·규격·단위·수량·비고) + 행 추가/삭제.
 *  · 부족/잉여 = (필요 - 보유) 를 이름 매칭으로 산출.
 *  영속: 백엔드 material_plan (소유자별). lib/api/materials.
 */
import { Boxes, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  createMaterial,
  deleteMaterial,
  importRequiredFromBim,
  listMaterials,
  updateMaterial,
  type BimMaterial,
  type Material,
  type MaterialKind,
} from "../../../../lib/api/materials";
import { EarthworkVolumePanel } from "../../../../components/earthwork/EarthworkVolumePanel";

// IFC 클래스 → 자재명(한글). 같은 자재로 묶어 중복 행 방지(Wall 계열 → 벽체).
const TYPE_KO_MAT: Record<string, string> = {
  IfcWall: "벽체",
  IfcWallStandardCase: "벽체",
  IfcColumn: "기둥",
  IfcSlab: "슬래브",
  IfcBeam: "보",
  IfcFooting: "기초",
  IfcDoor: "문",
  IfcWindow: "창호",
  IfcCovering: "마감재",
  IfcRailing: "난간",
  IfcStair: "계단",
  IfcStairFlight: "계단",
  IfcMember: "부재",
  IfcPlate: "판재",
  IfcBuildingElementProxy: "모듈/기타",
};

export default function ResourcePlanPage() {
  const [required, setRequired] = useState<Material[]>([]);
  const [stock, setStock] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [bimMsg, setBimMsg] = useState("");
  const [bimBusy, setBimBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = async () => {
    try {
      const all = await listMaterials();
      setRequired(all.filter((m) => m.kind === "required"));
      setStock(all.filter((m) => m.kind === "stock"));
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "로드 실패");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  // ── IFC 업로드 → 부재 타입별 수량 집계 → 필요자재 교체 ──
  const onIfc = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) e.target.value = ""; // 같은 파일 재선택 허용
    if (!file) return;
    setBimBusy(true);
    setBimMsg("IFC 분석 중…");
    try {
      const { parseIfc } = await import("../../../../lib/fourd/ifc");
      const buf = await file.arrayBuffer();
      const parsed = await parseIfc(buf, (_p, msg) => setBimMsg(msg));
      let items: BimMaterial[];
      let mode: string;
      if (parsed.steelQto && parsed.steelQto.length) {
        // 철골 물량(QTO) — 규격별 중량(t). 개수보다 정확.
        items = parsed.steelQto.map((s) => ({
          name: `철골 ${s.group}`,
          spec: `${s.count}본`,
          quantity: Math.round(s.weightT * 100) / 100,
          unit: "t",
          ifc_type: "Steel",
        }));
        mode = "철골 물량(t)";
      } else {
        // 폴백 — 부재 타입별 개수 집계.
        const byName = new Map<string, { qty: number; ifc: string }>();
        for (const el of parsed.elements) {
          const nm = TYPE_KO_MAT[el.ifcType] ?? el.ifcType;
          const cur = byName.get(nm) ?? { qty: 0, ifc: el.ifcType };
          cur.qty += 1;
          byName.set(nm, cur);
        }
        items = [...byName].map(([name, v]) => ({ name, quantity: v.qty, unit: "EA", ifc_type: v.ifc }));
        mode = "부재 개수";
      }
      const n = await importRequiredFromBim(items);
      setBimMsg(`BIM에서 ${n}종 추출 완료 (${mode})`);
      await reload();
    } catch (e2) {
      setBimMsg(e2 instanceof Error ? `실패: ${e2.message}` : "IFC 분석 실패");
    } finally {
      setBimBusy(false);
    }
  };

  // ── 행 편집/추가/삭제 ──
  const setList = (kind: MaterialKind) => (kind === "required" ? setRequired : setStock);

  const editLocal = (kind: MaterialKind, id: number, field: keyof Material, value: string | number) => {
    setList(kind)((prev) => prev.map((m) => (m.id === id ? { ...m, [field]: value } : m)));
  };

  const persist = (id: number, field: keyof Material, value: string | number) => {
    void updateMaterial(id, { [field]: value }).catch(() => void reload());
  };

  const addRow = async (kind: MaterialKind) => {
    try {
      await createMaterial({ kind, name: "새 자재", unit: "EA", quantity: 0 });
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "추가 실패");
    }
  };

  const removeRow = (kind: MaterialKind, id: number) => {
    setList(kind)((prev) => prev.filter((m) => m.id !== id)); // 낙관적 제거
    void deleteMaterial(id).catch(() => void reload());
  };

  // ── 부족/잉여 (이름 매칭) ──
  const stockByName = new Map(stock.map((s) => [s.name, s.quantity]));
  const shortages = required
    .map((r) => ({ name: r.name, unit: r.unit, gap: r.quantity - (stockByName.get(r.name) ?? 0) }))
    .filter((x) => x.gap > 0);

  return (
    <div className="ws-inner-pad">
      <div className="ws-section-title">
        <Boxes size={18} strokeWidth={1.8} />
        자원 계획
      </div>
      <p className="ws-section-desc">
        BIM(IFC)에서 필요 자재를 추출하고, 현장 보유 자재와 비교해 부족분을 관리합니다.
      </p>

      {/* 토공 물량 (토공/지반 페이지 데이터 연계) */}
      <EarthworkVolumePanel />

      {/* BIM 추출 */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", margin: "8px 0 16px" }}>
        <input ref={fileRef} type="file" accept=".ifc" onChange={onIfc} style={{ display: "none" }} />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={bimBusy}
          style={primaryBtn(bimBusy)}
        >
          <Upload size={15} strokeWidth={2} style={{ marginRight: 6, verticalAlign: "-2px" }} />
          {bimBusy ? "분석 중…" : "BIM(IFC)에서 필요 자재 추출"}
        </button>
        {bimMsg && <span style={{ fontSize: 13, color: "#475569" }}>{bimMsg}</span>}
      </div>

      {err && <div style={{ color: "#dc2626", fontSize: 13, marginBottom: 10 }}>⚠ {err}</div>}

      {/* 부족 요약 */}
      {shortages.length > 0 && (
        <div
          style={{
            background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8,
            padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#991b1b",
          }}
        >
          <strong>부족 자재 {shortages.length}종</strong> —{" "}
          {shortages.map((s) => `${s.name} ${s.gap.toLocaleString()}${s.unit}`).join(", ")}
        </div>
      )}

      {loading ? (
        <div style={{ color: "#64748b", fontSize: 14 }}>불러오는 중…</div>
      ) : (
        <>
          <MaterialTable
            title="필요 자재 (BIM 추출)"
            kind="required"
            rows={required}
            stockByName={stockByName}
            onEdit={editLocal}
            onPersist={persist}
            onAdd={addRow}
            onRemove={removeRow}
          />
          <div style={{ height: 24 }} />
          <MaterialTable
            title="보유 자재 (현장 재고)"
            kind="stock"
            rows={stock}
            onEdit={editLocal}
            onPersist={persist}
            onAdd={addRow}
            onRemove={removeRow}
          />
        </>
      )}
    </div>
  );
}

// ── 자재 표 (인라인 편집) ────────────────────────────────────────────────────

interface TableProps {
  title: string;
  kind: MaterialKind;
  rows: Material[];
  stockByName?: Map<string, number>; // 필요자재 표일 때 부족 계산용
  onEdit: (kind: MaterialKind, id: number, field: keyof Material, value: string | number) => void;
  onPersist: (id: number, field: keyof Material, value: string | number) => void;
  onAdd: (kind: MaterialKind) => void;
  onRemove: (kind: MaterialKind, id: number) => void;
}

function MaterialTable({ title, kind, rows, stockByName, onEdit, onPersist, onAdd, onRemove }: TableProps) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1e293b" }}>
          {title} <span style={{ color: "#94a3b8", fontWeight: 500 }}>({rows.length})</span>
        </h3>
        <button type="button" onClick={() => onAdd(kind)} style={addBtn}>+ 행 추가</button>
      </div>
      <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 640 }}>
          <thead>
            <tr style={{ background: "#f8fafc", color: "#475569" }}>
              <Th>자재명</Th>
              <Th>규격</Th>
              <Th w={80}>단위</Th>
              <Th w={110} right>수량</Th>
              {kind === "required" && <Th w={100} right>부족</Th>}
              <Th>비고</Th>
              <Th w={50} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={kind === "required" ? 7 : 6} style={{ padding: 16, textAlign: "center", color: "#94a3b8" }}>
                  자재 없음 — {kind === "required" ? "BIM 추출 또는 " : ""}[+ 행 추가]로 입력
                </td>
              </tr>
            ) : (
              rows.map((m) => {
                const gap = kind === "required" ? m.quantity - (stockByName?.get(m.name) ?? 0) : 0;
                return (
                  <tr key={m.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                    <Td><Inp v={m.name} onCh={(v) => onEdit(kind, m.id, "name", v)} onBlur={(v) => onPersist(m.id, "name", v)} /></Td>
                    <Td><Inp v={m.spec ?? ""} onCh={(v) => onEdit(kind, m.id, "spec", v)} onBlur={(v) => onPersist(m.id, "spec", v)} /></Td>
                    <Td><Inp v={m.unit} onCh={(v) => onEdit(kind, m.id, "unit", v)} onBlur={(v) => onPersist(m.id, "unit", v)} /></Td>
                    <Td>
                      <Inp
                        v={String(m.quantity)}
                        num
                        onCh={(v) => onEdit(kind, m.id, "quantity", Number(v) || 0)}
                        onBlur={(v) => onPersist(m.id, "quantity", Number(v) || 0)}
                      />
                    </Td>
                    {kind === "required" && (
                      <td style={{ padding: "4px 8px", textAlign: "right", fontWeight: 600, color: gap > 0 ? "#dc2626" : "#16a34a" }}>
                        {gap > 0 ? gap.toLocaleString() : "충족"}
                      </td>
                    )}
                    <Td><Inp v={m.note ?? ""} onCh={(v) => onEdit(kind, m.id, "note", v)} onBlur={(v) => onPersist(m.id, "note", v)} /></Td>
                    <td style={{ padding: "4px 8px", textAlign: "center" }}>
                      <button type="button" onClick={() => onRemove(kind, m.id)} title="삭제" style={delBtn}>✕</button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, w, right }: { children?: React.ReactNode; w?: number; right?: boolean }) {
  return (
    <th style={{ padding: "8px", textAlign: right ? "right" : "left", fontWeight: 600, width: w, whiteSpace: "nowrap" }}>
      {children}
    </th>
  );
}
function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: "4px 6px" }}>{children}</td>;
}
function Inp({ v, num, onCh, onBlur }: { v: string; num?: boolean; onCh: (v: string) => void; onBlur: (v: string) => void }) {
  return (
    <input
      value={v}
      inputMode={num ? "decimal" : undefined}
      onChange={(e) => onCh(e.target.value)}
      onBlur={(e) => onBlur(e.target.value)}
      style={{
        width: "100%", padding: "5px 7px", border: "1px solid transparent", borderRadius: 6,
        fontSize: 13, background: "transparent", textAlign: num ? "right" : "left",
      }}
    />
  );
}

function primaryBtn(busy: boolean): React.CSSProperties {
  return {
    padding: "9px 16px", borderRadius: 8, border: "none", background: busy ? "#94a3b8" : "#2563eb",
    color: "#fff", fontSize: 14, fontWeight: 600, cursor: busy ? "default" : "pointer",
  };
}
const addBtn: React.CSSProperties = {
  padding: "6px 12px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff",
  color: "#334155", fontSize: 13, fontWeight: 600, cursor: "pointer",
};
const delBtn: React.CSSProperties = {
  border: "none", background: "transparent", color: "#cbd5e1", cursor: "pointer", fontSize: 14, fontWeight: 700,
};
