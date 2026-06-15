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
