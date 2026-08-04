from __future__ import annotations

import ipaddress
import os
from dataclasses import dataclass
from urllib.parse import urlparse

from dotenv import load_dotenv

# Loads backend/.env when present (e.g. `uvicorn app.main:app` run directly,
# outside Docker). Docker Compose injects environment variables itself, so
# this is a no-op in that path since no .env file exists in the container.
load_dotenv()


def _as_bool(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


def _as_list(name: str, default: str) -> tuple[str, ...]:
    return tuple(item.strip() for item in os.getenv(name, default).split(",") if item.strip())


@dataclass(frozen=True, slots=True)
class Settings:
    environment: str = os.getenv("ENVIRONMENT", "production")
    api_key: str = os.getenv("TRANSLATION_API_KEY", "")
    translation_provider: str = os.getenv("TRANSLATION_PROVIDER", "marian").lower()
    translation_model: str = os.getenv(
        "TRANSLATION_MODEL", "Helsinki-NLP/opus-mt-ur-en"
    )
    inference_base_url: str = os.getenv("INFERENCE_BASE_URL", "http://model:8000")
    inference_api_key: str = os.getenv("INFERENCE_API_KEY", "local-private-model")
    allow_public_inference_url: bool = _as_bool("ALLOW_PUBLIC_INFERENCE_URL", False)
    max_characters: int = int(os.getenv("MAX_CHARACTERS", "5000"))
    max_audio_bytes: int = int(os.getenv("MAX_AUDIO_BYTES", str(15 * 1024 * 1024)))
    request_timeout_seconds: float = float(os.getenv("REQUEST_TIMEOUT_SECONDS", "45"))
    rate_limit_requests: int = int(os.getenv("RATE_LIMIT_REQUESTS", "30"))
    rate_limit_window_seconds: int = int(os.getenv("RATE_LIMIT_WINDOW_SECONDS", "60"))
    require_https: bool = _as_bool("REQUIRE_HTTPS", True)
    cors_origins: tuple[str, ...] = _as_list(
        "CORS_ORIGINS", "https://translator.example.com"
    )
    trusted_hosts: tuple[str, ...] = _as_list(
        "TRUSTED_HOSTS", "translator.example.com,api,localhost,127.0.0.1"
    )
    speech_model: str = os.getenv("SPEECH_MODEL", "small")
    speech_device: str = os.getenv("SPEECH_DEVICE", "cpu")
    speech_compute_type: str = os.getenv("SPEECH_COMPUTE_TYPE", "int8")
    speech_synthesis_model: str = os.getenv(
        "SPEECH_SYNTHESIS_MODEL", "facebook/mms-tts-urd-script_arabic"
    )
    enable_transcript_correction: bool = _as_bool("ENABLE_TRANSCRIPT_CORRECTION", True)
    grammar_correction_base_url: str = os.getenv(
        "GRAMMAR_CORRECTION_BASE_URL", "http://localhost:11434"
    )
    grammar_correction_model: str = os.getenv(
        "GRAMMAR_CORRECTION_MODEL", "qwen2.5:7b-instruct"
    )
    model_cache_dir: str = os.getenv("MODEL_CACHE_DIR", "/models")
    expose_docs: bool = _as_bool("EXPOSE_API_DOCS", False)

    def validate(self) -> None:
        if self.environment != "test" and len(self.api_key) < 32:
            raise ValueError("TRANSLATION_API_KEY must be at least 32 characters.")
        if self.translation_provider not in {"marian", "vllm"}:
            raise ValueError("TRANSLATION_PROVIDER must be 'marian' or 'vllm'.")
        if self.translation_provider == "vllm" and not self.allow_public_inference_url:
            ensure_private_url(self.inference_base_url)
        if self.max_characters < 100 or self.max_characters > 50_000:
            raise ValueError("MAX_CHARACTERS must be between 100 and 50000.")


def ensure_private_url(value: str) -> None:
    parsed = urlparse(value)
    hostname = (parsed.hostname or "").lower()
    if parsed.scheme not in {"http", "https"} or not hostname:
        raise ValueError("INFERENCE_BASE_URL must be a valid HTTP(S) URL.")

    if hostname in {"localhost", "model", "vllm"} or hostname.endswith(
        (".local", ".internal", ".svc", ".svc.cluster.local")
    ):
        return

    try:
        if ipaddress.ip_address(hostname).is_private:
            return
    except ValueError:
        pass

    raise ValueError(
        "INFERENCE_BASE_URL must resolve to a private host unless "
        "ALLOW_PUBLIC_INFERENCE_URL=true is explicitly set."
    )
