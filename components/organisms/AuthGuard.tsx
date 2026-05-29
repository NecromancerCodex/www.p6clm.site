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
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<"checking" | "authed">("checking");

  useEffect(() => {
    let alive = true;
    fetchMe().then((user) => {
      if (!alive) return;
      if (user) {
        setState("authed");
      } else {
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      }
    });
    return () => {
      alive = false;
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
