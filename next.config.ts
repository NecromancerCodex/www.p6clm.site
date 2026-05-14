import type { NextConfig } from "next";

const CLM_BACKEND =
  process.env.CLM_SERVER_API_URL ?? "http://localhost:8002";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["http://192.168.0.20:1999", "http://localhost:1999"],
  transpilePackages: ["speak-tts", "react-speech-recognition"],

  async rewrites() {
    return [
      // /api/clm/** → CLM FastAPI /api/v1/**  (DocAutoGenSection 전용)
      {
        source: "/api/clm/:path*",
        destination: `${CLM_BACKEND}/api/v1/:path*`,
      },
      // /api/v1/** → CLM FastAPI /api/v1/**
      // AnalysisRequestForm, lib/api.ts 클라이언트 사이드 호출 통일
      // (서버사이드 lib/api.ts는 CLM_SERVER_API_URL 직접 사용)
      {
        source: "/api/v1/:path*",
        destination: `${CLM_BACKEND}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
