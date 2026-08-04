import { NextRequest, NextResponse } from "next/server";

const MAX_AUDIO_BYTES = 15 * 1024 * 1024;

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

  try {
    const incoming = await request.formData();
    const audio = incoming.get("audio");
    if (!(audio instanceof File)) {
      return NextResponse.json({ detail: "An audio recording is required." }, { status: 422 });
    }
    if (!audio.size || audio.size > MAX_AUDIO_BYTES) {
      return NextResponse.json(
        { detail: "Audio must be between 1 byte and 15 MB." },
        { status: 413 },
      );
    }

    const outbound = new FormData();
    outbound.append("audio", audio, audio.name || "urdu-recording.webm");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    try {
      const response = await fetch(`${apiUrl.replace(/\/$/, "")}/api/v1/transcribe`, {
        method: "POST",
        headers: {
          "X-API-Key": apiKey,
          "X-Request-ID": request.headers.get("x-request-id") || crypto.randomUUID(),
        },
        body: outbound,
        signal: controller.signal,
        cache: "no-store",
      });
      const payload = await response.json();
      return NextResponse.json(payload, {
        status: response.status,
        headers: { "Cache-Control": "no-store" },
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return NextResponse.json(
      {
        detail: timedOut
          ? "Private speech recognition timed out. Try a shorter recording."
          : "The private speech recognition service is unavailable.",
      },
      { status: timedOut ? 504 : 502 },
    );
  }
}
