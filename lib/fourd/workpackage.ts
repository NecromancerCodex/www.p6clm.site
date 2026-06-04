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
import { decodeActId, normStorey, type ScheduleTask } from "./match";
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
