/**
 * 문서 타입 / 카테고리 한글 라벨 매핑
 *
 * chat 영역(MessageBubble, jobsSlice)에서 supervisor 가 트리거한 doc_type/doc_category 를
 * 사용자에게 보여줄 한글로 변환할 때 사용.
 */

export const DOC_TYPE_LABELS: Record<string, string> = {
  design_review:   "설계 검토 보고서",
  design_change:   "도면 변경 요청서",
  design_fit:      "설계 적합성 검토서",
  proc_daily:      "공사일보",
  proc_weekly:     "주간 공정현황 보고",
  proc_monthly:    "월간 공정현황 보고",
  proc_supervision: "감리 보고서",
  const_plan:      "시공 계획서",
  daily_report:    "작업 일보",
  const_check:     "시공 품질 확인서",
  quality_inspect: "품질 검사 보고서",
  material_check:  "자재 검수 확인서",
  defect_report:   "부적합 처리 보고서 (NCR)",
  safety_inspect:  "정기 안전 점검 보고서",
  risk_assess:     "위험성 평가서",
  accident_report: "사고 조사 보고서",
};

export const CATEGORY_LABELS: Record<string, string> = {
  design:       "설계관리",
  process:      "공정관리",
  construction: "시공관리",
  quality:      "품질관리",
  safety:       "안전관리",
};

export function labelForDocType(docType: string): string {
  return DOC_TYPE_LABELS[docType] ?? docType;
}

export function labelForCategory(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}
