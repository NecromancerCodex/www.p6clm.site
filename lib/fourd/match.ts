/**
 * 4D 매칭 로직 — pmisx auto_allocate 규칙 이식 (CLM PoC).
 *
 * 검증: sample/M_502(M)동.ifc × sample/4D Simulation_ActID수정.xer 로
 * Python 동일 로직 93% 매칭 확인 (2026-06-01).
 *
 * XER Act ID_4D / task_code 포맷:  502HG{TRADE}{...}
 *   ST(구조): {ZONE2}{STOREY2}{WORKTYPE2}{PHASE2}   예: ZA PT FT RB
 *   MO(모듈): {ZONE2}{STOREY2}{MTYPE2}{UNIT2}MD{PHASE2}  예: ZA 01 36 01 MD IN
 *
 * 매칭 키: (storey, worktype) — zone 무시 폴백(IFC에 zone 약함).
 * 1 구조요소 = 3 활동(RB→FM→CN) → 요소 날짜범위 = min(start)~max(finish).
 */

export interface ScheduleTask {
  code: string; // activity_code (= 4D 코드)
  name?: string;
  start?: string | null; // ISO date
  end?: string | null;
  progress?: number;
  preds?: string[]; // 선행 활동명 (XER TASKPRED)
  succs?: string[]; // 후행 활동명
}

export type Trade = "ST" | "MO";

export interface DecodedCode {
  trade: Trade;
  zone: string;
  storey: string; // "PT" | "01".."12" | "RF"
  worktype?: string; // ST: FT/CR/PR
  mtype?: string; // MO
  unit?: string; // MO
  phase: string; // RB/FM/CN/IN
}

/** 502HG... 코드 디코드. 형식 불일치 시 null. */
export function decodeActId(code: string): DecodedCode | null {
  // 범용 4D 포맷 (생성기 산출): 4D.{ST|MO}.{zone}.{storey}.{op}.{phase}.{seq}
  const clean = /^4D\.(ST|MO)\.([^.]+)\.([^.]+)\.([^.]+)\.([^.]*)/.exec(code.trim());
  if (clean) {
    const [, trade, zone, storey, op, phase] = clean;
    return { trade: trade as Trade, zone, storey, worktype: op, mtype: op, phase: phase || "" };
  }
  const m = /^502HG(ST|MO)(.+)$/.exec(code.trim());
  if (!m) return null;
  const trade = m[1] as Trade;
  const rest = m[2];
  if (trade === "ST" && rest.length >= 8) {
    return {
      trade,
      zone: rest.slice(0, 2),
      storey: rest.slice(2, 4),
      worktype: rest.slice(4, 6),
      phase: rest.slice(6, 8),
    };
  }
  if (trade === "MO" && rest.length >= 4) {
    return {
      trade,
      zone: rest.slice(0, 2),
      storey: rest.slice(2, 4),
      mtype: rest.slice(4, 6),
      unit: rest.slice(6, 8),
      phase: rest.slice(-2),
    };
  }
  return null;
}

/** IFC 요소 분류 → 매칭 카테고리. */
export type Category = "CORE" | "FOOT" | "MOD";

// 보편 부재명 어휘(한/영) — 애매하게 모델링된 ifcType(예 매트기초를 IfcSlab으로) 을 이름으로 교정.
// 특정 공정 전용이 아니라 전 부재 범용. 프로젝트 키워드 아님.
const _NM_FOOT = /기초|footing|매트|foundation|푸팅|지정|mat\b/i;
const _NM_CORE = /벽|wall|기둥|column|코어|core|옹벽|pier|shear/i;

export function classifyIfcType(ifcType: string, name?: string): Category {
  // 1. 명확한 ifcType 은 그대로 신뢰
  if (ifcType === "IfcFooting" || ifcType === "IfcPile") return "FOOT";
  if (ifcType === "IfcWall" || ifcType === "IfcWallStandardCase" || ifcType === "IfcColumn")
    return "CORE";
  if (ifcType === "IfcBeam") return "MOD";
  // 2. 애매한 ifcType(IfcSlab/Member/Plate/Proxy/Covering 등) → 이름으로 교정
  const n = name || "";
  if (_NM_FOOT.test(n)) return "FOOT";
  if (_NM_CORE.test(n)) return "CORE";
  return "MOD"; // Slab/바닥/기타 → 수평·층모듈
}

/** IFC IfcBuildingStorey.Name → XER storey 코드. */
export function normStorey(storeyName: string | null | undefined): string | null {
  if (!storeyName) return null;
  const s = storeyName;
  // 주차장지붕 등은 포디움/별도 구조 — 건물 RF(파라펫, 공정 끝)에 자동 귀속하면
  // 시공순서가 틀어진다. 전용 공정이 없으므로 미매칭 → 정책(AI)이 판단하게 둔다.
  if (s.includes("주차장")) return null;
  const m = /_(\d+)\s*층/.exec(s) || /(\d+)\s*F/i.exec(s);
  if (m) return m[1].padStart(2, "0");
  const u = s.toUpperCase();
  if (s.includes("지붕") || s.includes("오탑") || s.includes("파라펫") || /\bRF\b/.test(u))
    return "RF";
  if (u.includes("PIT") || s.includes("기초") || s.includes("지정") || s.includes("지하"))
    return "PT";
  // 인식 못 한 층(예: 영문 "Level 1", 임의 표기)은 원본 보존 — 502동 외 범용 BIM 매칭용.
  // (공정표 생성기도 같은 원본 storey 를 코드에 쓰므로 양쪽 표기가 일치 → 매칭됨)
  return s.trim() || null;
}

/**
 * 층 표기 정규형 — 매칭/정렬용. 스케줄("8F"·"B5F")과 BIM("Level 8"·"지하5층") 의 다른 표기를 통일.
 *  "8F"·"Level 8"·"08"·"8층"→"8", "B5F"·"지하5"→"B5", RF/PH/PHR, "PT"(피트)는 보존.
 */
export function canonStorey(s: string | null | undefined): string | null {
  if (!s) return null;
  const u = String(s).trim().toUpperCase();
  if (!u) return null;
  if (/PHR|PH\s*R/.test(u)) return "PHR";
  if (/\bPH/.test(u) || u.includes("펜트")) return "PH";
  if (/\bRF\b|ROOF|지붕|옥탑|옥상/.test(u)) return "RF";
  let m = /\bB\s*0*(\d+)/.exec(u) || /지하\s*0*(\d+)/.exec(u);
  if (m) return "B" + m[1]; // 지하 — 지상층과 구분 (B5≠5F)
  m =
    /(\d+)\s*F\b/.exec(u) ||
    /LEVEL\s*0*(\d+)/.exec(u) ||
    /(\d+)\s*층/.exec(u) ||
    /\bF\s*0*(\d+)/.exec(u) ||
    /^0*(\d+)$/.exec(u);
  if (m) return m[1];
  return u; // PT 등 미인식은 원형 보존
}

interface DateRange {
  start: number; // epoch ms
  end: number;
}

/** 스케줄 인덱스 — (storey,worktype)별 집계 날짜범위. */
export interface ScheduleIndex {
  crByStorey: Map<string, DateRange>; // 코어벽/기둥
  ftStoreys: Map<string, DateRange>; // 기초
  prStoreys: Map<string, DateRange>; // 파라펫
  moByStorey: Map<string, DateRange>; // 모듈설치
  minDate: number;
  maxDate: number;
}

function merge(m: Map<string, DateRange>, key: string, s: number, e: number) {
  const cur = m.get(key);
  if (!cur) m.set(key, { start: s, end: e });
  else m.set(key, { start: Math.min(cur.start, s), end: Math.max(cur.end, e) });
}

/** CLM /schedule/upload tasks → 매칭 인덱스. */
export function buildScheduleIndex(tasks: ScheduleTask[]): ScheduleIndex {
  const cr = new Map<string, DateRange>();
  const ft = new Map<string, DateRange>();
  const pr = new Map<string, DateRange>();
  const mo = new Map<string, DateRange>();
  let minD = Infinity;
  let maxD = -Infinity;
  for (const t of tasks) {
    const d = decodeActId(t.code);
    if (!d) continue;
    const s = t.start ? Date.parse(t.start) : NaN;
    const e = t.end ? Date.parse(t.end) : NaN;
    if (Number.isNaN(s) || Number.isNaN(e)) continue;
    minD = Math.min(minD, s);
    maxD = Math.max(maxD, e);
    const st = canonStorey(d.storey) || d.storey; // 스케줄 층 정규화 (BIM 층과 통일)
    if (d.trade === "MO") {
      merge(mo, st, s, e);
    } else if (d.worktype === "FT") {
      merge(ft, st, s, e);
    } else if (d.worktype === "PR") {
      merge(pr, st, s, e);
    } else if (d.worktype === "CR") {
      merge(cr, st, s, e);
    }
  }
  return {
    crByStorey: cr,
    ftStoreys: ft,
    prStoreys: pr,
    moByStorey: mo,
    minDate: minD === Infinity ? Date.now() : minD,
    maxDate: maxD === -Infinity ? Date.now() : maxD,
  };
}

export interface IfcElementMeta {
  globalId: string;
  expressID: number;
  ifcType: string;
  name?: string; // 부재 실제 이름 (Revit 패밀리/타입 — "기본 벽_외장패널…")
  storeyName: string | null;
}

export interface MatchResult {
  range: DateRange | null; // null = 미매칭
  via: string; // 매칭 경로/그룹 키 (코드매칭: "ST|ZA|03|CR")
}

// ─────────────────────────────────────────────────────────────────────────────
// 코드 기반 매칭 (REV IFC 공정 PSet) — 부재의 (trade·zone·storey·worktype) 로
// XER 4D 코드와 직접 매칭. zone 정확. storey 근사 매칭(matchElement)보다 정밀.
// ─────────────────────────────────────────────────────────────────────────────

export interface ProcElement {
  globalId: string;
  trade?: string;
  zone?: string;
  storey4d?: string;
  wt?: string;
  mtype?: string;
  unit?: string;
  phase?: string;
  disc?: string; // 공종(토목/구조/가설…) — 슬롯 임포트 시 확정(파일 단위). PSet trade 없어도 매칭 라우팅.
}

export interface CodeIndex {
  byKey: Map<string, DateRange>; // 거친 키: ST|zone|storey|wt, MO|zone|storey|MD (집계)
  byUnit: Map<string, DateRange>; // 유닛 키: MO|zone|storey|mtype|unit (세분 — pmisx 식 모듈단위)
  byPhase: Map<string, DateRange>; // 단계 키: ST|zone|storey|wt|phase (단계별 — 콘크리트 등)
  byZoneCat: Map<string, DateRange>; // 구역+카테고리: zone|storey|CORE|MOD|FOOT (trade/wt 코드 불일치 흡수)
  byStorey: Map<string, DateRange>; // 층(canonStorey)별 골조 window — 가설(TW) 층 추종용(zone 무관)
  earthworkWindow: DateRange | null; // 토공(흙막이/굴착/차수) 공통활동 기간 — 토목(CV) 매칭용
  minDate: number;
  maxDate: number;
}

// 토공 공통 활동(4D 코드 없음 — 공통)을 이름으로 식별. 토목(CV) 부재가 이 기간에 매칭됨.
const _EARTHWORK_KW = /흙막이|토공|굴착|터파기|차수|되메우|버림|토류|가시설|파일|말뚝/;
// 되메우기·성토는 골조 후행(post) — 흙막이 부재 window 에서 제외(안 그러면 흙막이가 골조 끝까지 진행중).
const _BACKFILL_KW = /되메우|성토|복구/;

// 스케줄 op(CR/MD/FT/PR) → 부재 카테고리. BIM 부재(classifyIfcType)와 같은 축으로 통일해
// trade(ST/MO)·wt(WAL/SLB/COL) 코드 차이를 무시하고 구역 단위 매칭을 살린다.
function opToCat(op: string): Category {
  const o = (op || "").toUpperCase();
  if (o === "FT" || o.startsWith("FOO") || o.startsWith("PILE")) return "FOOT";
  if (o === "CR" || o.startsWith("COR") || o.startsWith("WAL") || o.startsWith("COL")) return "CORE";
  return "MOD"; // MD/PR/SLB/BEA 등 수평·모듈
}
const zoneCatKey = (zone: string, storey: string, cat: Category) =>
  `${zone}|${canonStorey(storey) || storey}|${cat}`;

// storey 는 canonStorey 로 정규화해 키 생성 — 스케줄("8F")/BIM("Level 8") 표기 차이 흡수.
const codeKey = (trade: string, zone: string, storey: string, wt: string) =>
  `${trade}|${zone}|${canonStorey(storey) || storey}|${wt}`;
// 유닛 키 — 모듈 번호(unit)로만. 4D 코드의 type 필드(36/46)는 스케줄 내부코드라
// BIM 실제 타입과 어긋난다(ZC 코드=46 ↔ BIM=36, 활동명은 둘 다 "36Type"). 그래서 제외.
// pmisx 도 활동명의 모듈 번호로 매칭한다.
const unitKey = (zone: string, storey: string, unit: string) =>
  `MO|${zone}|${canonStorey(storey) || storey}|${unit}`;
const phaseKey = (zone: string, storey: string, wt: string, phase: string) =>
  `ST|${zone}|${canonStorey(storey) || storey}|${wt}|${phase}`;

function mergeRange(m: Map<string, DateRange>, key: string, s: number, e: number) {
  const cur = m.get(key);
  if (!cur) m.set(key, { start: s, end: e });
  else m.set(key, { start: Math.min(cur.start, s), end: Math.max(cur.end, e) });
}

/**
 * XER tasks → 2단계 인덱스.
 *  byKey  : ST|zone|storey|wt, MO|zone|storey|MD (거친 집계 — 폴백)
 *  byUnit : MO|zone|storey|mtype|unit (유닛 세분 — 모듈 개별 색칠)
 */
export function buildCodeIndex(tasks: ScheduleTask[]): CodeIndex {
  const byKey = new Map<string, DateRange>();
  const byUnit = new Map<string, DateRange>();
  const byPhase = new Map<string, DateRange>();
  const byZoneCat = new Map<string, DateRange>();
  const byStorey = new Map<string, DateRange>();
  let ewStart = Infinity;
  let ewEnd = -Infinity;
  let minD = Infinity;
  let maxD = -Infinity;
  for (const t of tasks) {
    const s = t.start ? Date.parse(t.start) : NaN;
    const e = t.end ? Date.parse(t.end) : NaN;
    if (Number.isNaN(s) || Number.isNaN(e)) continue;
    // 토공 공통활동(4D 코드 없음) — 이름으로 식별해 earthwork window 누적 (토목 부재 매칭용).
    // 되메우기/성토(골조 후행)는 제외 — 흙막이·굴착(굴착 단계)까지만 → 토목 부재가 골조 전 완료.
    if (_EARTHWORK_KW.test(t.name || "") && !_BACKFILL_KW.test(t.name || "")) {
      ewStart = Math.min(ewStart, s);
      ewEnd = Math.max(ewEnd, e);
      minD = Math.min(minD, s);
      maxD = Math.max(maxD, e);
    }
    const d = decodeActId(t.code);
    if (!d) continue;
    minD = Math.min(minD, s);
    maxD = Math.max(maxD, e);
    // 층(canonStorey)별 골조 window — 가설(TW)이 zone 체계 달라도 층 기준 골조 추종 (zone 무관 키)
    mergeRange(byStorey, canonStorey(d.storey) || d.storey, s, e);
    if (d.trade === "MO") {
      mergeRange(byKey, codeKey("MO", d.zone, d.storey, "MD"), s, e);
      if (d.unit) mergeRange(byUnit, unitKey(d.zone, d.storey, d.unit), s, e);
      mergeRange(byZoneCat, zoneCatKey(d.zone, d.storey, "MOD"), s, e);
    } else {
      const wt = d.worktype ?? "";
      mergeRange(byKey, codeKey("ST", d.zone, d.storey, wt), s, e);
      if (d.phase) mergeRange(byPhase, phaseKey(d.zone, d.storey, wt, d.phase), s, e);
      mergeRange(byZoneCat, zoneCatKey(d.zone, d.storey, opToCat(wt)), s, e);
    }
  }
  return {
    byKey,
    byUnit,
    byPhase,
    byZoneCat,
    byStorey,
    earthworkWindow: ewStart === Infinity ? null : { start: ewStart, end: ewEnd },
    minDate: minD === Infinity ? Date.now() : minD,
    maxDate: maxD === -Infinity ? Date.now() : maxD,
  };
}

/**
 * PC·모듈러 호(unit) 단위 4D 순차 전개 (Stage 2, Option A — 타워 무손상).
 *
 * 스케줄은 셀(존×층) 단위 그대로(검증된 32셀 불변). 4D 뷰어만, 한 MD 셀 윈도우[start,end] 안에서
 * 그 셀의 모듈(호)들을 호 번호 순으로 균등 분배해 byUnit 을 채운다 → 모듈이 하나씩 거치되는 시각.
 *
 * 격리(3중): ① 백엔드 is_modular(req) ② trade==="MO" ③ **el.unit 존재**.
 *   타워 BIM 엔 Lv.6 Unit(호) PSet 자체가 없어 el.unit 이 undefined → 이 함수가 byUnit 을
 *   단 한 건도 만들지 않는다(cellUnits 가 빔). ST 경로·matchByCode·스케줄 모두 불변.
 *
 * idx 를 제자리 변형(byUnit 채움). buildCodeIndex 직후·matchAll* 전에 1회 호출.
 */
export function expandModularUnits(elements: ProcElement[], idx: CodeIndex): void {
  // ① 셀별 호 집합 — MO + 호 부재만(타워는 el.unit 없어 진입 불가). 매칭될 MD 셀 활동이 있을 때만.
  const cellUnits = new Map<string, Set<string>>(); // codeKey(MO,zone,storey,MD) → {padded unit}
  for (const el of elements) {
    if (el.trade !== "MO" || !el.unit || !el.zone || !el.storey4d) continue;
    const ck = codeKey("MO", el.zone, el.storey4d, "MD");
    if (!idx.byKey.has(ck)) continue; // 셀 활동 없으면 분배 대상 아님
    let set = cellUnits.get(ck);
    if (!set) cellUnits.set(ck, (set = new Set()));
    set.add(el.unit.padStart(2, "0"));
  }
  // ② 셀 윈도우를 호 순서대로 균등 분배 → byUnit (matchByCode 의 el.unit 분기가 소비)
  for (const [ck, units] of cellUnits) {
    if (units.size <= 1) continue; // 호 1개면 셀 그대로(분배 의미 없음)
    const cell = idx.byKey.get(ck)!;
    const [, zone, storey] = ck.split("|"); // "MO|zone|storey|MD" (storey 는 이미 canonStorey)
    const sorted = [...units].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
    const n = sorted.length;
    const span = cell.end - cell.start;
    sorted.forEach((u, i) => {
      idx.byUnit.set(unitKey(zone, storey, u), {
        start: cell.start + Math.round((span * i) / n),
        end: cell.start + Math.round((span * (i + 1)) / n),
      });
    });
  }
}

export interface Candidate {
  key: string; // trade|zone|storey|wt
  name: string; // 한글 활동명 (LLM 의미매칭 신호)
  zone?: string;
  storey?: string;
  wt?: string;
}

/** XER tasks → 후보 활동(키별 대표 활동명). 정책매칭 LLM 입력용. */
export function buildCandidates(tasks: ScheduleTask[]): Candidate[] {
  const map = new Map<string, Candidate>();
  for (const t of tasks) {
    const d = decodeActId(t.code);
    if (!d) continue;
    const wt = d.trade === "MO" ? "MD" : (d.worktype ?? "");
    const key = codeKey(d.trade, d.zone, d.storey, wt);
    if (!map.has(key)) {
      map.set(key, { key, name: t.name || key, zone: d.zone, storey: d.storey, wt });
    }
  }
  return [...map.values()];
}

/**
 * 단일 요소 코드 매칭 — 유닛 키 우선(세분) → 거친 키 폴백.
 *  MO 부재: MO|zone|storey|mtype|pad(unit) → 없으면 MO|zone|storey|MD
 *  ST 부재: ST|zone|storey|wt
 */
export function matchByCode(el: ProcElement, idx: CodeIndex): MatchResult {
  // 토목 — 토공 window(굴착·흙막이 기간, 골조 전). 공종 확정 출처 2가지:
  //   ① 슬롯 임포트(el.disc==="토목") — PSet trade 없는 토목.ifc 도 슬롯이 공종 확정(추측 0)
  //   ② PSet Lv.2 Trade=CV — 태그된 모델
  // → 둘 중 하나면 토목으로 라우팅(구조 골조 폴백 방지 = 흙막이가 지하벽보다 먼저 표시).
  if (el.disc === "토목" || el.trade === "CV") {
    return idx.earthworkWindow
      ? { range: idx.earthworkWindow, via: "earthwork:토목" }
      : { range: null, via: "no_earthwork" };
  }
  // 가설(TW) → 층별 골조 추종 (비계·동바리가 각 층 시공 시 등장). zone 체계 달라도 storey 기준.
  if (el.trade === "TW") {
    const k = el.storey4d ? canonStorey(el.storey4d) || el.storey4d : "";
    const r = k ? idx.byStorey.get(k) : undefined;
    if (r) return { range: r, via: `tw_storey:${k}` };
    return idx.earthworkWindow
      ? { range: idx.earthworkWindow, via: "tw_earthwork" }
      : { range: null, via: `no_storey:${k}` };
  }
  if (!el.trade || !el.zone || !el.storey4d) return { range: null, via: "no_meta" };
  if (el.trade === "MO") {
    if (el.unit) {
      const uk = unitKey(el.zone, el.storey4d, el.unit.padStart(2, "0"));
      const ru = idx.byUnit.get(uk);
      if (ru) return { range: ru, via: uk }; // 유닛 단위 (세분)
    }
    const ck = codeKey("MO", el.zone, el.storey4d, "MD");
    const rc = idx.byKey.get(ck);
    return rc ? { range: rc, via: ck } : { range: null, via: `no_act:${ck}` };
  }
  // ST: 단계(phase) 키 우선 → 콘크리트 등 단계별 정확 날짜. 없으면 집계 폴백.
  const wt = el.wt || "";
  if (el.phase) {
    const pk = phaseKey(el.zone, el.storey4d, wt, el.phase);
    const rp = idx.byPhase.get(pk);
    if (rp) return { range: rp, via: pk };
  }
  const key = codeKey("ST", el.zone, el.storey4d, wt);
  const r = idx.byKey.get(key);
  return r ? { range: r, via: key } : { range: null, via: `no_act:${key}` };
}

/** 전체 코드 매칭 + 요약. */
export function matchAllByCode(
  elements: (IfcElementMeta & ProcElement)[],
  idx: CodeIndex,
): { ranges: Map<string, MatchResult>; summary: MatchSummary } {
  const ranges = new Map<string, MatchResult>();
  const byVia: Record<string, number> = {};
  let matched = 0;
  for (const el of elements) {
    const r = matchByCode(el, idx);
    ranges.set(el.globalId, r);
    if (r.range) matched++;
    const viaTag = r.via.startsWith("no") ? r.via.split(":")[0] : "matched";
    byVia[viaTag] = (byVia[viaTag] ?? 0) + 1;
  }
  return { ranges, summary: { total: elements.length, matched, byVia } };
}

/**
 * 계층적 확실성 매칭 — 추측 없이 확실한 것만.
 *  1순위: 공정 PSet 있으면 코드(zone) 정확 매칭 (최소 공정단위)
 *  2순위: 없으면 IfcBuildingStorey + 부재타입 → 층 단위 규칙 매칭 (구역 미상)
 *  안 되면 미매칭(회색).
 */
export function matchAllHybrid(
  elements: (IfcElementMeta & ProcElement)[],
  codeIdx: CodeIndex,
  storeyIdx: ScheduleIndex,
): { ranges: Map<string, MatchResult>; summary: MatchSummary } {
  const ranges = new Map<string, MatchResult>();
  const byVia: Record<string, number> = {};
  let matched = 0;
  for (const el of elements) {
    let r = matchByCode(el, codeIdx);
    // 토목/가설 부재는 구조 폴백 금지 — 토목 활동(earthwork)에 못 붙었으면 미매칭(회색)으로 둔다.
    // (흙막이가 같은 층 구조 코어·골조로 잘못 매칭돼 "지하벽보다 늦게" 보이던 문제 차단)
    const nonStruct = el.disc === "토목" || el.disc === "가설" || el.trade === "CV" || el.trade === "TW";
    // 1차 폴백 — 구역+카테고리(trade/wt 코드 불일치 흡수, 구역은 유지). 슬래브 trade=ST↔스케줄 MO,
    // 벽 wt=WAL↔스케줄 CR 처럼 코드가 어긋나도 구역·층·부재종류로 제 구역에 정확 매칭(구역 미상 방지).
    if (!r.range && !nonStruct && el.zone && el.storey4d) {
      const zck = zoneCatKey(el.zone, el.storey4d, classifyIfcType(el.ifcType, el.name));
      const rz = codeIdx.byZoneCat.get(zck);
      if (rz) r = { range: rz, via: zck };
    }
    // 2차 폴백 — 층 단위(zone 무시). 구역도 없을 때만. 토목/가설은 구조 폴백 제외(위 nonStruct).
    if (!r.range && !nonStruct) {
      const fb = matchElement(el, storeyIdx);
      if (fb.range) r = fb;
    }
    ranges.set(el.globalId, r);
    if (r.range) matched++;
    const tag = r.range
      ? r.via.includes("|")
        ? "구역정확"
        : "층단위"
      : r.via.startsWith("no")
        ? r.via.split(/[:@]/)[0]
        : r.via;
    byVia[tag] = (byVia[tag] ?? 0) + 1;
  }
  return { ranges, summary: { total: elements.length, matched, byVia } };
}

/** 단일 요소 매칭 — (storey, category) → 스케줄 날짜범위. zone 무시 폴백. */
export function matchElement(el: IfcElementMeta & Partial<ProcElement>, idx: ScheduleIndex): MatchResult {
  // storey4d(PSet) 우선, 없으면 storeyName. canonStorey 로 스케줄 키와 통일.
  const ns = canonStorey(el.storey4d ?? el.storeyName);
  if (!ns) return { range: null, via: "no_storey" };
  const cat = classifyIfcType(el.ifcType, el.name);

  if (cat === "FOOT") {
    const r = idx.ftStoreys.get(ns) || idx.ftStoreys.get("PT");
    return r ? { range: r, via: `FT@${ns}` } : { range: null, via: `no_act@${ns}` };
  }
  if (cat === "CORE") {
    const r = idx.crByStorey.get(ns) || idx.moByStorey.get(ns);
    return r
      ? { range: r, via: idx.crByStorey.has(ns) ? `CR@${ns}` : `MO@${ns}` }
      : { range: null, via: `no_act@${ns}` };
  }
  // MOD → 층 모듈 우선, 폴백 CR/PR
  const r = idx.moByStorey.get(ns) || idx.crByStorey.get(ns) || idx.prStoreys.get(ns);
  return r ? { range: r, via: `MO@${ns}` } : { range: null, via: `no_act@${ns}` };
}

/** 4D 상태: 0 미착수 / 1 진행중 / 2 완료. use4DSchedule.js 로직. */
export function statusAt(dateMs: number, range: DateRange | null): 0 | 1 | 2 | -1 {
  if (!range) return -1; // 미매칭 (ghost)
  if (dateMs >= range.end) return 2;
  if (dateMs >= range.start) return 1;
  return 0;
}

export interface MatchSummary {
  total: number;
  matched: number;
  byVia: Record<string, number>;
}

/** 전체 요소 매칭 + 요약. */
export function matchAll(
  elements: IfcElementMeta[],
  idx: ScheduleIndex,
): { ranges: Map<string, MatchResult>; summary: MatchSummary } {
  const ranges = new Map<string, MatchResult>();
  const byVia: Record<string, number> = {};
  let matched = 0;
  for (const el of elements) {
    const r = matchElement(el, idx);
    ranges.set(el.globalId, r);
    if (r.range) matched++;
    byVia[r.via] = (byVia[r.via] ?? 0) + 1;
  }
  return { ranges, summary: { total: elements.length, matched, byVia } };
}
