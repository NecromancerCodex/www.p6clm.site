import { NextRequest, NextResponse } from "next/server";

import { API_URL } from "../../../../lib/config";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message, history = [] } = body as {
      message: string;
      history: Array<{ role: string; content: string }>;
    };

    if (!message?.trim()) {
      return NextResponse.json({ error: "메시지가 비어 있습니다." }, { status: 400 });
    }

    // CLM 백엔드 cbot 엔드포인트 프록시
    const upstream = await fetch(`${API_URL}/api/v1/cbot/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history }),
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
    console.error("[cbot/chat] proxy error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "알 수 없는 오류" },
      { status: 500 }
    );
  }
}
