"use client";

/**
 * CAD(DXF) 멀티 임포트 → **레이어별 의미지정** → ##섹션 CSV 생성.
 * 실무 도면은 55+ 레이어 중 의미있는 건 몇 개("00 시추공"·경계·등고선)뿐 →
 * 레이어마다 카테고리 자동추천 + 드롭다운 확정. 생성 CSV 는 기존 CSV 임포트와 동일 파이프라인.
 */
import { useEffect, useMemo, useState } from "react";
import { FileUp, X, Download, ArrowRight, ChevronDown, Sparkles, ScanSearch } from "lucide-react";

import {
  readDxfFile, analyzeFiles, extractSelected, layerKey, suggestCategory,
  CATS, CATEGORY_LABEL, type FileImport, type Category,
} from "../../lib/earthwork/dxfImport";
import { earthworkToCsv } from "../../lib/earthwork/csvExport";
import { renderContactSheet } from "../../lib/earthwork/cadSheet";
import { classifyCadLayers, classifyCadLayersVision } from "../../lib/api/earthwork";
import { CadLayerPreview } from "./CadLayerPreview";

export function CadImportPanel({ onGenerated }: { onGenerated: (csv: string, label: string) => void }) {
  const [files, setFiles] = useState<FileImport[]>([]);
  const [sel, setSel] = useState<Record<string, Category>>({});   // 사용자 확정(최우선)
  const [aiMap, setAiMap] = useState<Record<string, Category>>({}); // AI 추천(규칙보다 우선)
  const [aiBusy, setAiBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState<string | null>(null);   // 미리보기·행 선택(layerKey)

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

  // AI 레이어 분류 (gpt-5-mini) — 레이어명이 코드/제각각이라 키워드 규칙이 취약 → 의미 추론.
  // 결과는 규칙 위·사용자 아래(3계층). 실패 시 {} → 규칙 폴백. 기하는 안 건드림.
  useEffect(() => {
    if (!files.length) { setAiMap({}); return; }
    let alive = true;
    setAiBusy(true);
    const infos = analyzeFiles(files);
    const byName = new Map<string, { name: string; types: string; samples: string[] }>();
    for (const i of infos) {
      const cur = byName.get(i.layer);
      if (cur) { for (const s of i.samples) if (cur.samples.length < 3 && !cur.samples.includes(s)) cur.samples.push(s); }
      else byName.set(i.layer, { name: i.layer, types: i.types, samples: [...i.samples] });
    }
    void classifyCadLayers([...byName.values()]).then((res) => {
      if (!alive) return;
      const m: Record<string, Category> = {};
      for (const i of infos) {
        const c = res[i.layer];
        if (c && (CATS as string[]).includes(c)) m[layerKey(i.file, i.layer)] = c as Category;
      }
      setAiMap(m);
    }).finally(() => { if (alive) setAiBusy(false); });
    return () => { alive = false; };
  }, [files]);

  // 우선순위: 사용자 확정 > AI 추천 > 규칙(suggested)
  const eff = useMemo(() => ({ ...aiMap, ...sel }), [aiMap, sel]);
  const catOf = (file: string, layer: string, suggested: Category) => eff[layerKey(file, layer)] ?? suggested;
  const catFor = (file: string, layer: string) => eff[layerKey(file, layer)] ?? suggestCategory(layer);
  const setCat = (file: string, layer: string, c: Category) => setSel((p) => ({ ...p, [layerKey(file, layer)]: c }));
  const aiCount = Object.keys(aiMap).length;

  // 파일 제거 — 단면도 등 부적합 파일을 통째로 빼기. 해당 파일 키(sel/aiMap)도 정리.
  const removeFile = (name: string) => {
    setFiles((p) => p.filter((f) => f.name !== name));
    const prune = (m: Record<string, Category>) => Object.fromEntries(Object.entries(m).filter(([k]) => !k.startsWith(`${name} `)));
    setSel(prune); setAiMap(prune);
  };

  // 캐스케이드 재분류 — 사용자가 확정한 레이어를 예시로 AI 가 나머지 추론(대지경계 하나 찍으면 유사 패턴 따라옴).
  const reclassify = async () => {
    if (!files.length) return;
    const infos = analyzeFiles(files);
    const examples: Record<string, string> = {};
    for (const i of infos) { const k = layerKey(i.file, i.layer); if (sel[k]) examples[i.layer] = sel[k]; }
    const byName = new Map<string, { name: string; types: string; samples: string[] }>();
    for (const i of infos) {
      const cur = byName.get(i.layer);
      if (cur) { for (const s of i.samples) if (cur.samples.length < 3 && !cur.samples.includes(s)) cur.samples.push(s); }
      else byName.set(i.layer, { name: i.layer, types: i.types, samples: [...i.samples] });
    }
    setAiBusy(true);
    try {
      const res = await classifyCadLayers([...byName.values()], examples);
      const m: Record<string, Category> = {};
      for (const i of infos) { const c = res[i.layer]; if (c && (CATS as string[]).includes(c)) m[layerKey(i.file, i.layer)] = c as Category; }
      setAiMap(m);
    } finally { setAiBusy(false); }
  };

  // 비전 분류 — 텍스트로 못 가른 무시 레이어를 썸네일로 그려 gpt-5-mini 가 '모양'으로 판단.
  const visionClassify = async () => {
    const targets = layers
      .filter((l) => catOf(l.file, l.layer, l.suggested) === "ignore" && l.count >= 5)
      .slice(0, 40)
      .map((l) => ({ file: l.file, layer: l.layer }));
    if (!targets.length) return;
    const sheet = renderContactSheet(files, targets);
    if (!sheet) return;
    setAiBusy(true);
    try {
      const res = await classifyCadLayersVision(sheet.b64, sheet.refs.map((r) => ({ n: r.n, name: r.name })));
      setAiMap((prev) => {
        const m = { ...prev };
        for (const l of layers) { const c = res[l.layer]; if (c && (CATS as string[]).includes(c) && c !== "ignore") m[layerKey(l.file, l.layer)] = c as Category; }
        return m;
      });
    } finally { setAiBusy(false); }
  };
  const visionTargets = layers.filter((l) => catOf(l.file, l.layer, l.suggested) === "ignore" && l.count >= 5).length;

  const data = useMemo(() => (files.length ? extractSelected(files, eff) : null), [files, eff]);
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
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: "var(--primary)" }}>
            <Sparkles size={12} />
            {aiBusy ? "AI 레이어 분류 중…" : aiCount > 0 ? `AI 추천 ${aiCount}개 적용` : "AI 추천 없음 (규칙 폴백)"}
          </span>
        )}
        {files.length > 0 && visionTargets > 0 && (
          <button type="button" onClick={visionClassify} disabled={aiBusy}
            title="텍스트로 못 가른 코드레이어를 그림(모양)으로 AI가 분류"
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: "var(--teal)", background: "var(--surface-soft)", border: "1px solid var(--teal)", borderRadius: 7, padding: "2px 8px", cursor: aiBusy ? "default" : "pointer", opacity: aiBusy ? 0.5 : 1 }}>
            <ScanSearch size={11} /> 이미지로 분류 ({visionTargets})
          </button>
        )}
        {files.length > 0 && Object.keys(sel).length > 0 && (
          <button type="button" onClick={reclassify} disabled={aiBusy}
            title="내가 지정한 레이어를 예시로 AI가 나머지를 다시 추론"
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: "var(--primary)", background: "var(--primary-soft)", border: "1px solid var(--primary)", borderRadius: 7, padding: "2px 8px", cursor: aiBusy ? "default" : "pointer", opacity: aiBusy ? 0.5 : 1 }}>
            <Sparkles size={11} /> AI 재분류 (내 지정 반영)
          </button>
        )}
        {files.length > 0 && (
          <button type="button" onClick={() => { setFiles([]); setSel({}); setAiMap({}); }} style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)", background: "none", border: "none", cursor: "pointer" }}>전체 지우기</button>
        )}
      </div>

      {err && <div style={{ marginTop: 8, fontSize: 12, color: "var(--red)" }}>{err}</div>}

      {/* 올린 파일 칩 — 단면도 등 부적합 파일 개별 제거 */}
      {files.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          {files.map((f) => (
            <span key={f.name} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: "var(--muted-strong)", background: "var(--surface-soft)", border: "1px solid var(--line)", borderRadius: 7, padding: "3px 8px" }}>
              {f.name}
              <button type="button" onClick={() => removeFile(f.name)} title="이 파일 제거" style={{ border: "none", background: "none", color: "var(--muted)", cursor: "pointer", padding: 0, lineHeight: 1 }}><X size={12} /></button>
            </span>
          ))}
          <span style={{ fontSize: 10.5, color: "var(--muted)", alignSelf: "center" }}>※ 평면도만 사용 — <strong>단면도(단면·section)는 제거</strong>하세요 (좌표가 평면이 아님)</span>
        </div>
      )}

      {/* 시각적 미리보기 — 기하를 그려 무엇이 어디인지 확인, 클릭으로 레이어 선택 */}
      {files.length > 0 && (
        <CadLayerPreview
          files={files}
          catFor={catFor}
          selectedKey={selected}
          onSelectLayer={(f, l) => setSelected(layerKey(f, l))}
        />
      )}

      {layers.length > 0 && (
        <div style={{ marginTop: 10, border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ display: "flex", gap: 8, padding: "6px 12px", background: "var(--surface-soft)", fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>
            <span style={{ flex: 1 }}>레이어 (파일)</span>
            <span style={{ width: 130, textAlign: "right" }}>엔티티</span>
            <span style={{ width: 120 }}>의미</span>
          </div>
          {shown.map((l) => {
            const isSel = selected === layerKey(l.file, l.layer);
            return (
            <div key={l.file + "|" + l.layer}
              onClick={() => setSelected(layerKey(l.file, l.layer))}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderTop: "1px solid var(--surface-soft)", fontSize: 12.5, cursor: "pointer", background: isSel ? "var(--primary-soft)" : "transparent" }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <span style={{ color: "var(--muted-strong)", fontWeight: 600 }}>{l.layer || "(무명)"}</span>
                  <span style={{ color: "var(--muted)", fontSize: 11, marginLeft: 6 }}>{l.file.replace(/\.dxf$/i, "")}</span>
                </span>
                {l.samples.length > 0 && (
                  <span style={{ display: "block", fontSize: 10.5, color: "var(--teal)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    「{l.samples.join(", ")}」
                  </span>
                )}
              </span>
              <span style={{ width: 110, textAlign: "right", fontSize: 10.5, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.types}</span>
              <select
                value={catOf(l.file, l.layer, l.suggested)}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setCat(l.file, l.layer, e.target.value as Category)}
                style={{ width: 120, fontSize: 12, padding: "3px 6px", borderRadius: 6, border: "1px solid var(--line-strong)", background: "var(--surface)", color: "var(--muted-strong)" }}
              >
                {CATS.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
              </select>
            </div>
            );
          })}
          {hiddenCount > 0 && (
            <button type="button" onClick={() => setShowAll((s) => !s)}
              style={{ width: "100%", padding: "6px 12px", borderTop: "1px solid var(--surface-soft)", background: "var(--surface-soft)", border: "none", cursor: "pointer", fontSize: 11.5, color: "var(--muted)", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
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
