"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { fetchMe } from "../../lib/auth";

/**
 * 클라이언트 인증 가드 (027).
 *
 * 미들웨어가 아닌 클라이언트에서 체크하는 이유: 세션 쿠키가 백엔드(api.clm.site)
 * 도메인에 있어(크로스도메인) Next 미들웨어가 직접 읽을 수 없음 → /auth/me 로 확인.
 *
 * 미인증이면 /login 으로. 인증 확인 전엔 children 렌더 보류(깜빡임 방지).
 *
 * 세션 만료(JWT 12h) 감지: mount/경로변경 + **탭 복귀(visibilitychange)** 시 /auth/me 재검증.
 * 쿠키 만료 시 브라우저가 쿠키를 폐기 → /auth/me 401 → /login 으로 유도.
 * (만료를 빈 목록으로 위장하지 않고 명시적으로 로그인 화면 표시 — 2026-06-01)
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<"checking" | "authed">("checking");

  useEffect(() => {
    let alive = true;

    const redirectToLogin = () =>
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);

    const check = () =>
      fetchMe().then((user) => {
        if (!alive) return;
        if (user) setState("authed");
        else redirectToLogin();
      });

    check();

    // 탭 복귀 시 세션 재검증 (다음날 돌아왔을 때 만료 세션 → 로그인 유도)
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, pathname]);

  if (state !== "authed") {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-spinner" aria-label="인증 확인 중" />
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
