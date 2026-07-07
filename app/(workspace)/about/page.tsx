
export const metadata = { title: "소개 | p6 CLM" };

const FEATURES = [
  {
    icon: "",
    title: "AI 대화",
    desc: "건설 현장 AI 챗봇 ConstructBot과 자연어로 소통합니다. NCR·품질·안전·공정 관련 질문에 즉시 답변합니다.",
  },
  {
    icon: "",
    title: "문서 자동 작성",
    desc: "현장 사진 한 장으로 NCR 부적합 보고서를 자동 생성합니다. EXAONE + GPT-5-mini 파이프라인이 KCS/KDS 기준을 분석합니다.",
  },
  {
    icon: "",
    title: "YOLO 탐지",
    desc: "YOLOv8 모델로 건설 현장 이미지에서 결함·안전 위협 요소를 자동 탐지합니다.",
  },
  {
    icon: "",
    title: "지식 그래프",
    desc: "Neo4j 온톨로지 DB에 건설 법규(KCS·KDS)와 현장 사례를 구조화하여 정확한 기술 판단을 제공합니다.",
  },
];

export default function AboutPage() {
  return (
    <div className="ws-inner-pad">
      <div className="ws-section-title">
                소개
      </div>
      <p className="ws-section-desc">
        p6 CLM(Construction Lifecycle Management)은 AI 기반 건설 현장 관리 플랫폼입니다.
      </p>
      <div className="ws-feature-grid">
        {FEATURES.map((f) => (
          <div key={f.title} className="ws-feature-card">
            <span className="ws-feature-icon">{f.icon}</span>
            <strong>{f.title}</strong>
            <p>{f.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
