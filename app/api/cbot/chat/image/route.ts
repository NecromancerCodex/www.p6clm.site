/**
 * /api/cbot/chat/image
 *
 * 이미지 첨부 채팅 요청을 백엔드 /api/v1/cbot/chat/image 로 프록시.
 * 프론트엔드 → Next.js Route → FastAPI (multipart 그대로 전달)
 */
import { NextRequest, NextResponse } from "next/server";

import { API_URL } from "../../../../../lib/config";

export async function POST(req: NextRequest) {
  try {
    // 프론트엔드에서 온 FormData 그대로 백엔드로 전달
    const formData = await req.formData();

    const messageRaw = formData.get("message");
    const messageStr = messageRaw != null ? String(messageRaw).trim() : "";
    const imageEntry = formData.get("image");
    // FormDataEntryValue = File | string — File 아닌 쪽은 string이라 instanceof Blob 불가(TS 오류)
    const hasImage = imageEntry instanceof File && imageEntry.size > 0;

    if (!messageStr && !hasImage) {
      return NextResponse.json(
        { error: "메시지 또는 이미지가 필요합니다." },
        { status: 400 }
      );
    }

    if (!messageStr && hasImage) {
      formData.set("message", "첨부 이미지를 분석해 주세요.");
    }

    const upstream = await fetch(`${API_URL}/api/v1/cbot/chat/image`, {
      method: "POST",
      // cookie: 로그인 owner 컨텍스트 전파(세션 소유권 — 없으면 매번 새 세션 생김)
      headers: { cookie: req.headers.get("cookie") ?? "" },
      body: formData,
      // Content-Type 헤더는 자동으로 multipart/form-data; boundary=... 가 설정됨
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      return NextResponse.json(
        { error: `백엔드 오류 ${upstream.status}: ${text.slice(0, 200)}` },
        { status: upstream.status }
      );
    }

    const data = await upstream.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("[cbot/chat/image] proxy error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "알 수 없는 오류" },
      { status: 500 }
    );
  }
}
