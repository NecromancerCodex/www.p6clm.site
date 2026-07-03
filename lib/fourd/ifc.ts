/**
 * 클라이언트 IFC 파서 (web-ifc WASM) → three.js GPU 인스턴싱 지오메트리 + 요소 메타.
 *
 * 성능: Revit 패밀리(IFC RepresentationMap/MappedItem)는 동일 지오메트리를 수백~수천 번
 * 재사용한다. 과거엔 placed geometry 마다 정점을 단일 BufferGeometry 로 복제해 메모리가
 * 폭발했다(예: 480k placed → 32M 정점). 이제는 geometryExpressID 로 묶어 '유니크 지오메트리'
 * 만 1회 tessellate 하고, 각 인스턴스는 flatTransformation 행렬만 보관한다(InstancedMesh).
 *   예: 480k placed / 19k unique → 4M 정점 (≈88% 절감).
 *
 * 요소(flatMesh)는 여러 placed geometry 를 가질 수 있어, 각 인스턴스 참조 {g,i}(그룹·슬롯)를
 * 요소에 모두 기록한다. 타임라인 변경 시 요소의 인스턴스들 색만 setColorAt 으로 갱신한다.
 *
 * web-ifc wasm 은 /public/web-ifc/ 에서 서빙 (SetWasmPath).
 * 'use client' 컴포넌트에서만 동적 import 로 사용 (SSR 불가).
 */
import * as THREE from "three";
import { IfcAPI, IFCRELCONTAINEDINSPATIALSTRUCTURE, IFCRELDEFINESBYPROPERTIES } from "web-ifc";

import type { IfcElementMeta } from "./match";
import { normStorey } from "./match";

export interface ParsedElement extends IfcElementMeta {
  rgba?: [number, number, number, number]; // IFC 원본 재질색(첫 인스턴스 RGBA) — 실사 모드용. 무스타일=미설정
  inst: { g: number; i: number }[]; // 이 요소의 인스턴스 참조 — g=그룹 index, i=그룹 내 슬롯 index
  cx: number; // bbox 중심 X (월드)
  cy: number; // bbox 중심 Y (월드, 수직)
  cz: number; // bbox 중심 Z (월드)
  // 정량물량(QTO) — IfcElementQuantity 추출(있으면), 없으면 bbox 체적 추정. 품셈 정밀적용·자원계획용.
  volM3?: number; // 체적 ㎥ (콘크리트 물량)
  areaM2?: number; // 면적 ㎡ (거푸집 물량)
  // 공정 PSet (REV IFC) — 없으면 undefined (구버전 IFC)
  trade?: string; // ST | MO
  zone?: string; // ZA | ZB | ZC | AB ...
  storey4d?: string; // 01 | 02 | PT | RF ... (elevation 보정 후)
  wt?: string; // CR | FT | PR | MD
  mtype?: string; // Lv.5 모델 타입 (36 | 46) — MO 유닛 매칭용
  unit?: string; // Lv.6 모듈 번호 (1~8)
  phase?: string; // Lv.8 단계 (RB/FM/CN/IN) — 단계별 날짜 매칭
  disc?: string; // 공종(토목/구조/가설…) — 슬롯 임포트 시 파일 단위로 확정(매칭 라우팅). PSet trade 없어도 적용.
  recalibrated?: boolean; // PT 태그였으나 높이로 실제 층 보정됨
}

/** 철골 물량 — 규격(또는 공종)별 중량 합계(t). QTO PSet(철골중량(t)·규격)에서 추출. */
export interface SteelQto {
  group: string; // 규격(예 300x300x10x15) 또는 공종, 없으면 "철골"
  weightT: number; // 합계 중량(t)
  count: number; // 부재 수
}

/**
 * GPU 인스턴싱 그룹 — 동일 유니크 지오메트리(geometryExpressID)를 공유하는 인스턴스 묶음.
 * 뷰어가 InstancedMesh(geometry, material, count) 1개로 렌더한다.
 */
export interface InstanceGroup {
  geometry: THREE.BufferGeometry; // 로컬 indexed geometry (position + normal + index) — 1회만 생성
  matrices: Float32Array; // count*16 — 인스턴스별 flatTransformation(column-major)
  elementIdx: Int32Array; // count — 인스턴스 slot → elements 배열 index (hover 역참조)
  count: number; // 인스턴스 개수
}

export interface ParsedIfc {
  groups: InstanceGroup[]; // GPU 인스턴싱 그룹(유니크 지오메트리별) — 뷰어가 InstancedMesh 로 렌더
  elements: ParsedElement[];
  center: THREE.Vector3;
  radius: number;
  bbox: THREE.Box3; // 전체 월드 bbox — 바닥 그리드 높이(min.y)·정합 등 (병합 geometry 부재 대체)
  steelQto?: SteelQto[]; // 철골 물량(있으면) — 자원 계획 BIM 자재추출 고도화
  skippedTrades?: string[]; // 메모리 절약 위해 기하 로드 안 한 trade(가설 등) — 패널이 '로드' 제공
}

// ── 파싱 결과 캐싱 직렬화 (재방문 시 341MB 재파싱 스킵 → 즉시 4D) ──────────────
// IndexedDB structured-clone 은 THREE 클래스 인스턴스(BufferGeometry/Vector3/Box3) 미지원
// → raw TypedArray/plain 으로 변환. TypedArray·Map 자체는 structured-clone 지원이라 그대로 둠.
export interface SerializedGroup {
  pos: Float32Array;
  norm?: Float32Array;
  idx?: Uint32Array | Uint16Array;
  matrices: Float32Array;
  elementIdx: Int32Array;
  count: number;
}
export interface SerializedParsed {
  groups: SerializedGroup[];
  elements: ParsedElement[];
  center: { x: number; y: number; z: number };
  radius: number;
  bbox: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
  steelQto?: SteelQto[];
  skippedTrades?: string[];
}

export function serializeParsed(p: ParsedIfc): SerializedParsed {
  return {
    groups: p.groups.map((g) => {
      const pos = g.geometry.getAttribute("position").array as Float32Array;
      const normAttr = g.geometry.getAttribute("normal");
      const idxAttr = g.geometry.getIndex();
      return {
        pos,
        norm: normAttr ? (normAttr.array as Float32Array) : undefined,
        idx: idxAttr ? (idxAttr.array as Uint32Array | Uint16Array) : undefined,
        matrices: g.matrices,
        elementIdx: g.elementIdx,
        count: g.count,
      };
    }),
    elements: p.elements,
    center: { x: p.center.x, y: p.center.y, z: p.center.z },
    radius: p.radius,
    bbox: {
      min: { x: p.bbox.min.x, y: p.bbox.min.y, z: p.bbox.min.z },
      max: { x: p.bbox.max.x, y: p.bbox.max.y, z: p.bbox.max.z },
    },
    steelQto: p.steelQto,
    skippedTrades: p.skippedTrades,
  };
}

export function deserializeParsed(s: SerializedParsed): ParsedIfc {
  return {
    groups: s.groups.map((g) => {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(g.pos, 3));
      if (g.norm) geom.setAttribute("normal", new THREE.BufferAttribute(g.norm, 3));
      if (g.idx) geom.setIndex(new THREE.BufferAttribute(g.idx, 1));
      return { geometry: geom, matrices: g.matrices, elementIdx: g.elementIdx, count: g.count };
    }),
    elements: s.elements,
    center: new THREE.Vector3(s.center.x, s.center.y, s.center.z),
    radius: s.radius,
    bbox: new THREE.Box3(
      new THREE.Vector3(s.bbox.min.x, s.bbox.min.y, s.bbox.min.z),
      new THREE.Vector3(s.bbox.max.x, s.bbox.max.y, s.bbox.max.z),
    ),
    steelQto: s.steelQto,
    skippedTrades: s.skippedTrades,
  };
}

let _api: IfcAPI | null = null;

async function getApi(): Promise<IfcAPI> {
  if (_api) return _api;
  const api = new IfcAPI();
  api.SetWasmPath("/web-ifc/", true); // absolute=true → origin 루트(/web-ifc/web-ifc.wasm)에서 로드. false면 JS 청크 상대경로(_next/static/chunks/web-ifc/)로 붙어 404
  await api.Init();
  // web-ifc 의 GetMesh/GetColor 등 '못 그리는 요소' 로그 억제 → 콘솔 정리 + 파싱 가속
  // (LOG_LEVEL_OFF=6). 스킵되는 요소는 어차피 형상이 없어 렌더 대상 아님.
  try {
    (api as unknown as { SetLogLevel?: (n: number) => void }).SetLogLevel?.(6);
  } catch {
    /* 구버전 web-ifc 무시 */
  }
  _api = api;
  return api;
}

/**
 * IFC STEP 문자열 디코드. web-ifc 는 한글을 \X2\<UTF-16BE hex>\X0\ 로 raw 반환한다.
 *   예: "502_1\X2\CE35\X0\ SL" → "502_1층 SL"  (CE35 = U+CE35 "층")
 * \X2\…\X0\ (UTF-16BE) 와 \X\HH (latin1) 만 처리. 인코딩 없으면 원본 그대로.
 */
function decodeIfcString(s: string): string {
  if (!s || s.indexOf("\\X") === -1) return s;
  let out = "";
  let i = 0;
  while (i < s.length) {
    if (s.startsWith("\\X2\\", i)) {
      i += 4;
      let hex = "";
      while (i < s.length && !s.startsWith("\\X0\\", i)) hex += s[i++];
      i += 4; // \X0\ 스킵
      for (let j = 0; j + 4 <= hex.length; j += 4) {
        out += String.fromCharCode(parseInt(hex.slice(j, j + 4), 16));
      }
    } else if (s.startsWith("\\X\\", i)) {
      out += String.fromCharCode(parseInt(s.slice(i + 3, i + 5), 16));
      i += 5;
    } else {
      out += s[i++];
    }
  }
  return out;
}

/** 요소 expressID → 소속 층 이름 (IfcRelContainedInSpatialStructure). */
function buildStoreyMap(api: IfcAPI, modelID: number): Map<number, string> {
  const map = new Map<number, string>();
  const RELS = api.GetLineIDsWithType(modelID, IFCRELCONTAINEDINSPATIALSTRUCTURE);
  for (let i = 0; i < RELS.size(); i++) {
    const rel = api.GetLine(modelID, RELS.get(i));
    const struct = rel.RelatingStructure;
    let name = "";
    try {
      const s = api.GetLine(modelID, struct.value);
      name = decodeIfcString(s.Name?.value ?? "");
    } catch {
      name = "";
    }
    const related = rel.RelatedElements ?? [];
    for (const r of related) {
      map.set(r.value, name);
    }
  }
  return map;
}

export interface ProcMeta {
  trade?: string;
  zone?: string;
  storey4d?: string;
  wt?: string;
  mtype?: string;
  unit?: string;
  phase?: string; // Lv.8 단계 (RB/FM/CN/IN)
}

/**
 * 요소 expressID → 공정 PSet 값 (REV IFC 의 Lv.2~Lv.7).
 * Lv.2 Trade=ST/MO, Lv.3 Zone=ZA.., Lv.4 Storey=01.., Lv.6 Unit, Lv.7 WorkType=CR/FT/MD.
 * 구버전 IFC(공정 PSet 없음)는 빈 맵 반환 → 매칭이 storey 방식으로 폴백.
 */
function buildProcMap(api: IfcAPI, modelID: number): Map<number, ProcMeta> {
  const map = new Map<number, ProcMeta>();
  const LV: Record<string, keyof ProcMeta> = {
    "Lv.2 Trade": "trade",
    "Lv.3 Zone": "zone",
    "Lv.4 Storey": "storey4d",
    "Lv.5 Type": "mtype",
    "Lv.6 Unit": "unit",
    "Lv.7 WorkType": "wt",
    "Lv.8 Phase": "phase",
  };
  const RELS = api.GetLineIDsWithType(modelID, IFCRELDEFINESBYPROPERTIES);
  for (let i = 0; i < RELS.size(); i++) {
    let rel: { RelatingPropertyDefinition?: { value: number }; RelatedObjects?: { value: number }[] };
    try {
      rel = api.GetLine(modelID, RELS.get(i));
    } catch {
      continue;
    }
    const pd = rel.RelatingPropertyDefinition;
    if (!pd) continue;
    let pset: { HasProperties?: { value: number }[] };
    try {
      pset = api.GetLine(modelID, pd.value);
    } catch {
      continue;
    }
    if (!pset.HasProperties) continue;
    const vals: ProcMeta = {};
    for (const ph of pset.HasProperties) {
      let p: { Name?: { value: string }; NominalValue?: { value: string } };
      try {
        p = api.GetLine(modelID, ph.value);
      } catch {
        continue;
      }
      const nm = p.Name?.value ?? "";
      const key = Object.keys(LV).find((k) => nm.startsWith(k));
      if (key && p.NominalValue) vals[LV[key]] = String(p.NominalValue.value);
    }
    if (!vals.zone && !vals.storey4d) continue;
    for (const o of rel.RelatedObjects ?? []) {
      map.set(o.value, { ...map.get(o.value), ...vals });
    }
  }
  return map;
}

/**
 * 철골 물량 추출 — PSet 의 '철골중량(t)'(중량) + '규격'(단면) + 'Lv.2 Trade'(공종)를
 * 요소별로 모아 규격/공종별 중량(t) 합산. 표준 IfcQuantity 없는 모델용.
 *   · 중량: 속성명이 "(t)" 로 끝나는 IFCREAL (한글 인코딩 무관, ASCII 접미사).
 *   · 규격: 속성명에 "규격" 포함 또는 값이 단면패턴(예 300x300x10x15).
 */
function extractSteelQto(api: IfcAPI, modelID: number): SteelQto[] {
  const perEl = new Map<number, { w?: number; spec?: string; trade?: string }>();
  const RELS = api.GetLineIDsWithType(modelID, IFCRELDEFINESBYPROPERTIES);
  const isSection = (v: string) => /^\s*\d+(\.\d+)?\s*[xX*]\s*\d+/.test(v);
  for (let i = 0; i < RELS.size(); i++) {
    let rel: { RelatingPropertyDefinition?: { value: number }; RelatedObjects?: { value: number }[] };
    try { rel = api.GetLine(modelID, RELS.get(i)); } catch { continue; }
    const pd = rel.RelatingPropertyDefinition;
    if (!pd) continue;
    let pset: { HasProperties?: { value: number }[] };
    try { pset = api.GetLine(modelID, pd.value); } catch { continue; }
    if (!pset.HasProperties) continue;

    let w: number | undefined;
    let spec: string | undefined;
    let trade: string | undefined;
    for (const ph of pset.HasProperties) {
      let p: { Name?: { value: string }; NominalValue?: { value: string | number } };
      try { p = api.GetLine(modelID, ph.value); } catch { continue; }
      const nm = p.Name?.value ?? "";
      const raw = p.NominalValue?.value;
      if (raw == null) continue;
      if (nm.endsWith("(t)")) { const n = Number(raw); if (Number.isFinite(n)) w = n; }
      else if (nm.includes("규격") || (typeof raw === "string" && isSection(raw))) spec = String(raw);
      else if (nm.startsWith("Lv.2 Trade")) trade = String(raw);
    }
    if (w == null && spec == null && trade == null) continue;
    for (const o of rel.RelatedObjects ?? []) {
      const cur = perEl.get(o.value) ?? {};
      if (w != null) cur.w = w;
      if (spec != null) cur.spec = spec;
      if (trade != null) cur.trade = trade;
      perEl.set(o.value, cur);
    }
  }

  const agg = new Map<string, { weightT: number; count: number }>();
  for (const e of perEl.values()) {
    if (e.w == null || e.w <= 0) continue;
    const key = e.spec || e.trade || "철골";
    const a = agg.get(key) ?? { weightT: 0, count: 0 };
    a.weightT += e.w;
    a.count += 1;
    agg.set(key, a);
  }
  return [...agg.entries()]
    .map(([group, a]) => ({ group, weightT: a.weightT, count: a.count }))
    .sort((x, y) => y.weightT - x.weightT);
}

/**
 * 요소 expressID → 정량물량 {vol㎥, area㎡} (IfcElementQuantity).
 * Revit 등이 내보낸 Qto_*BaseQuantities(NetVolume/NetArea)를 추출. 없으면 빈 맵 → bbox 폴백.
 */
function buildQtyMap(api: IfcAPI, modelID: number): Map<number, { vol?: number; area?: number }> {
  const map = new Map<number, { vol?: number; area?: number }>();
  const RELS = api.GetLineIDsWithType(modelID, IFCRELDEFINESBYPROPERTIES);
  for (let i = 0; i < RELS.size(); i++) {
    let rel: { RelatingPropertyDefinition?: { value: number }; RelatedObjects?: { value: number }[] };
    try {
      rel = api.GetLine(modelID, RELS.get(i));
    } catch {
      continue;
    }
    const pd = rel.RelatingPropertyDefinition;
    if (!pd) continue;
    let qset: { Quantities?: { value: number }[] };
    try {
      qset = api.GetLine(modelID, pd.value);
    } catch {
      continue;
    }
    if (!qset.Quantities) continue; // IfcElementQuantity 가 아니면(=PropertySet) 스킵
    let vol: number | undefined;
    let area: number | undefined;
    for (const qh of qset.Quantities) {
      let q: { Name?: { value: string }; VolumeValue?: { value: number }; AreaValue?: { value: number } };
      try {
        q = api.GetLine(modelID, qh.value);
      } catch {
        continue;
      }
      const nm = (q.Name?.value ?? "").toLowerCase();
      if (q.VolumeValue != null) {
        const val = Number(q.VolumeValue.value);
        if (Number.isFinite(val) && (nm.includes("net") || vol == null)) vol = val; // Net 우선
      } else if (q.AreaValue != null && !nm.includes("side") && !nm.includes("outer")) {
        const val = Number(q.AreaValue.value);
        if (Number.isFinite(val) && (nm.includes("net") || area == null)) area = val;
      }
    }
    if (vol == null && area == null) continue;
    for (const o of rel.RelatedObjects ?? []) {
      const cur = map.get(o.value) ?? {};
      map.set(o.value, { vol: vol ?? cur.vol, area: area ?? cur.area });
    }
  }
  return map;
}

// 구조·모듈(매칭 대상) + 건축 디테일(유리창·문·계단 등 — pmisx 수준 시각 정교함)
const WANTED_TYPES = new Set([
  "IFCWALL",
  "IFCWALLSTANDARDCASE",
  "IFCSLAB",
  "IFCBEAM",
  "IFCCOLUMN",
  "IFCFOOTING",
  "IFCBUILDINGELEMENTPROXY",
  "IFCCOVERING",
  "IFCRAILING",
  "IFCMEMBER",
  "IFCPLATE",
  // 건축 디테일
  "IFCWINDOW",
  "IFCDOOR",
  "IFCSTAIR",
  "IFCSTAIRFLIGHT",
  "IFCCURTAINWALL",
  "IFCFURNISHINGELEMENT",
  "IFCFLOWTERMINAL",
]);

function toPascalIfc(upper: string): string {
  // "IFCWALLSTANDARDCASE" → "IfcWallStandardCase" (match.ts classify 와 호환)
  const map: Record<string, string> = {
    IFCWALL: "IfcWall",
    IFCWALLSTANDARDCASE: "IfcWallStandardCase",
    IFCSLAB: "IfcSlab",
    IFCBEAM: "IfcBeam",
    IFCCOLUMN: "IfcColumn",
    IFCFOOTING: "IfcFooting",
    IFCBUILDINGELEMENTPROXY: "IfcBuildingElementProxy",
    IFCCOVERING: "IfcCovering",
    IFCRAILING: "IfcRailing",
    IFCMEMBER: "IfcMember",
    IFCPLATE: "IfcPlate",
    IFCWINDOW: "IfcWindow",
    IFCDOOR: "IfcDoor",
    IFCSTAIR: "IfcStair",
    IFCSTAIRFLIGHT: "IfcStairFlight",
    IFCCURTAINWALL: "IfcCurtainWall",
    IFCFURNISHINGELEMENT: "IfcFurnishingElement",
    IFCFLOWTERMINAL: "IfcFlowTerminal",
  };
  return map[upper] ?? upper;
}

/**
 * IFC ArrayBuffer → 파싱 결과.
 * onProgress: 0~1 진행률 콜백.
 */
export async function parseIfc(
  buffer: ArrayBuffer,
  onProgress?: (p: number, msg: string) => void,
  skipTrades?: Set<string>, // 이 trade(가설 TW 등)는 기하를 로드하지 않음 — 브라우저 메모리 절약(C-2)
): Promise<ParsedIfc> {
  const api = await getApi();
  // 단계 경계 yield — wasm 동기 구간(OpenModel/StreamAllMeshes) 사이에 브라우저가 페인트·입력을
  // 처리할 틈을 준다. 378MB 급에서 '응답 없는 페이지' 대화상자 완화(근본=Web Worker, 백로그).
  const breathe = () => new Promise<void>((r) => setTimeout(r, 0));
  onProgress?.(0.05, "모델 여는 중…");
  await breathe();
  const modelID = api.OpenModel(new Uint8Array(buffer));

  // 메타 맵 추출 — 하나가 실패해도(대형/비정상 IFC) 빈 맵으로 폴백, 지오메트리 파싱은 계속.
  const safeMap = <T>(fn: () => Map<number, T>): Map<number, T> => {
    try {
      return fn();
    } catch {
      return new Map<number, T>();
    }
  };
  await breathe();
  onProgress?.(0.15, "층 구조 분석 중…");
  const storeyMap = safeMap(() => buildStoreyMap(api, modelID));
  await breathe();
  onProgress?.(0.2, "공정 속성 분석 중…");
  const procMap = safeMap(() => buildProcMap(api, modelID));
  await breathe();
  onProgress?.(0.22, "정량물량(체적·면적) 분석 중…");
  const qtyMap = safeMap(() => buildQtyMap(api, modelID));
  const steelQto = (() => { try { return extractSteelQto(api, modelID); } catch { return []; } })();

  // ── 인스턴싱 누적 구조 ──
  // 유니크 지오메트리(geometryExpressID) → 그룹(빌더). 각 그룹은 로컬 정점/인덱스를 1회만 보관,
  // 인스턴스 행렬·소속 요소 index 를 누적한다. 동일 패밀리 수백 회 재사용 시 정점 복제 제거.
  interface GroupBuilder {
    g: number; // 그룹 index (groups 배열 위치)
    verts: Float32Array; // interleaved [px,py,pz,nx,ny,nz] — web-ifc 원본
    idx: Uint32Array; // 인덱스
    mats: number[]; // 인스턴스 행렬(16*n) 누적
    elemIdx: number[]; // 인스턴스별 소속 요소 index 누적
  }
  const groupMap = new Map<number, GroupBuilder>(); // geometryExpressID → builder
  const builders: GroupBuilder[] = [];
  const elements: ParsedElement[] = [];
  const skipped = new Set<string>(); // 기하 스킵된 trade(가설 등) 기록 — 패널이 '로드' 버튼 제공
  const tmp = new THREE.Matrix4();
  const v = new THREE.Vector3();
  // 전체 월드 bbox(모든 인스턴스 정점) — 바닥 높이·정합·framing 용.
  let wmnx = Infinity, wmny = Infinity, wmnz = Infinity, wmxx = -Infinity, wmxy = -Infinity, wmxz = -Infinity;

  await breathe();
  onProgress?.(0.25, "지오메트리 스트리밍 중… (대용량 IFC는 2~5분 — '응답 없음' 대화상자가 뜨면 [대기]를 눌러 주세요)");

  // 요소별 메타 캐시 (globalId/type/name) — GetLine 호출 최소화
  const metaCache = new Map<number, { globalId: string; ifcType: string; name: string } | null>();
  function meta(expressID: number) {
    if (metaCache.has(expressID)) return metaCache.get(expressID)!;
    let out: { globalId: string; ifcType: string; name: string } | null = null;
    try {
      const line = api.GetLine(modelID, expressID);
      const typeCode = api.GetLineType(modelID, expressID);
      const typeName = api.GetNameFromTypeCode(typeCode) as unknown as string;
      out = {
        globalId: line.GlobalId?.value ?? String(expressID),
        ifcType: toPascalIfc(String(typeName).toUpperCase()),
        // 부재 실제 이름(Revit 패밀리/타입 — "기본 벽_A_FIN_외장패널…" 같은 자재·부재명)
        name: line.Name?.value ?? "",
      };
    } catch {
      out = null;
    }
    metaCache.set(expressID, out);
    return out;
  }

  let count = 0;
  api.StreamAllMeshes(modelID, (flatMesh: any) => {
    const expressID = flatMesh.expressID;
    const m = meta(expressID);
    if (!m) return;
    if (!WANTED_TYPES.has(m.ifcType.toUpperCase())) return;

    // C-2: 숨김 기본 레이어(가설 TW 등)는 기하 로드 안 함 — 정점이 안 쌓여 브라우저 메모리 절약.
    // trade 만 기록(패널이 존재를 알고 '로드' 버튼 제공). 단일 메시 색칠/매칭 로직은 무영향(요소만 적어짐).
    if (skipTrades && skipTrades.size) {
      const pmEarly = procMap.get(expressID);
      if (pmEarly?.trade && skipTrades.has(pmEarly.trade)) {
        skipped.add(pmEarly.trade);
        return;
      }
    }

    // 이 요소의 인스턴스 참조와 월드 bbox(전체 placed geometry 누적)
    const elemIndex = elements.length;
    const inst: { g: number; i: number }[] = [];
    let rgba: [number, number, number, number] | undefined;   // IFC 원본 재질색(첫 유효 인스턴스)
    let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
    // 깨진/비정상 지오메트리(가설·토목 모델에 흔함)가 GetVertexArray 등에서 "Invalid array length"를
    // 던져 전체 파싱이 죽지 않도록 메시별 방어. 실패 시 이 메시만 스킵(누적은 push 전이라 롤백 불요).
    try {
      const placed = flatMesh.geometries;
      for (let i = 0; i < placed.size(); i++) {
        const pg = placed.get(i);
        const gid = pg.geometryExpressID as number;
        const mat = pg.flatTransformation as number[];
        if (!rgba) {   // 요소 대표색 = 첫 인스턴스 색. (1,1,1,1)=스타일 없음 기본값 → 미설정(팔레트 폴백)
          const c = pg.color as { x: number; y: number; z: number; w: number } | undefined;
          if (c && !(c.x === 1 && c.y === 1 && c.z === 1 && c.w === 1)) rgba = [c.x, c.y, c.z, c.w];
        }

        // 유니크 지오메트리: 처음 보는 gid 만 tessellate(로컬 좌표·법선 그대로 보관). 이후 재사용.
        let gb = groupMap.get(gid);
        if (!gb) {
          const geom = api.GetGeometry(modelID, gid);
          const verts = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
          const idx = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
          // web-ifc 가 내부적으로 소유한 메모리를 가리키므로 안전하게 복사본을 보관.
          gb = {
            g: builders.length,
            verts: new Float32Array(verts),
            idx: new Uint32Array(idx),
            mats: [],
            elemIdx: [],
          };
          groupMap.set(gid, gb);
          builders.push(gb);
        }

        // 인스턴스 슬롯 등록 — 행렬 + 소속 요소 index.
        const slot = gb.elemIdx.length;
        for (let j = 0; j < 16; j++) gb.mats.push(mat[j]);
        gb.elemIdx.push(elemIndex);
        inst.push({ g: gb.g, i: slot });

        // 월드 bbox 누적 — 로컬 정점에 flatTransformation 적용(기존 per-mesh 결과와 동일).
        // 인덱스가 아닌 유니크 정점을 직접 순회(같은 bbox, 중복 변환 제거).
        tmp.fromArray(mat);
        const verts = gb.verts;
        for (let b = 0; b < verts.length; b += 6) {
          v.set(verts[b], verts[b + 1], verts[b + 2]).applyMatrix4(tmp);
          if (v.x < mnx) mnx = v.x;
          if (v.x > mxx) mxx = v.x;
          if (v.y < mny) mny = v.y;
          if (v.y > mxy) mxy = v.y;
          if (v.z < mnz) mnz = v.z;
          if (v.z > mxz) mxz = v.z;
        }
      }
    } catch {
      // 이 메시의 일부 인스턴스가 이미 그룹에 push 됐을 수 있으나, 요소를 push 하지 않으면
      // elementIdx 가 가리킬 요소가 없어진다 → 안전을 위해 이 요소가 등록한 인스턴스를 롤백.
      for (const r of inst) {
        const gb = builders[r.g];
        gb.mats.length = r.i * 16;
        gb.elemIdx.length = r.i;
      }
      return; // 이 메시 스킵, 다음 메시 계속
    }
    if (inst.length > 0 && mnx !== Infinity) {
      // 전체 월드 bbox 갱신
      if (mnx < wmnx) wmnx = mnx;
      if (mxx > wmxx) wmxx = mxx;
      if (mny < wmny) wmny = mny;
      if (mxy > wmxy) wmxy = mxy;
      if (mnz < wmnz) wmnz = mnz;
      if (mxz > wmxz) wmxz = mxz;
      const pm = procMap.get(expressID);
      // 정량물량: **실제 IfcElementQuantity 만 신뢰.** bbox 체적은 비박스/대형 부재(토공·가설·굴착·proxy)에서
      // 실제의 수십~수백 배로 과대 → 물량 폭증·공기 왜곡. 없으면 undefined(=EA 로 gpt 상대 추정).
      const q = qtyMap.get(expressID);
      elements.push({
        globalId: m.globalId,
        expressID,
        ifcType: m.ifcType,
        name: m.name,
        storeyName: storeyMap.get(expressID) ?? null,
        inst,
        cx: (mnx + mxx) / 2,
        cy: (mny + mxy) / 2,
        cz: (mnz + mxz) / 2,
        volM3: q?.vol,
        areaM2: q?.area,
        trade: pm?.trade,
        zone: pm?.zone,
        // 공정 PSet(Lv.4) 없으면 IfcBuildingStorey 명("Level 2")에서 폴백 — 무PSet Revit/Tekla 4D 매칭(서버 _norm_storey 미러)
        storey4d: pm?.storey4d ?? normStorey(storeyMap.get(expressID)) ?? undefined,
        wt: pm?.wt,
        mtype: pm?.mtype,
        unit: pm?.unit,
        phase: pm?.phase,
        rgba,
      });
    }
    count++;
    if (count % 1000 === 0) onProgress?.(Math.min(0.9, 0.25 + count / 20000), `요소 ${count}개…`);
  });

  api.CloseModel(modelID);

  // ── elevation 보정 ──
  // BIM 의 PT(기초) 공정태그가 진짜 피트뿐 아니라 상부(2·3층 높이) 부재에도 붙어있어,
  // 그대로 매칭하면 높은 부재가 기초공정(최조기) 날짜를 받아 시공순서가 뒤집힌다.
  // → 숫자 층(01/02/03..)의 중앙 높이로 밴드를 만들고, PT 태그여도 물리적으로 높으면
  //   가장 가까운 층으로 재지정. 진짜 낮은 피트만 PT 유지.
  onProgress?.(0.91, "층 높이 보정 중…");
  {
    const tmp = new Map<string, number[]>();
    for (const el of elements) {
      if (el.storey4d && /^\d+$/.test(el.storey4d)) {
        (tmp.get(el.storey4d) ?? tmp.set(el.storey4d, []).get(el.storey4d)!).push(el.cy);
      }
    }
    const floors: { storey: string; y: number }[] = [];
    for (const [storey, ys] of tmp) {
      ys.sort((a, b) => a - b);
      floors.push({ storey, y: ys[Math.floor(ys.length / 2)] });
    }
    floors.sort((a, b) => a.y - b.y);
    if (floors.length) {
      const floor1Y = floors[0].y; // 최저 숫자층(통상 1층) 중앙 높이
      for (const el of elements) {
        // PT 태그인데 1층 높이 이상이면(진짜 피트는 1층보다 낮음) → 높이로 실제 층 보정
        if (el.storey4d === "PT" && el.cy > floor1Y - 1.5) {
          let best = floors[0].storey;
          let bd = Infinity;
          for (const f of floors) {
            const d = Math.abs(el.cy - f.y);
            if (d < bd) {
              bd = d;
              best = f.storey;
            }
          }
          el.storey4d = best;
          el.recalibrated = true;
        }
      }
    }
  }
  onProgress?.(0.92, "인스턴싱 그룹 구성 중…");

  // ── 빌더 → InstanceGroup[] ──
  // 각 유니크 지오메트리를 로컬 indexed BufferGeometry 로 만들고(정점/법선 분리 + 인덱스),
  // 인스턴스 행렬/요소 index 를 타입드 배열로 고정. 색은 뷰어가 instanceColor 로 입힌다.
  const groups: InstanceGroup[] = [];
  for (const gb of builders) {
    if (gb.elemIdx.length === 0) continue; // 인스턴스 없는 그룹(전부 롤백됨) 제외
    const nv = gb.verts.length / 6;
    const pos = new Float32Array(nv * 3);
    const nrm = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) {
      const b = i * 6;
      pos[i * 3] = gb.verts[b];
      pos[i * 3 + 1] = gb.verts[b + 1];
      pos[i * 3 + 2] = gb.verts[b + 2];
      nrm[i * 3] = gb.verts[b + 3];
      nrm[i * 3 + 1] = gb.verts[b + 4];
      nrm[i * 3 + 2] = gb.verts[b + 5];
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    geometry.setIndex(new THREE.BufferAttribute(gb.idx, 1));
    groups.push({
      geometry,
      matrices: new Float32Array(gb.mats),
      elementIdx: Int32Array.from(gb.elemIdx),
      count: gb.elemIdx.length,
    });
  }

  // ── 전체 bbox/center/radius — 스트림에서 누적한 월드 bbox 로 산출(병합 geometry 대체) ──
  const has = elements.length > 0 && wmnx !== Infinity;
  const bbox = has
    ? new THREE.Box3(new THREE.Vector3(wmnx, wmny, wmnz), new THREE.Vector3(wmxx, wmxy, wmxz))
    : new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
  const center = bbox.getCenter(new THREE.Vector3());
  // 기존 boundingSphere.radius 와 호환되게 대각선 절반(외접구 반지름)으로 산출.
  const radius = has ? bbox.getSize(new THREE.Vector3()).length() / 2 || 50 : 50;
  // ── 진단: BatchedMesh 1개로 렌더(draw call 1). 유니크형상=addGeometry 수, 인스턴스=배치 수. ──
  const totalInst = groups.reduce((s, g) => s + g.count, 0);
  const diag = `유니크형상 ${groups.length} · 인스턴스 ${totalInst} · 요소 ${elements.length}`;
  // eslint-disable-next-line no-console
  console.log("[4D]", diag, "(draw call 1)");
  onProgress?.(1, `완료 — ${diag}`);

  return {
    groups,
    elements,
    center,
    radius,
    bbox,
    steelQto: steelQto.length ? steelQto : undefined,
    skippedTrades: skipped.size ? [...skipped] : undefined,
  };
}

/**
 * 멀티 디시플린 IFC 통합 — 여러 ParsedIfc 를 **하나의 4D 씬**으로 병합(토목+구조+…).
 * 같은 프로젝트 export 라 좌표계 동일 가정(원점 공유) → 기하 그대로 합치면 공간 정합.
 *   · elements 는 단순 concat 하되 el.inst.g(그룹 index)를 그룹 오프셋만큼 이동.
 *   · groups 도 concat 하되 elementIdx(요소 index)를 요소 오프셋만큼 이동.
 *   · bbox/center/radius 는 합집합으로 재산출. skippedTrades/steelQto 합침.
 * FourDViewer 는 단일 ParsedIfc 만 받으면 되므로 뷰어 변경 없이 통합된다.
 */
export function mergeParsed(list: ParsedIfc[]): ParsedIfc {
  const valid = list.filter((p) => p && p.elements);
  if (valid.length <= 1) return valid[0] ?? list[0];
  const elements: ParsedElement[] = [];
  const groups: InstanceGroup[] = [];
  const bbox = new THREE.Box3();
  const skipped = new Set<string>();
  const steel: SteelQto[] = [];
  let elemOff = 0;
  let groupOff = 0;
  for (const p of valid) {
    for (const el of p.elements) {
      elements.push({ ...el, inst: el.inst.map((r) => ({ g: r.g + groupOff, i: r.i })) });
    }
    for (const g of p.groups) {
      const ei = new Int32Array(g.elementIdx.length);
      for (let k = 0; k < ei.length; k++) ei[k] = g.elementIdx[k] + elemOff;
      groups.push({ geometry: g.geometry, matrices: g.matrices, elementIdx: ei, count: g.count });
    }
    if (p.bbox && !p.bbox.isEmpty()) bbox.union(p.bbox);
    (p.skippedTrades ?? []).forEach((t) => skipped.add(t));
    (p.steelQto ?? []).forEach((q) => steel.push(q));
    elemOff += p.elements.length;
    groupOff += p.groups.length;
  }
  const has = !bbox.isEmpty();
  const center = has ? bbox.getCenter(new THREE.Vector3()) : new THREE.Vector3();
  const radius = has ? bbox.getSize(new THREE.Vector3()).length() / 2 || 50 : 50;
  return {
    groups, elements, center, radius, bbox,
    steelQto: steel.length ? steel : undefined,
    skippedTrades: skipped.size ? [...skipped] : undefined,
  };
}


/**
 * Worker 파싱 래퍼 — wasm 동기 구간을 Web Worker 로 격리(메인스레드 응답성 확보).
 * Worker 미지원/생성 실패 시 인라인 parseIfc 폴백(동작 동일, 응답성만 손해).
 */
export function parseIfcInWorker(
  buffer: ArrayBuffer,
  onProgress?: (p: number, msg: string) => void,
  skipTrades?: Set<string>,
): Promise<ParsedIfc> {
  if (typeof Worker === "undefined") return parseIfc(buffer, onProgress, skipTrades);
  return new Promise<ParsedIfc>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./ifc.worker.ts", import.meta.url));
    } catch {
      void parseIfc(buffer, onProgress, skipTrades).then(resolve, reject);
      return;
    }
    let settled = false;
    worker.onmessage = (e: MessageEvent) => {
      const d = e.data;
      if (d.type === "progress") onProgress?.(d.p, d.msg);
      else if (d.type === "done") { settled = true; worker.terminate(); resolve(deserializeParsed(d.parsed)); }
      else if (d.type === "error") { settled = true; worker.terminate(); reject(new Error(d.message)); }
    };
    worker.onerror = (ev) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      // Worker 로드 실패(번들 환경 차이 등) — 인라인 폴백. buffer 는 transfer 안 했으므로 사용 가능.
      console.warn("[ifc] worker 실패 — 인라인 파싱 폴백:", ev.message);
      void parseIfc(buffer, onProgress, skipTrades).then(resolve, reject);
    };
    // buffer 는 transfer 하지 않음(복사) — onerror 인라인 폴백에서 재사용해야 하므로.
    worker.postMessage({ buffer, skipTrades: skipTrades ? [...skipTrades] : undefined });
  });
}
