// BIM 디시플린 레이어 택소노미 — Lv.2 Trade(공종) = 레이어 키.
// 규칙: 파일이 1개든 N개든, 요소의 trade 로 레이어를 합친다(단일/분할 투명).
// 레이어 = AEC 표준 공종 = 시공순서. 4D 에서 토목→구조→건축→MEP→조경 순으로 쌓인다.

export interface LayerDef {
  trade: string; // Lv.2 Trade 코드 (BIM 태깅 표준)
  name: string; // 한글명 (패널 표시)
  order: number; // 시공순서 (패널 정렬)
  defaultOn: boolean; // 기본 표시 — 밀집/대용량 레이어(가설·MEP)는 off
}

// BIM 작성자가 Lv.2 Trade 에 태깅할 표준 코드. 순서 = 시공단계.
export const LAYERS: LayerDef[] = [
  { trade: "CV", name: "토목", order: 1, defaultOn: true },
  { trade: "TW", name: "가설", order: 1, defaultOn: false }, // 비계·동바리 — 밀집(16k+)
  { trade: "ST", name: "구조", order: 2, defaultOn: true },
  { trade: "MO", name: "모듈", order: 2, defaultOn: true },
  { trade: "AR", name: "건축", order: 3, defaultOn: true },
  { trade: "ME", name: "기계", order: 4, defaultOn: false }, // MEP — 밀집 배관/덕트
  { trade: "FP", name: "소방", order: 4, defaultOn: false },
  { trade: "EL", name: "전기", order: 4, defaultOn: false },
  { trade: "TC", name: "통신", order: 4, defaultOn: false },
  { trade: "LS", name: "조경", order: 5, defaultOn: true },
];

export const LAYER_BY_TRADE: Map<string, LayerDef> = new Map(LAYERS.map((l) => [l.trade, l]));

/** 기본 숨김 레이어(defaultOn=false)의 trade 집합 — 뷰어 초기 상태. */
export const DEFAULT_HIDDEN_TRADES: Set<string> = new Set(
  LAYERS.filter((l) => !l.defaultOn).map((l) => l.trade),
);

/** trade → 한글 레이어명 (미정의 trade 는 코드 그대로). */
export function layerName(trade: string | undefined): string {
  if (!trade) return "기타";
  return LAYER_BY_TRADE.get(trade)?.name ?? trade;
}

// ── 공종(disc) 단위 필터 — 패널은 6공종으로 토글(ME/FP/EL/TC 를 MEP 하나로 묶음) ──
// trade(Lv.2) → 공종(disc). MEP 4개 sub-trade 를 하나로, ST/MO 를 구조로 통합.
export const TRADE_TO_DISC: Record<string, string> = {
  CV: "토목", TW: "가설", ST: "구조", MO: "구조", AR: "건축",
  ME: "MEP", FP: "MEP", EL: "MEP", TC: "MEP", LS: "조경",
};
// 패널 표시 순서 = 시공 시퀀스.
export const DISC_ORDER = ["토목", "구조", "건축", "MEP", "조경", "가설"];

/** 요소의 공종 — disc(슬롯/분류기) 우선, 종합/미설정이면 trade 매핑, 그것도 없으면 기타. */
export function disciplineOf(el: { disc?: string; trade?: string }): string {
  if (el.disc && el.disc !== "종합") return el.disc;   // 슬롯/서버 분류 공종
  if (el.trade) return TRADE_TO_DISC[el.trade] ?? el.trade;  // 종합 파일 = PSet trade 로 분리
  return "기타";
}
