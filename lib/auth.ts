/**
 * 인증 클라이언트 (027) — Google 소셜 로그인 + 세션.
 *
 * 토큰은 백엔드 HttpOnly 쿠키로만 — 프론트는 절대 토큰을 보관/접근하지 않는다.
 * auth 엔드포인트는 백엔드 root(/auth, /oauth2)라 /api 프록시를 타지 않고
 * NEXT_PUBLIC_API_BASE 로 *직접* 호출 (credentials: include + 백엔드 CORS allowlist).
 *
 * 로컬     : NEXT_PUBLIC_API_BASE=http://localhost:8080  (GOOGLE_REDIRECT_URI 포트와 일치)
 * 프로덕션 : NEXT_PUBLIC_API_BASE=https://api.clm.site
 */

export const AUTH_API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8080";

export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
  picture: string | null;
  role: string;
}

/** Google 로그인 시작 URL (top-level navigation 으로 이동). */
export function googleLoginUrl(): string {
  return `${AUTH_API_BASE}/auth/google/login`;
}

/** 현재 로그인 사용자. 미인증이면 null. */
export async function fetchMe(): Promise<AuthUser | null> {
  try {
    const res = await fetch(`${AUTH_API_BASE}/auth/me`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.authenticated ? (data.user as AuthUser) : null;
  } catch {
    return null;
  }
}

/** 로그아웃 — 백엔드가 쿠키 삭제. */
export async function logout(): Promise<void> {
  try {
    await fetch(`${AUTH_API_BASE}/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
  } catch {
    /* 무시 — 쿠키 만료로 어차피 무효화 */
  }
}
