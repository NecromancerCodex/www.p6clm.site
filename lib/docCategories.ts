/**
 * 문서 작성 / 진행도 공통 — 5대 관리 구분 및 보고서 종류.
 */
import type { CategoryId } from "../stores/docStore";

export interface DocDef {
  id: string;
  label: string;
  isNcr?: boolean;
}

export interface DocCategoryDef {
  id: CategoryId;
  label: string;
  icon: string;
  color: "blue" | "purple" | "amber" | "teal" | "red";
  description: string;
  documents: readonly DocDef[];
}

export const DOC_CATEGORIES: readonly DocCategoryDef[] = [
  {
    id: "design",
    label: "설계관리",
    icon: "📐",
    color: "blue",
    description: "도면 검토·설계 변경 요청·적합성 확인 문서",
    documents: [
      { id: "design_review", label: "설계 검토 보고서" },
      { id: "design_change", label: "도면 변경 요청서" },
      { id: "design_fit", label: "설계 적합성 검토서" },
    ],
  },
  {
    id: "process",
    label: "공정관리",
    icon: "📊",
    color: "purple",
    description: "P6 공정표 기반 공정 보고서 (공사관리 연동)",
    documents: [
      { id: "proc_daily", label: "공사일보" },
      { id: "proc_weekly", label: "주간 공정현황 보고" },
      { id: "proc_monthly", label: "월간 공정현황 보고" },
      { id: "proc_supervision", label: "감리 보고서" },
    ],
  },
  {
    id: "construction",
    label: "시공관리",
    icon: "🏗️",
    color: "amber",
    description: "시공 계획·작업 일보·품질 확인 문서",
    documents: [
      { id: "const_plan", label: "시공 계획서" },
      { id: "daily_report", label: "작업 일보" },
      { id: "const_check", label: "시공 품질 확인서" },
    ],
  },
  {
    id: "quality",
    label: "품질관리",
    icon: "✅",
    color: "teal",
    description:
      "품질 검사·자재 검수가 시작점입니다. 적합이면 그대로 완료, 부적합이면 NCR이 자동 발행되고 NCR에서 CAR(시정조치)을 생성합니다.",
    documents: [
      { id: "quality_inspect", label: "품질 검사 보고서" },
      { id: "material_check", label: "자재 검수 확인서" },
      { id: "defect_report", label: "부적합 처리 보고서 (NCR) — 직접 발행", isNcr: true },
    ],
  },
  {
    id: "safety",
    label: "안전관리",
    icon: "⛑️",
    color: "red",
    description: "안전 점검·위험성 평가·사고 조사 문서",
    documents: [
      { id: "safety_inspect", label: "정기 안전 점검 보고서" },
      { id: "risk_assess", label: "위험성 평가서" },
      { id: "accident_report", label: "사고 조사 보고서" },
    ],
  },
] as const;

export function categoryForDocType(docType: string): CategoryId | null {
  for (const c of DOC_CATEGORIES) {
    if (c.documents.some((d) => d.id === docType)) return c.id;
  }
  return null;
}

export function docLabelForType(docType: string): string {
  for (const c of DOC_CATEGORIES) {
    const d = c.documents.find((x) => x.id === docType);
    if (d) return d.label;
  }
  if (docType === "general") return "일반 보고서";
  if (docType === "unknown") return "미분류";
  return docType;
}

/**
 * 이력 행 → UI 5분류. DB 메타가 없으면 doc_type으로 추정하고,
 * 매핑 불가 시 `process`에 모아 깨진 탭이 생기지 않게 함.
 */
export function resolveItemCategory(
  docType: string,
  docCategory: string | null | undefined,
): CategoryId {
  const fromRow = (docCategory || "").trim();
  if (fromRow && DOC_CATEGORIES.some((c) => c.id === fromRow)) {
    return fromRow as CategoryId;
  }
  const inferred = categoryForDocType(docType);
  if (inferred) return inferred;
  if (docType === "general") return "construction";
  return "process";
}
