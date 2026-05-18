"use client";

import { Check, FileText, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { labelForCategory, labelForDocType } from "../../lib/docLabels";
import { useChatStore } from "../../stores/chatStore";
import type { TriggeredJob } from "../../stores/chatStore";
import { Spinner } from "../atoms/Spinner";

interface TriggeredJobCardProps {
  job: TriggeredJob;
}

/**
 * supervisor 가 비동기로 트리거한 doc-generate 작업의 진행 상태 카드.
 *
 * - 마운트되면 jobsSlice.trackJob(job) 으로 폴링 시작(멱등)
 * - phase 에 따라 스켈레톤(polling) / 완료 배지(done) / 오류(error) 렌더
 * - 완료/오류 시 jobsSlice 가 시스템 어시스턴트 메시지를 자동으로 push
 */
export function TriggeredJobCard({ job }: TriggeredJobCardProps) {
  const status = useChatStore((s) => s.jobStatuses[job.job_id]);
  const trackJob = useChatStore((s) => s.trackJob);

  useEffect(() => {
    trackJob(job);
  }, [job, trackJob]);

  const phase = status?.phase ?? "polling";
  const docLabel = labelForDocType(job.doc_type);
  const catLabel = labelForCategory(job.doc_category);

  if (phase === "done") {
    return (
      <Link href="/progress" className="cbot-job-card is-done" aria-label={`${docLabel} 보러 가기`}>
        <span className="cbot-job-card-icon" aria-hidden>
          <Check size={18} strokeWidth={2.5} />
        </span>
        <span className="cbot-job-card-body">
          <span className="cbot-job-card-title">{docLabel} 작성 완료</span>
          <span className="cbot-job-card-sub">/progress → {catLabel} 탭에서 결과 확인</span>
        </span>
        <span className="cbot-job-card-arrow" aria-hidden>→</span>
      </Link>
    );
  }

  if (phase === "error") {
    return (
      <Link href="/progress" className="cbot-job-card is-error" aria-label={`${docLabel} 오류 — /progress 에서 확인`}>
        <span className="cbot-job-card-icon" aria-hidden>
          <AlertTriangle size={18} strokeWidth={2.2} />
        </span>
        <span className="cbot-job-card-body">
          <span className="cbot-job-card-title">{docLabel} 작성 중 오류</span>
          <span className="cbot-job-card-sub">{status?.error ?? "알 수 없는 오류"}</span>
        </span>
        <span className="cbot-job-card-arrow" aria-hidden>→</span>
      </Link>
    );
  }

  // polling — 진행 중 카드(스켈레톤)
  return (
    <Link
      href="/progress"
      className="cbot-job-card is-polling"
      aria-label={`${docLabel} 작성 진행 중 — /progress 에서 확인`}
    >
      <span className="cbot-job-card-icon" aria-hidden>
        <FileText size={16} strokeWidth={2} />
      </span>
      <span className="cbot-job-card-body">
        <span className="cbot-job-card-title">
          <span className="cbot-job-spin" aria-hidden>
            <Spinner size="sm" />
          </span>
          {docLabel} 작성 중
        </span>
        <span className="cbot-job-card-sub">/progress → {catLabel} 탭에서 진행 확인</span>
        <span className="cbot-job-skeleton" aria-hidden>
          <span className="cbot-job-skel-bar cbot-job-skel-bar--a" />
          <span className="cbot-job-skel-bar cbot-job-skel-bar--b" />
          <span className="cbot-job-skel-bar cbot-job-skel-bar--c" />
        </span>
      </span>
      <span className="cbot-job-card-arrow" aria-hidden>→</span>
    </Link>
  );
}
