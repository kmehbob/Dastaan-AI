import { NextRequest, NextResponse } from "next/server";

const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_CHARACTERS = 5_000;

export async function POST(request: NextRequest) {
  const apiUrl = process.env.TRANSLATION_API_URL;
  const apiKey = process.env.TRANSLATION_API_KEY;

  if (!apiUrl || !apiKey) {
    return NextResponse.json(
      {
        detail:
          "Private speech service is not configured. Set TRANSLATION_API_URL and TRANSLATION_API_KEY.",
      },
      { status: 503 },
    );
  }

  let body: { text?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: "Invalid JSON request." }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ detail: "Urdu text is required." }, { status: 422 });
  }
  if (text.length > MAX_CHARACTERS) {
    return NextResponse.json(
      { detail: `Text must be ${MAX_CHARACTERS.toLocaleString()} characters or fewer.` },
      { status: 413 },
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const upstream = await fetch(`${apiUrl.replace(/\/$/, "")}/api/v1/speak`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
        "X-Request-ID": request.headers.get("x-request-id") || crypto.randomUUID(),
      },
      body: JSON.stringify({ text, language: "ur" }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!upstream.ok) {
      const payload = await upstream.json().catch(() => ({}));
      return NextResponse.json(payload, { status: upstream.status });
    }

    const audio = await upstream.arrayBuffer();
    return new NextResponse(audio, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "audio/wav",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return NextResponse.json(
      {
        detail: timedOut
          ? "The private model took too long to respond. Please retry."
          : "The private speech synthesis service is unavailable.",
      },
      { status: timedOut ? 504 : 502 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
