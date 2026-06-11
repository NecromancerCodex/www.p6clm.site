"use client";

/**
 * 플랜 워처 — 비동기 플래닝의 전역 감시자 (workspace 레이아웃 상주).
 *
 * 공정 플래닝은 2~3분 백그라운드 작업: 사용자가 다른 페이지에서 일 보는 동안
 * localStorage 체크포인트의 plan 을 폴링하다가, 완료(logic_ready)/실패(error) 시
 * 토스트 알림 → 클릭하면 검토 페이지로 이동. 탭이 백그라운드면 브라우저 알림도.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { getPlan, type PlanStage } from "../../lib/api/schedule";

const PLAN_CKPT = "clm.schedule.plan.active";
const POLL_MS = 8000;

export default function PlanWatcher() {
  const router = useRouter();
  const pathname = usePathname();
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string; planId: string } | null>(null);
  const lastNotified = useRef<string | null>(null);   // planId:stage — 중복 알림 방지
  const doneSeen = useRef<Set<string>>(new Set());    // 확정 완료 본 플랜 — 폴링 중단(체크포인트는 유지)

  const notify = useCallback((kind: "ok" | "err", msg: string, planId: string) => {
    setToast({ kind, msg, planId });
    // 탭이 백그라운드면 브라우저 알림 (권한 있을 때만 — 요청은 완료 시점에 한 번)
    if (typeof document !== "undefined" && document.hidden && "Notification" in window) {
      if (Notification.permission === "granted") {
        new Notification("공정계획 위저드", { body: msg });
      } else if (Notification.permission === "default") {
        void Notification.requestPermission();
      }
    }
  }, []);

  useEffect(() => {
    const tick = async () => {
      const planId = localStorage.getItem(PLAN_CKPT);
      if (!planId) return;
      if (doneSeen.current.has(planId)) return;   // 확정 완료 본 플랜 — 감시 중단(체크포인트는 유지)
      if (pathname?.startsWith("/schedule/plan")) return;   // 페이지 자체 폴링이 처리 — 중복 방지
      try {
        const p = await getPlan(planId);
        const stage: PlanStage = p.stage;
        const key = `${planId}:${stage}`;
        if (stage === "logic_ready" && lastNotified.current !== key) {
          lastNotified.current = key;
          const n = (p.payload.activities_user ?? p.payload.activities ?? []).length;
          notify("ok", `✅ 공정 플래닝 완료 — 액티비티 ${n}개 검토가 준비됐습니다`, planId);
        } else if (stage === "error" && lastNotified.current !== key) {
          lastNotified.current = key;
          notify("err", "⚠️ 공정 플래닝 실패 — 확인이 필요합니다", planId);
        } else if (stage === "done") {
          doneSeen.current.add(planId);   // 감시만 종료 — 체크포인트는 '새 계획 시작' 전까지 유지(복원용)
        }
      } catch {
        /* 폴링 실패는 조용히 — 다음 틱에 재시도 */
      }
    };
    const h = setInterval(() => { void tick(); }, POLL_MS);
    void tick();
    return () => clearInterval(h);
  }, [pathname, notify]);

  if (!toast) return null;
  return (
    <div className={`pw-toast ${toast.kind}`} role="alert">
      <span style={{ flex: 1 }}>{toast.msg}</span>
      <button className="pw-go" onClick={() => {
        const id = toast.planId;
        setToast(null);
        router.push(`/schedule/plan?plan=${id}`);
      }}>
        {toast.kind === "ok" ? "검토하러 가기 →" : "확인하기 →"}
      </button>
      <button className="pw-x" aria-label="닫기" onClick={() => setToast(null)}>✕</button>
      <style jsx>{`
        .pw-toast { position: fixed; bottom: 24px; right: 24px; z-index: 4000; display: flex; align-items: center;
                    gap: 12px; max-width: 420px; padding: 14px 16px; border-radius: 12px; font-size: 13.5px;
                    background: #fff; color: #1e293b; border: 1px solid #bbf7d0;
                    box-shadow: 0 8px 30px rgba(2, 6, 23, .18); animation: pw-in .25s ease-out; }
        .pw-toast.err { border-color: #fecaca; }
        @keyframes pw-in { from { transform: translateY(12px); opacity: 0; } to { transform: none; opacity: 1; } }
        .pw-go { flex-shrink: 0; padding: 7px 13px; background: #16a34a; color: #fff; border: none;
                 border-radius: 8px; font-size: 12.5px; font-weight: 700; cursor: pointer; }
        .pw-toast.err .pw-go { background: #dc2626; }
        .pw-x { background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 13px; flex-shrink: 0; }
      `}</style>
    </div>
  );
}
