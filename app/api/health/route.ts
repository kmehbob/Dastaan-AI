import { NextResponse } from "next/server";

export async function GET() {
  const apiUrl = process.env.TRANSLATION_API_URL;
  if (!apiUrl) {
    return NextResponse.json(
      { status: "configuration_required" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(`${apiUrl.replace(/\/$/, "")}/health`, {
      signal: controller.signal,
      cache: "no-store",
    });
    const payload = await response.json();
    return NextResponse.json(payload, {
      status: response.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { status: "offline" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    clearTimeout(timeout);
  }
}
