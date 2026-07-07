"use client";

/**
 * CAD(DXF) 멀티 임포트 → **레이어별 의미지정** → ##섹션 CSV 생성.
 * 실무 도면은 55+ 레이어 중 의미있는 건 몇 개("00 시추공"·경계·등고선)뿐 →
 * 레이어마다 카테고리 자동추천 + 드롭다운 확정. 생성 CSV 는 기존 CSV 임포트와 동일 파이프라인.
 */
import { useMemo, useState } from "react";
import { FileUp, X, Download, ArrowRight, ChevronDown } from "lucide-react";

import {
  readDxfFile, analyzeFiles, extractSelected, layerKey,
  CATS, CATEGORY_LABEL, type FileImport, type Category,
} from "../../lib/earthwork/dxfImport";
import { earthworkToCsv } from "../../lib/earthwork/csvExport";

export function CadImportPanel({ onGenerated }: { onGenerated: (csv: string, label: string) => void }) {
  const [files, setFiles] = useState<FileImport[]>([]);
  const [sel, setSel] = useState<Record<string, Category>>({});
  const [showAll, setShowAll] = useState(false);
  const [err, setErr] = useState("");

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!list.length) return;
    setErr("");
    const next: FileImport[] = [];
    for (const f of list) {
      try { next.push(readDxfFile(f.name, await f.text())); }
      catch { setErr(`${f.name} 읽기 실패 (DXF ASCII 인지 확인 · DWG는 DXF로 내보내기)`); }
    }
    setFiles((prev) => [...prev, ...next]);
  };

  const layers = useMemo(() => analyzeFiles(files), [files]);
  const catOf = (file: string, layer: string, suggested: Category) => sel[layerKey(file, layer)] ?? suggested;
  const setCat = (file: string, layer: string, c: Category) => setSel((p) => ({ ...p, [layerKey(file, layer)]: c }));

  const data = useMemo(() => (files.length ? extractSelected(files, sel) : null), [files, sel]);
  const has = data && (data.boundary.length || data.piles.length || data.boreholes.length || data.terrain.length || data.walls.length);

  const shown = showAll ? layers : layers.filter((l) => catOf(l.file, l.layer, l.suggested) !== "ignore");
  const hiddenCount = layers.length - shown.length;

  const apply = () => { if (data) onGenerated(earthworkToCsv(data), `CAD 추출 (${files.length}파일)`); };
  const download = () => {
    if (!data) return;
    const blob = new Blob([earthworkToCsv(data)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "토공_추출.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--surface-soft)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <label style={{
          display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: 10,
          border: "1px solid var(--line-strong)", background: "var(--surface)", color: "var(--muted-strong)", fontSize: 13.5, fontWeight: 600, cursor: "pointer",
        }}>
          <FileUp size={15} strokeWidth={2.1} /> CAD(DXF) 가져오기
          <input type="file" accept=".dxf" multiple onChange={onPick} style={{ display: "none" }} />
        </label>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>
          경계·pile·CIP·시추 여러 파일 한 번에 · <strong>레이어별</strong> 의미 지정 → CSV 생성
        </span>
        {files.length > 0 && (
          <button type="button" onClick={() => { setFiles([]); setSel({}); }} style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)", background: "none", border: "none", cursor: "pointer" }}>전체 지우기</button>
        )}
      </div>

      {err && <div style={{ marginTop: 8, fontSize: 12, color: "var(--red)" }}>{err}</div>}

      {layers.length > 0 && (
        <div style={{ marginTop: 10, border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ display: "flex", gap: 8, padding: "6px 12px", background: "var(--surface-soft)", fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>
            <span style={{ flex: 1 }}>레이어 (파일)</span>
            <span style={{ width: 130, textAlign: "right" }}>엔티티</span>
            <span style={{ width: 120 }}>의미</span>
          </div>
          {shown.map((l) => (
            <div key={l.file + "|" + l.layer} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderTop: "1px solid var(--surface-soft)", fontSize: 12.5 }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ color: "var(--muted-strong)", fontWeight: 600 }}>{l.layer || "(무명)"}</span>
                <span style={{ color: "var(--muted)", fontSize: 11, marginLeft: 6 }}>{l.file}</span>
              </span>
              <span style={{ width: 130, textAlign: "right", fontSize: 10.5, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.types}</span>
              <select
                value={catOf(l.file, l.layer, l.suggested)}
                onChange={(e) => setCat(l.file, l.layer, e.target.value as Category)}
                style={{ width: 120, fontSize: 12, padding: "3px 6px", borderRadius: 6, border: "1px solid var(--line-strong)", background: "var(--surface)", color: "var(--muted-strong)" }}
              >
                {CATS.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
              </select>
            </div>
          ))}
          {hiddenCount > 0 && (
            <button type="button" onClick={() => setShowAll((s) => !s)}
              style={{ width: "100%", padding: "6px 12px", borderTop: "1px solid var(--surface-soft)", background: "#fafbfc", border: "none", cursor: "pointer", fontSize: 11.5, color: "var(--muted)", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
              <ChevronDown size={12} style={{ transform: showAll ? "rotate(180deg)" : "none" }} />
              {showAll ? "무시 레이어 접기" : `무시 레이어 ${hiddenCount}개 더보기`}
            </button>
          )}
        </div>
      )}

      {has && data && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {data.boreholes.length > 0 && <Tag label={`시추 ${data.boreholes.length}공`} c="var(--primary)" />}
            {data.boundary.length > 0 && <Tag label={`경계 ${data.boundary.length}점`} c="var(--green)" />}
            {data.piles.length > 0 && <Tag label={`Pile ${data.piles.length}`} c="var(--primary-deep)" />}
            {data.walls.length > 0 && <Tag label={`흙막이 ${data.walls.length}`} c="var(--red)" />}
            {data.terrain.length > 0 && <Tag label={`지형 ${data.terrain.length}점`} c="var(--teal)" />}
          </span>
          <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
            <button type="button" onClick={download} style={btn("var(--surface)", "var(--muted-strong)", "var(--line-strong)")}>
              <Download size={14} /> CSV 다운로드
            </button>
            <button type="button" onClick={apply} style={btn("linear-gradient(180deg,var(--primary),var(--primary))", "var(--surface)")}>
              <ArrowRight size={14} /> CSV 생성 & 적용
            </button>
          </div>
        </div>
      )}
      {files.length > 0 && (
        <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 8, marginBottom: 0 }}>
          ※ CAD엔 지층 두께가 없습니다 — 시추 위치·심도만 추출되고, <strong>지층 두께는 아래 시추공 편집표에서 입력</strong>하세요.
        </p>
      )}
    </div>
  );
}

function Tag({ label, c }: { label: string; c: string }) {
  return <span style={{ fontSize: 11, fontWeight: 600, color: c, background: `${c}14`, border: `1px solid ${c}33`, borderRadius: 6, padding: "3px 8px" }}>{label}</span>;
}
function btn(bg: string, color: string, border?: string): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 9,
    border: border ? `1px solid ${border}` : "none", background: bg, color, fontSize: 13, fontWeight: 600, cursor: "pointer",
  };
}
