/**
 * 규칙기반 선후행(시퀀스) — Phase 1.
 *
 * 할루시네이션 0: 순서 규칙을 XER TASKPRED 319건에서 채굴(mine)했고,
 * 날짜는 실제 스케줄을 보간(interpolate)한다. 지어내지 않는다.
 *
 * 채굴된 순서:
 *   단계  RB → FM → CN  (철근→거푸집→콘크리트), MO 설치 = IN
 *   공종  FT → CR → MD → PR  (기초→골조→모듈→파라펫)
 *   층    PT → 01 → … → 12 → RF  (아래→위)
 *   구역  ZA→AB→BC, ZA→ZB→ZC  (교대)
 *
 * 용도: 규칙으로 매칭 안 된(공정표에 활동은 없으나 순서상 위치가 분명한) 부재에
 *       앞뒤 실제 활동 날짜 사이를 보간해 순서 정합 날짜를 부여한다.
 */
import type { CodeIndex, MatchResult, ProcElement } from "./match";
import { classifyIfcType, normStorey } from "./match";

const FLOOR_RANK = (s: string): number => (s === "PT" ? 0 : s === "RF" ? 13 : parseInt(s, 10) || 0);
const OP_RANK: Record<string, number> = { FT: 0, CR: 1, MD: 2, PR: 3 };
const PHASE_RANK: Record<string, number> = { RB: 0, FM: 1, CN: 2, IN: 2 };
const ZONE_RANK: Record<string, number> = { ZA: 0, AB: 1, ZB: 1, BC: 2, ZC: 2 };

/** (구역,층,공종,단계) → 전역 순서 랭크 (층>공종>단계>구역 우선). */
function seqRank(zone: string, floor: string, op: string, phase: string): number {
  return (
    FLOOR_RANK(floor) * 100000 +
    (OP_RANK[op] ?? 1) * 10000 +
    (PHASE_RANK[phase] ?? 2) * 1000 +
    (ZONE_RANK[zone] ?? 0) * 100
  );
}

interface RankPoint {
  rank: number;
  start: number;
  end: number;
}

/** 매칭된 코드키들 → (랭크, 날짜) 정렬 배열. 보간 기준점. */
function buildRankCurve(codeIdx: CodeIndex): RankPoint[] {
  const pts: RankPoint[] = [];
  for (const [key, range] of codeIdx.byKey) {
    // key = "ST|zone|floor|wt" | "MO|zone|floor|MD"
    const [trade, zone, floor, wt] = key.split("|");
    if (!zone || !floor) continue;
    const op = trade === "MO" ? "MD" : wt;
    pts.push({ rank: seqRank(zone, floor, op, "CN"), start: range.start, end: range.end });
  }
  pts.sort((a, b) => a.rank - b.rank);
  return pts;
}

/** 랭크 → 날짜 보간 (앞뒤 기준점 사이 선형). 범위 밖은 끝점 클램프. */
function interpolate(rank: number, curve: RankPoint[]): { start: number; end: number } | null {
  if (!curve.length) return null;
  if (rank <= curve[0].rank) return { start: curve[0].start, end: curve[0].end };
  if (rank >= curve[curve.length - 1].rank) {
    const last = curve[curve.length - 1];
    return { start: last.start, end: last.end };
  }
  let lo = 0;
  for (let i = 0; i < curve.length - 1; i++) {
    if (rank >= curve[i].rank && rank <= curve[i + 1].rank) {
      lo = i;
      break;
    }
  }
  const a = curve[lo];
  const b = curve[lo + 1];
  const t = (rank - a.rank) / Math.max(b.rank - a.rank, 1);
  return { start: a.start + (b.start - a.start) * t, end: a.end + (b.end - a.end) * t };
}

const CAT_OP: Record<string, string> = { FOOT: "FT", CORE: "CR", MOD: "MD" };

/**
 * 규칙기반 시퀀스 보정 — 미매칭 부재 중 순서상 위치가 분명한 것에 보간 날짜 부여.
 * 조건: 구역·층이 도출 가능해야 함(없으면 Phase 2 AI 로 넘김 → 회색 유지).
 */
export function fillBySequence(
  elements: (ProcElement & { ifcType: string; storeyName: string | null; globalId: string })[],
  ranges: Map<string, MatchResult>,
  codeIdx: CodeIndex,
): number {
  const curve = buildRankCurve(codeIdx);
  if (!curve.length) return 0;
  let filled = 0;
  for (const el of elements) {
    const cur = ranges.get(el.globalId);
    if (cur?.range) continue; // 이미 매칭됨
    const zone = el.zone;
    const floor = el.storey4d ?? normStorey(el.storeyName);
    if (!zone || !floor) continue; // 위치 불분명 → AI 로
    const op = el.wt || CAT_OP[classifyIfcType(el.ifcType)] || "CR";
    const phase = el.phase || "CN";
    const r = interpolate(seqRank(zone, floor, op, phase), curve);
    if (!r) continue;
    ranges.set(el.globalId, { range: r, via: `seq|${zone}|${floor}|${op}` });
    filled++;
  }
  return filled;
}
