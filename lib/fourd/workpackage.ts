/**
 * 워크패키지 도출 — BIM 부재 메타(호·타입·부재종류) 기준 세분.
 *
 * pmisx 처럼 모듈별·악세사리(IfcType)별로 쪼갠다. 매칭 via(공정 키)로 묶지 않고
 * 부재 자신의 메타(zone·storey·unit·mtype / wt)로 패키지를 만든다.
 *  → ZC 처럼 공정표가 거칠게 코딩돼 1,230개가 한 키로 떨어져도, 물리 분해는 호/타입별로 세밀.
 *
 * 패키지(물리) 1 : N 워크유닛(Primavera 공정활동). 공정 날짜는 활동에서 공유.
 * 부재는 매칭 출처(rule/ai/storey)별로 카운트 → "pmisx 정밀 + AI 보강" 가시화.
 */
import { decodeActId, normStorey, canonStorey, classifyIfcType, type DecodedCode, type ScheduleTask } from "./match";
import type { ParsedElement } from "./ifc";

export interface DerivedUnit {
  activity_code: string | null;
  name: string | null;
  phase: string | null;
  match_source: "rule" | "ai" | "storey" | "none";
  confidence: number | null;
  start: string | null;
  end: string | null;
}

export interface AccessoryCount {
  type: string; // IfcType 약칭 (Wall/Covering/Slab…)
  count: number;
}

export interface DerivedPackage {
  key: string;
  trade: string | null;
  zone: string | null;
  storey: string | null;
  worktype: string | null;
  module_unit: string | null;
  mtype: string | null;
  bim_count_rule: number;
  bim_count_ai: number;
  bim_count_storey: number;
  global_ids: string[];
  accessories: AccessoryCount[];
  start: string | null;
  end: string | null;
  units: DerivedUnit[];
}

type RangeVal = { range: { start: number; end: number } | null; via?: string };

/** via → 매칭 출처. policy=AI, @층폴백=storey, 코드키=rule. */
function viaSource(via: string | undefined): "rule" | "ai" | "storey" | "none" {
  if (!via) return "none";
  if (via.startsWith("policy|")) return "ai";
  if (via.includes("@")) return "storey";
  if (via.includes("|")) return "rule";
  return "none";
}

/** 부재 자신의 메타로 세분 패키지 키. 모듈=호·타입까지, 구조=공종까지. */
function elemPkgKey(el: ParsedElement): {
  key: string;
  trade: string | null;
  zone: string | null;
  storey: string | null;
  worktype: string | null;
  module_unit: string | null;
  mtype: string | null;
} | null {
  const zone = el.zone ?? null;
  const storey = el.storey4d ?? normStorey(el.storeyName) ?? null;
  if (el.trade === "MO") {
    const unit = el.unit ?? null;
    const mt = el.mtype ?? null;
    const key = `MO|${zone ?? "-"}|${storey ?? "-"}|${unit ?? "-"}|${mt ?? "-"}`;
    return { key, trade: "MO", zone, storey, worktype: "MD", module_unit: unit, mtype: mt };
  }
  // 구조(ST/CORE/FOOT)
  const wt = el.wt ?? null;
  const key = `ST|${zone ?? "-"}|${storey ?? "-"}|${wt ?? "-"}`;
  return { key, trade: "ST", zone, storey, worktype: wt, module_unit: null, mtype: null };
}

const shortType = (t: string) => t.replace(/^Ifc/, "");

/** Primavera 활동 인덱스 — 거친 키(zone|storey|wt or zone|storey|MD)별 활동 목록(=유닛). */
function buildUnitIndex(tasks: ScheduleTask[]): Map<string, DerivedUnit[]> {
  const m = new Map<string, DerivedUnit[]>();
  for (const t of tasks) {
    const d = decodeActId(t.code);
    if (!d) continue;
    const wt = d.trade === "MO" ? "MD" : d.worktype ?? "-";
    const ck = `${d.trade}|${d.zone}|${d.storey}|${wt}`;
    const u: DerivedUnit = {
      activity_code: t.code,
      name: t.name ?? null,
      phase: d.phase ?? null,
      match_source: "rule",
      confidence: null,
      start: t.start ?? null,
      end: t.end ?? null,
    };
    const arr = m.get(ck);
    if (arr) arr.push(u);
    else m.set(ck, [u]);
  }
  return m;
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function deriveWorkPackages(
  tasks: ScheduleTask[],
  elements: ParsedElement[],
  ranges: Map<string, RangeVal>,
): DerivedPackage[] {
  const unitIdx = buildUnitIndex(tasks);
  const pkgs = new Map<
    string,
    DerivedPackage & { _acc: Map<string, number>; _minMs: number; _maxMs: number }
  >();

  for (const el of elements) {
    const rv = ranges.get(el.globalId);
    if (!rv?.range) continue; // 매칭된 부재만 (미매칭은 보고서 ①)
    const pk = elemPkgKey(el);
    if (!pk) continue;
    let p = pkgs.get(pk.key);
    if (!p) {
      // 거친 활동키로 유닛 연결 (모듈은 호 무시 — 스케줄이 거기까지만 코딩)
      const coarse = `${pk.trade}|${pk.zone ?? "-"}|${pk.storey ?? "-"}|${pk.worktype ?? "-"}`;
      p = {
        ...pk,
        bim_count_rule: 0,
        bim_count_ai: 0,
        bim_count_storey: 0,
        global_ids: [],
        accessories: [],
        start: null,
        end: null,
        units: unitIdx.get(coarse) ?? [],
        _acc: new Map(),
        _minMs: Infinity,
        _maxMs: -Infinity,
      };
      pkgs.set(pk.key, p);
    }
    const src = viaSource(rv.via);
    if (src === "ai") p.bim_count_ai++;
    else if (src === "storey") p.bim_count_storey++;
    else p.bim_count_rule++;
    p.global_ids.push(el.globalId);
    const st = shortType(el.ifcType);
    p._acc.set(st, (p._acc.get(st) ?? 0) + 1);
    p._minMs = Math.min(p._minMs, rv.range.start);
    p._maxMs = Math.max(p._maxMs, rv.range.end);
  }

  const out: DerivedPackage[] = [];
  for (const p of pkgs.values()) {
    p.accessories = [...p._acc.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
    p.start = p._minMs === Infinity ? null : iso(p._minMs);
    p.end = p._maxMs === -Infinity ? null : iso(p._maxMs);
    const { _acc, _minMs, _maxMs, ...clean } = p;
    void _acc;
    void _minMs;
    void _maxMs;
    out.push(clean);
  }
  // 정렬: zone → storey → unit
  out.sort((a, b) => a.key.localeCompare(b.key));
  return out;
}

// ── 활동 기준 UnitWork 추출 (pmisx 스타일) ─────────────────────────────────────
// 모든 공정 활동(PT 포함, 전 phase)을 행으로. BIM 0개여도 "미연결 + 사유"로 표시.
// (BIM-기준 deriveWorkPackages 와 반대 방향 — 활동에서 BIM 연결 상태를 본다.)

export interface ActivityUnit {
  code: string;
  name: string;
  key: string; // 위치 키 (ST|zone|storey|wt / MO|zone|storey|MD)
  zone: string;
  storey: string;
  worktype: string;
  phase: string;
  ws: string; // WorkSignature 등가
  matched: number; // 연결된 BIM 부재 수 (rule+ai)
  rule: number;
  ai: number;
  status: "연결완료" | "미연결";
  reason: string; // 미연결 사유
  start: string | null;
  end: string | null;
  durationDays: number; // 공정표 기간(일)
  impliedRate: number | null; // 역산 생산성 = matched ÷ durationDays (개/일)
  preds: string[]; // 선행 활동명
  succs: string[]; // 후행 활동명
}

/** 공종/phase → WorkSignature 등가 (pmisx WORKTYPE_WS_HINT 미러). 형틀(FM)은 항상 FORM. */
function wsOf(d: DecodedCode): string {
  if (d.phase === "FM") return "WS-STR-FORM";
  if (d.trade === "MO") return "WS-OSC-MOD";
  if (d.worktype === "FT") return "WS-STR-FTG";
  if (d.worktype === "CR") return "WS-STR-CORE";
  if (d.worktype === "PR") return "WS-STR-PARAPET";
  return "WS-STR";
}

export function deriveActivityUnits(
  tasks: ScheduleTask[],
  elements: ParsedElement[],
  ranges: Map<string, RangeVal>,
): ActivityUnit[] {
  // 1) 활동 위치(coarse 키)별 매칭 카운트 (rule/ai). 층폴백·미매칭 제외.
  const loc = new Map<string, { rule: number; ai: number }>();
  const bump = (k: string, ai: boolean) => {
    const e = loc.get(k) ?? { rule: 0, ai: 0 };
    if (ai) e.ai++;
    else e.rule++;
    loc.set(k, e);
  };
  for (const el of elements) {
    const rv = ranges.get(el.globalId);
    if (!rv?.range || !rv.via) continue;
    const via = rv.via;
    if (via.startsWith("policy|")) {
      bump(via.slice(7), true);
      continue;
    }
    if (via.includes("@")) {
      // 층근사 via("CR@B3"/"MO@1"/"FT@PT") — 무PSet 프로젝트는 전부 이 형식이라 제외하면 연결 0
      // (실측: Busan 연결 18/350). 층 단위 연결로 집계(zone '-', storey 는 canon 통일).
      const [op, st] = via.split("@");
      if (st && (op === "CR" || op === "MO" || op === "FT" || op === "PR")) {
        bump(op === "MO" ? `MO|-|${st}|MD` : `ST|-|${st}|${op}`, false);
      }
      continue;
    }
    if (via.includes("|")) {
      const p = via.split("|");
      const cst = canonStorey(p[2]) || p[2];   // 활동 키와 동일 canon(01↔1 표기 흡수)
      const key = p[0] === "MO" ? `MO|${p[1]}|${cst}|MD` : `ST|${p[1]}|${cst}|${p[3]}`;
      bump(key, false);
    }
  }
  // 2) BIM (공종|층) 존재 — 미연결 사유 판별용
  const OP: Record<string, string> = { CORE: "CR", MOD: "MD", FOOT: "FT" };
  const presence = new Set<string>();
  for (const el of elements) {
    const op = OP[classifyIfcType(el.ifcType, el.name)];
    const st = el.storey4d ?? normStorey(el.storeyName);
    if (op && st) presence.add(`${op}|${st}`);
  }
  const bimHas = (op: string, st: string) =>
    op === "PR" ? presence.has(`CR|${st}`) || presence.has(`MD|${st}`) : presence.has(`${op}|${st}`);

  // 3) 활동마다 행
  const out: ActivityUnit[] = [];
  for (const t of tasks) {
    const d = decodeActId(t.code);
    if (!d) continue;
    const wt = d.trade === "MO" ? "MD" : d.worktype ?? "";
    const key = `${d.trade}|${d.zone}|${canonStorey(d.storey) || d.storey}|${wt}`;
    const c = loc.get(key) ?? { rule: 0, ai: 0 };
    const matched = c.rule + c.ai;
    let reason = "";
    if (matched === 0) {
      const op = d.trade === "MO" ? "MD" : wt;
      reason = bimHas(op, d.storey)
        ? d.trade === "MO"
          ? "모듈 키 불일치"
          : "구역 키 불일치"
        : "해당 위치 BIM 없음";
    }
    const sMs = t.start ? Date.parse(t.start) : NaN;
    const eMs = t.end ? Date.parse(t.end) : NaN;
    const durationDays =
      Number.isNaN(sMs) || Number.isNaN(eMs) ? 0 : Math.max(1, Math.round((eMs - sMs) / 86400000));
    out.push({
      code: t.code,
      name: t.name ?? t.code,
      key,
      zone: d.zone,
      storey: d.storey,
      worktype: wt,
      phase: d.phase,
      ws: wsOf(d),
      matched,
      rule: c.rule,
      ai: c.ai,
      status: matched > 0 ? "연결완료" : "미연결",
      reason,
      start: t.start ?? null,
      end: t.end ?? null,
      durationDays,
      impliedRate: matched > 0 && durationDays > 0 ? Math.round((matched / durationDays) * 10) / 10 : null,
      preds: t.preds ?? [],
      succs: t.succs ?? [],
    });
  }
  return out;
}
