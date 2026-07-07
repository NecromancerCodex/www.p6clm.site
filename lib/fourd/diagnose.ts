/**
 * 미매칭 원인 분류 (규칙 결정론 — LLM 0).
 * 진단 어시스턴트의 "왜 안 됐나 + 어떻게 하면 되나"를 사실에 근거해 설명한다.
 * AI는 여기서 판정하지 않는다(환각 안전). C4(원인 미상)만 다음 단계에서 AI가 보조 설명.
 */

export type Cause = "C1" | "C2" | "C3" | "C4";

export interface CauseMeta {
  cause: Cause;
  title: string;
  color: string;
  explain: string; // 왜 매칭이 안 됐나 (사실 기반)
  recommend: string; // 사람(PM)이 취할 행동 — 제안형
}

/** 공정표 후보 키 → "(공종|층) → 존재하는 zone 집합". C2(활동 자체 없음) vs C3(다른 zone엔 있음) 판별용. */
export function buildSchedOpStorey(candidateKeys: string[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const k of candidateKeys) {
    const p = k.split("|"); // ST|zone|storey|wt  또는  MO|zone|storey|MD
    if (p.length < 4) continue;
    const op = p[0] === "MO" ? "MD" : p[3];
    const key = `${op}|${p[2]}`;
    let set = m.get(key);
    if (!set) {
      set = new Set();
      m.set(key, set);
    }
    set.add(p[1]);
  }
  return m;
}

/**
 * 미매칭 부재 1건(또는 동질 그룹의 대표)의 원인을 규칙으로 확정.
 * @param via    matchAllHybrid 가 남긴 경로 ("no_act:ST|ZB|01|CR" / "no_act@RF" / "no_storey")
 * @param zone   BIM 공정 PSet zone (없으면 undefined)
 * @param schedOpStorey buildSchedOpStorey 결과
 */
export function classifyUnmatched(
  via: string | undefined,
  zone: string | undefined,
  schedOpStorey: Map<string, Set<string>>,
  aiAttempted = false, // 정책(AI) 매칭을 이미 돌린 뒤면 권장문구를 '미해결'로 전환
): CauseMeta {
  // C1-a — 층(storey) 인식 실패: BIM 층 이름이 공정표 층 표기와 안 맞음 (형식 불일치)
  if (via === "no_storey") {
    return {
      cause: "C1",
      title: "층(storey) 매칭 실패 — 표기 불일치",
      color: "var(--muted)",
      explain: "BIM 부재의 층 이름을 공정표 층과 매칭하지 못했습니다 (예: BIM은 'Level 2', 공정표는 '02'/'2층' 등 표기가 다름).",
      recommend: "BIM 층 이름과 공정표 층 표기를 같은 형식으로 맞추세요. (자동생성 공정표는 BIM 층을 그대로 쓰므로 보통 일치)",
    };
  }
  // C1-b — zone 태그 없음: 비구조·데이텀·주차장(또는 단일동이라 zone 분할 없음)
  if (!zone) {
    return {
      cause: "C1",
      title: "zone 태그 없음 (비구조·단일동·대상 외)",
      color: "var(--muted)",
      explain: "구역(zone) 태그가 없는 부재입니다 (단일동이라 구역 분할이 없거나, 데이텀·비구조 요소, 또는 BIM 태그 누락).",
      recommend: "단일동이면 층(storey)만으로 매칭됩니다 — 그래도 미매칭이면 층 표기 불일치 또는 공정표에 해당 층 활동이 없는지 확인하세요.",
    };
  }

  // no_act:KEY — 코드(공종·층)는 있으나 그 키가 스케줄에 없음 → C2 vs C3 판별
  const m = /^no_act[:@](.+)$/.exec(via ?? "");
  if (m && m[1].includes("|")) {
    const p = m[1].split("|");
    const op = p[0] === "MO" ? "MD" : p[3];
    const st = p[2];
    const zones = schedOpStorey.get(`${op}|${st}`);
    const others = zones ? [...zones].filter((z) => z !== p[1]) : [];
    if (others.length) {
      return {
        cause: "C3",
        title: "zone 스킴 불일치",
        color: "var(--teal)",
        explain: `BIM은 '${p[1]}' 구역으로 태그됐으나, 공정표의 같은 공종·층 활동은 '${others.join(", ")}' 구역명으로 코딩돼 있어 자동 매칭이 안 됩니다 (미시공이 아니라 이름 매핑 문제).`,
        recommend: aiAttempted
          ? `AI 매칭으로도 미해결 — '${p[1]}'↔'${others.join("/")}' 구역 스킴을 수동 매핑하거나 공정표 구역 중복(통합↔분리)을 정리하세요.`
          : `정책(AI) 매칭으로 ${p[1]}→${others.join("/")} 구역 매핑을 적용하면 연결됩니다.`,
      };
    }
    return {
      cause: "C2",
      title: "공정표에 해당 활동 없음",
      color: "var(--teal)",
      explain: `이 위치·공종(${st}층)에 대응하는 공정 활동이 스케줄에 존재하지 않습니다 (예: PT층 모듈, 지붕 코어).`,
      recommend: "공정 설계상 의도된 것이면 정상입니다. 실제 시공 대상이면 공정표에 활동 추가를 검토하세요.",
    };
  }

  // C4 — 규칙으로 특정 불가 → 다음 단계 AI 보조 대상
  return {
    cause: "C4",
    title: "원인 미상 (AI 검토 대상)",
    color: "var(--primary)",
    explain: "규칙으로 원인을 특정하지 못했습니다.",
    recommend: "AI 보조 분석 대상입니다 (다음 단계에서 설명).",
  };
}

export const CAUSE_ORDER: Cause[] = ["C3", "C2", "C1", "C4"]; // 조치 우선순위(해결가능 → 정상 → 대상외 → 미상)

// ── ② 공정 있는데 BIM 없음 — 활동 관점 원인 분류 ────────────────────────────
// A 재연결가능(구역만 불일치, BIM은 그 위치에 있음) / B 모델누락·미시공(BIM 실제 0) / C 판단보류

export interface NoBimCause {
  cause: "A" | "B" | "C";
  title: string;
  color: string;
  explain: string;
  recommend: string;
}

export const NOBIM_ORDER: ("A" | "B" | "C")[] = ["A", "B", "C"];

/** BIM 부재의 (공종|층) 존재 여부. PR(파라펫)은 BIM에서 CORE/MOD 로 모델링되므로 그쪽 존재로 판단. */
function bimHas(presence: Set<string>, op: string, storey: string): boolean {
  if (op === "PR") return presence.has(`CR|${storey}`) || presence.has(`MD|${storey}`);
  return presence.has(`${op}|${storey}`);
}

/**
 * 미매칭 공정활동(BIM 부재 0건)의 원인 분류.
 * @param presence BIM 부재의 "(op|storey)" 집합 (op: CR/MD/FT)
 * @param zonesAt  "(op|storey)" → BIM 구역 집합 (A 의 불일치 구역 안내용)
 */
export function classifyNoBim(
  key: string,
  presence: Set<string>,
  zonesAt: Map<string, Set<string>>,
  aiAttempted = false, // 정책(AI) 매칭 후면 권장문구를 '미해결'로 전환
): NoBimCause {
  const p = key.split("|"); // ST|zone|storey|wt | MO|zone|storey|MD
  const op = p[0] === "MO" ? "MD" : p[3];
  const storey = p[2];
  const zone = p[1];

  if (!bimHas(presence, op, storey)) {
    return {
      cause: "B",
      title: "BIM 모델 누락 / 미시공",
      color: "var(--red)",
      explain: `${storey}층·${op} 위치에 BIM 부재가 실제로 없습니다 (모델 미작성 또는 아직 미시공).`,
      recommend: "BIM 모델에서 누락됐는지, 아니면 시공 전 단계인지 확인하세요 (지어내지 않음).",
    };
  }
  const others = [...(zonesAt.get(`${op === "PR" ? "CR" : op}|${storey}`) ?? [])].filter((z) => z && z !== zone);
  return {
    cause: "A",
    title: "구역 불일치 (재연결 가능)",
    color: "var(--teal)",
    explain: `${storey}층에 BIM 부재는 있으나, 공정 구역명('${zone}')과 BIM 구역명${others.length ? `('${others.join(", ")}')` : ""}이 달라 자동 연결이 안 됩니다 (미시공 아님, 이름 매핑 문제).`,
    recommend: aiAttempted
      ? "AI 매칭으로도 미해결 — 구역명 수동 매핑 또는 공정표 구역 중복(통합 'AB' ↔ 분리 'ZA/ZB') 정리가 필요합니다. (단, 통합활동은 분리활동과 중복일 수 있음)"
      : "정책(AI) 매칭으로 구역 매핑을 적용하면 연결됩니다.",
  };
}
