from __future__ import annotations

import time
import uuid
from contextlib import asynccontextmanager

import httpx
from fastapi import Depends, FastAPI, File, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware

from .config import Settings
from .schemas import (
    HealthResponse,
    SpeakRequest,
    TranscribeResponse,
    TranslateRequest,
    TranslateResponse,
)
from .security import (
    RateLimitMiddleware,
    RequireHTTPSMiddleware,
    SecurityHeadersMiddleware,
    api_key_dependency,
)
from .services import (
    ParagraphPreservingTranslator,
    SpeechService,
    SpeechSynthesizer,
    TranscriptCorrector,
    build_speech_service,
    build_speech_synthesizer,
    build_transcript_corrector,
    build_translation_service,
)


def create_app(
    settings: Settings | None = None,
    translator: ParagraphPreservingTranslator | None = None,
    speech_service: SpeechService | None = None,
    speech_synthesizer: SpeechSynthesizer | None = None,
    transcript_corrector: TranscriptCorrector | None = None,
) -> FastAPI:
    settings = settings or Settings()
    settings.validate()
    translator = translator or build_translation_service(settings)
    speech_service = speech_service or build_speech_service(settings)
    speech_synthesizer = speech_synthesizer or build_speech_synthesizer(settings)
    if transcript_corrector is None:
        transcript_corrector = build_transcript_corrector(settings)
    verify_api_key = api_key_dependency(settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        # Models intentionally load lazily so health checks remain lightweight.
        yield

    app = FastAPI(
        title="Dastaan AI API",
        version="1.0.0",
        description="Private Urdu speech transcription and English translation.",
        docs_url="/docs" if settings.expose_docs else None,
        redoc_url=None,
        openapi_url="/openapi.json" if settings.expose_docs else None,
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(
        RateLimitMiddleware,
        limit=settings.rate_limit_requests,
        window_seconds=settings.rate_limit_window_seconds,
    )
    app.add_middleware(RequireHTTPSMiddleware, enabled=settings.require_https)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(settings.trusted_hosts))
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "X-API-Key", "X-Request-ID"],
    )

    @app.middleware("http")
    async def request_id_middleware(request: Request, call_next):
        request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response

    @app.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        return HealthResponse(translation_provider=settings.translation_provider)

    @app.post(
        "/api/v1/translate",
        response_model=TranslateResponse,
        dependencies=[Depends(verify_api_key)],
    )
    async def translate(payload: TranslateRequest, request: Request) -> TranslateResponse:
        if len(payload.text) > settings.max_characters:
            raise HTTPException(
                status_code=413,
                detail=f"Text exceeds the {settings.max_characters}-character limit.",
            )

        started = time.perf_counter()
        try:
            result = await translator.translate(payload.text)
        except httpx.TimeoutException as error:
            raise HTTPException(status_code=504, detail="Private model timed out.") from error
        except Exception as error:
            raise HTTPException(
                status_code=502, detail="Private translation model failed."
            ) from error

        if not result.strip():
            raise HTTPException(status_code=502, detail="Private model returned no text.")

        return TranslateResponse(
            translation=result,
            provider=settings.translation_provider,
            processing_ms=round((time.perf_counter() - started) * 1000),
            request_id=request.state.request_id,
        )

    @app.post(
        "/api/v1/transcribe",
        response_model=TranscribeResponse,
        dependencies=[Depends(verify_api_key)],
    )
    async def transcribe(
        request: Request,
        audio: UploadFile = File(...),
    ) -> TranscribeResponse:
        allowed_types = {
            "audio/webm",
            "audio/ogg",
            "audio/wav",
            "audio/x-wav",
            "audio/mpeg",
            "audio/mp4",
        }
        content_type = (audio.content_type or "").split(";")[0]
        if content_type not in allowed_types:
            raise HTTPException(status_code=415, detail="Unsupported audio format.")

        data = await audio.read(settings.max_audio_bytes + 1)
        await audio.close()
        if not data:
            raise HTTPException(status_code=422, detail="Audio recording is empty.")
        if len(data) > settings.max_audio_bytes:
            raise HTTPException(status_code=413, detail="Audio recording exceeds 15 MB.")

        started = time.perf_counter()
        try:
            text, duration = await speech_service.transcribe(data)
        except Exception as error:
            raise HTTPException(
                status_code=502, detail="Private speech recognition failed."
            ) from error

        if not text:
            raise HTTPException(status_code=422, detail="No Urdu speech was detected.")

        corrected_text = text
        corrected = False
        if transcript_corrector is not None:
            try:
                corrected_text = await transcript_corrector.correct(text)
                corrected = True
            except Exception:
                corrected_text = text
                corrected = False

        return TranscribeResponse(
            text=corrected_text,
            raw_text=text,
            corrected=corrected,
            duration_seconds=duration,
            processing_ms=round((time.perf_counter() - started) * 1000),
            request_id=request.state.request_id,
        )

    @app.post(
        "/api/v1/speak",
        dependencies=[Depends(verify_api_key)],
    )
    async def speak(payload: SpeakRequest, request: Request) -> Response:
        if len(payload.text) > settings.max_characters:
            raise HTTPException(
                status_code=413,
                detail=f"Text exceeds the {settings.max_characters}-character limit.",
            )

        try:
            audio = await speech_synthesizer.synthesize(payload.text)
        except Exception as error:
            raise HTTPException(
                status_code=502, detail="Private speech synthesis failed."
            ) from error

        return Response(
            content=audio,
            media_type="audio/wav",
            headers={"X-Request-ID": request.state.request_id},
        )

    return app


app = create_app()
