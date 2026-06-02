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

export function classifyIfcType(ifcType: string): Category {
  if (ifcType === "IfcFooting") return "FOOT";
  if (ifcType === "IfcWall" || ifcType === "IfcWallStandardCase" || ifcType === "IfcColumn")
    return "CORE";
  return "MOD"; // Slab/Beam/Proxy/Covering/Railing/Member/Plate ... → 층 모듈 귀속
}

/** IFC IfcBuildingStorey.Name → XER storey 코드. */
export function normStorey(storeyName: string | null | undefined): string | null {
  if (!storeyName) return null;
  const m = /_(\d+)\s*층/.exec(storeyName) || /(\d+)\s*F/i.exec(storeyName);
  if (m) return m[1].padStart(2, "0");
  const s = storeyName;
  const u = s.toUpperCase();
  if (s.includes("지붕") || s.includes("오탑") || s.includes("파라펫") || /\bRF\b/.test(u))
    return "RF";
  if (u.includes("PIT") || s.includes("기초") || s.includes("지정") || s.includes("지하"))
    return "PT";
  return null;
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
    if (d.trade === "MO") {
      merge(mo, d.storey, s, e);
    } else if (d.worktype === "FT") {
      merge(ft, d.storey, s, e);
    } else if (d.worktype === "PR") {
      merge(pr, d.storey, s, e);
    } else if (d.worktype === "CR") {
      merge(cr, d.storey, s, e);
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
}

export interface CodeIndex {
  byKey: Map<string, DateRange>;
  minDate: number;
  maxDate: number;
}

const codeKey = (trade: string, zone: string, storey: string, wt: string) =>
  `${trade}|${zone}|${storey}|${wt}`;

/** XER tasks → (trade|zone|storey|wt) 별 집계 날짜범위. MO 의 wt 는 항상 MD. */
export function buildCodeIndex(tasks: ScheduleTask[]): CodeIndex {
  const byKey = new Map<string, DateRange>();
  let minD = Infinity;
  let maxD = -Infinity;
  for (const t of tasks) {
    const d = decodeActId(t.code);
    if (!d) continue;
    const wt = d.trade === "MO" ? "MD" : (d.worktype ?? "");
    const key = codeKey(d.trade, d.zone, d.storey, wt);
    const s = t.start ? Date.parse(t.start) : NaN;
    const e = t.end ? Date.parse(t.end) : NaN;
    if (Number.isNaN(s) || Number.isNaN(e)) continue;
    minD = Math.min(minD, s);
    maxD = Math.max(maxD, e);
    const cur = byKey.get(key);
    if (!cur) byKey.set(key, { start: s, end: e });
    else byKey.set(key, { start: Math.min(cur.start, s), end: Math.max(cur.end, e) });
  }
  return {
    byKey,
    minDate: minD === Infinity ? Date.now() : minD,
    maxDate: maxD === -Infinity ? Date.now() : maxD,
  };
}

/** 단일 요소 코드 매칭 — 공정 PSet 키로 직접 조회. */
export function matchByCode(el: ProcElement, idx: CodeIndex): MatchResult {
  if (!el.trade || !el.zone || !el.storey4d) return { range: null, via: "no_meta" };
  const wt = el.wt || (el.trade === "MO" ? "MD" : "");
  const key = codeKey(el.trade, el.zone, el.storey4d, wt);
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
    if (r.via === "no_meta") r = matchElement(el, storeyIdx); // 공정 PSet 없음 → 층 폴백
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
export function matchElement(el: IfcElementMeta, idx: ScheduleIndex): MatchResult {
  const ns = normStorey(el.storeyName);
  if (!ns) return { range: null, via: "no_storey" };
  const cat = classifyIfcType(el.ifcType);

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
