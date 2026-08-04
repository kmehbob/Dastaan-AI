from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class TranslateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)

    text: str = Field(min_length=1)
    source_language: Literal["ur"] = "ur"
    target_language: Literal["en"] = "en"

    @field_validator("text")
    @classmethod
    def text_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Text must not be blank.")
        return value


class TranslateResponse(BaseModel):
    translation: str
    source_language: Literal["ur"] = "ur"
    target_language: Literal["en"] = "en"
    provider: str
    processing_ms: int
    request_id: str


class TranscribeResponse(BaseModel):
    text: str
    raw_text: str
    corrected: bool = False
    language: Literal["ur"] = "ur"
    duration_seconds: float | None = None
    processing_ms: int
    request_id: str


class SpeakRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)

    text: str = Field(min_length=1)
    language: Literal["ur"] = "ur"

    @field_validator("text")
    @classmethod
    def text_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Text must not be blank.")
        return value


class HealthResponse(BaseModel):
    status: Literal["ready"] = "ready"
    translation_provider: str
    speech_provider: str = "faster-whisper"
    speech_synthesis_provider: str = "mms-tts"
    data_retention: Literal["none"] = "none"
