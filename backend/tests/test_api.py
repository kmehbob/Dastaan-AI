import os

os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("TRANSLATION_API_KEY", "test-key-that-is-longer-than-thirty-two-characters")
os.environ.setdefault("REQUIRE_HTTPS", "false")
os.environ.setdefault("TRUSTED_HOSTS", "testserver,localhost")

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.services import ParagraphPreservingTranslator, StubLineTranslator


API_KEY = "test-key-that-is-longer-than-thirty-two-characters"


class FakeSpeechService:
    async def transcribe(self, audio: bytes) -> tuple[str, float | None]:
        assert audio == b"private-audio"
        return "یہ ایک نجی آڈیو ٹیسٹ ہے", 1.25


def build_client(rate_limit: int = 30) -> TestClient:
    settings = Settings(
        environment="test",
        api_key=API_KEY,
        require_https=False,
        trusted_hosts=("testserver", "localhost"),
        cors_origins=("https://translator.test",),
        rate_limit_requests=rate_limit,
        rate_limit_window_seconds=60,
        enable_transcript_correction=False,
    )
    translator = ParagraphPreservingTranslator(
        StubLineTranslator(lambda value: f"English({value})")
    )
    app = create_app(settings, translator, FakeSpeechService())
    return TestClient(app)


def test_health_does_not_require_content_or_credentials() -> None:
    response = build_client().get("/health")
    assert response.status_code == 200
    assert response.json()["data_retention"] == "none"


def test_translation_requires_api_key() -> None:
    response = build_client().post("/api/v1/translate", json={"text": "سلام"})
    assert response.status_code == 401
    assert response.headers["cache-control"] == "no-store"


def test_translation_preserves_paragraph_breaks() -> None:
    response = build_client().post(
        "/api/v1/translate",
        headers={"X-API-Key": API_KEY, "X-Request-ID": "test-request"},
        json={"text": "پہلی سطر\n\nدوسری سطر"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["translation"] == "English(پہلی سطر)\n\nEnglish(دوسری سطر)"
    assert payload["request_id"] == "test-request"


def test_private_urdu_speech_transcription() -> None:
    response = build_client().post(
        "/api/v1/transcribe",
        headers={"X-API-Key": API_KEY},
        files={"audio": ("recording.webm", b"private-audio", "audio/webm")},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["text"] == "یہ ایک نجی آڈیو ٹیسٹ ہے"
    assert payload["raw_text"] == "یہ ایک نجی آڈیو ٹیسٹ ہے"
    assert payload["corrected"] is False


def test_audio_type_is_restricted() -> None:
    response = build_client().post(
        "/api/v1/transcribe",
        headers={"X-API-Key": API_KEY},
        files={"audio": ("recording.exe", b"private-audio", "application/octet-stream")},
    )
    assert response.status_code == 415


def test_rate_limit_is_enforced() -> None:
    client = build_client(rate_limit=1)
    headers = {"X-API-Key": API_KEY}
    assert client.post("/api/v1/translate", headers=headers, json={"text": "سلام"}).status_code == 200
    limited = client.post("/api/v1/translate", headers=headers, json={"text": "سلام"})
    assert limited.status_code == 429
    assert "Retry-After" in limited.headers
