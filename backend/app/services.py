from __future__ import annotations

import asyncio
import io
import re
from collections.abc import Callable
from typing import Protocol

import httpx

from .config import Settings


class LineTranslator(Protocol):
    async def translate_line(self, text: str) -> str: ...


class SpeechService(Protocol):
    async def transcribe(self, audio: bytes) -> tuple[str, float | None]: ...


class SpeechSynthesizer(Protocol):
    async def synthesize(self, text: str) -> bytes: ...


class TranscriptCorrector(Protocol):
    async def correct(self, text: str) -> str: ...


# The correction model is trained mostly on Chinese/English data and
# occasionally emits CJK punctuation instead of the Urdu/Arabic equivalent
# (e.g. an ideographic full stop instead of the Arabic one). Normalize it
# away rather than trust the model to always pick the right script.
_FOREIGN_PUNCTUATION_MAP = {
    "。": "۔",  # CJK full stop -> Arabic full stop
    "，": "،",  # fullwidth comma -> Arabic comma
    "？": "؟",  # fullwidth question mark -> Arabic question mark
    "！": "!",  # fullwidth exclamation mark -> ASCII exclamation
    "；": "؛",  # fullwidth semicolon -> Arabic semicolon
}


def _normalize_punctuation(text: str) -> str:
    for foreign, correct in _FOREIGN_PUNCTUATION_MAP.items():
        text = text.replace(foreign, correct)
    return text


class ParagraphPreservingTranslator:
    """Translates content line-by-line while preserving blank lines exactly."""

    def __init__(self, provider: LineTranslator) -> None:
        self.provider = provider

    async def translate(self, text: str) -> str:
        translated: list[str] = []
        for line in text.split("\n"):
            if not line.strip():
                translated.append("")
                continue
            translated.append(await self.provider.translate_line(line))
        return "\n".join(translated)


class MarianUrduEnglishTranslator:
    def __init__(self, settings: Settings) -> None:
        self.model_name = settings.translation_model
        self.cache_dir = settings.model_cache_dir
        self._tokenizer = None
        self._model = None
        self._lock = asyncio.Lock()

    async def _ensure_loaded(self) -> None:
        if self._model is not None:
            return
        async with self._lock:
            if self._model is not None:
                return

            def load() -> tuple[object, object]:
                from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

                tokenizer = AutoTokenizer.from_pretrained(
                    self.model_name, cache_dir=self.cache_dir
                )
                model = AutoModelForSeq2SeqLM.from_pretrained(
                    self.model_name, cache_dir=self.cache_dir
                )
                model.eval()
                return tokenizer, model

            self._tokenizer, self._model = await asyncio.to_thread(load)

    async def translate_line(self, text: str) -> str:
        await self._ensure_loaded()

        def run() -> str:
            inputs = self._tokenizer(
                text,
                return_tensors="pt",
                truncation=True,
                max_length=512,
            )
            generated = self._model.generate(
                **inputs,
                num_beams=5,
                max_new_tokens=512,
                early_stopping=True,
            )
            return self._tokenizer.decode(generated[0], skip_special_tokens=True).strip()

        return await asyncio.to_thread(run)


class PrivateVLLMTranslator:
    def __init__(self, settings: Settings) -> None:
        self.base_url = settings.inference_base_url.rstrip("/")
        self.api_key = settings.inference_api_key
        self.model_name = settings.translation_model
        self.timeout = settings.request_timeout_seconds

    async def translate_line(self, text: str) -> str:
        system_prompt = (
            "You are a professional Urdu-to-English translator running inside a private "
            "environment. Translate the Urdu text into natural, fluent English. Preserve "
            "meaning, tone, intent, names, numbers, and any English words already present. "
            "Return only the English translation without notes or quotation marks."
        )
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.base_url}/v1/chat/completions",
                headers=headers,
                json={
                    "model": self.model_name,
                    "temperature": 0.1,
                    "max_tokens": 1024,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": text},
                    ],
                },
            )
            response.raise_for_status()
            payload = response.json()
            result = payload["choices"][0]["message"]["content"].strip()
            return re.sub(r"^(English translation:|Translation:)\s*", "", result, flags=re.I)


class FasterWhisperSpeechService:
    def __init__(self, settings: Settings) -> None:
        self.model_name = settings.speech_model
        self.device = settings.speech_device
        self.compute_type = settings.speech_compute_type
        self.cache_dir = settings.model_cache_dir
        self._model = None
        self._lock = asyncio.Lock()

    async def _ensure_loaded(self) -> None:
        if self._model is not None:
            return
        async with self._lock:
            if self._model is not None:
                return

            def load():
                from faster_whisper import WhisperModel

                return WhisperModel(
                    self.model_name,
                    device=self.device,
                    compute_type=self.compute_type,
                    download_root=self.cache_dir,
                )

            self._model = await asyncio.to_thread(load)

    async def transcribe(self, audio: bytes) -> tuple[str, float | None]:
        await self._ensure_loaded()

        def run() -> tuple[str, float | None]:
            segments, info = self._model.transcribe(
                io.BytesIO(audio),
                language="ur",
                beam_size=5,
                vad_filter=True,
                condition_on_previous_text=True,
            )
            text = " ".join(segment.text.strip() for segment in segments).strip()
            return text, getattr(info, "duration", None)

        return await asyncio.to_thread(run)


class MMSUrduSpeechSynthesizer:
    def __init__(self, settings: Settings) -> None:
        self.model_name = settings.speech_synthesis_model
        self.cache_dir = settings.model_cache_dir
        self._tokenizer = None
        self._model = None
        self._lock = asyncio.Lock()

    async def _ensure_loaded(self) -> None:
        if self._model is not None:
            return
        async with self._lock:
            if self._model is not None:
                return

            def load() -> tuple[object, object]:
                from transformers import AutoTokenizer, VitsModel

                tokenizer = AutoTokenizer.from_pretrained(
                    self.model_name, cache_dir=self.cache_dir
                )
                model = VitsModel.from_pretrained(
                    self.model_name, cache_dir=self.cache_dir
                )
                model.eval()
                return tokenizer, model

            self._tokenizer, self._model = await asyncio.to_thread(load)

    async def synthesize(self, text: str) -> bytes:
        await self._ensure_loaded()

        def run() -> bytes:
            import wave

            import numpy as np
            import torch

            inputs = self._tokenizer(text, return_tensors="pt")
            with torch.no_grad():
                waveform = self._model(**inputs).waveform

            audio = np.clip(waveform.squeeze().cpu().numpy(), -1.0, 1.0)
            pcm = (audio * 32767).astype(np.int16)

            buffer = io.BytesIO()
            with wave.open(buffer, "wb") as wav_file:
                wav_file.setnchannels(1)
                wav_file.setsampwidth(2)
                wav_file.setframerate(self._model.config.sampling_rate)
                wav_file.writeframes(pcm.tobytes())
            return buffer.getvalue()

        return await asyncio.to_thread(run)


def build_translation_service(settings: Settings) -> ParagraphPreservingTranslator:
    provider: LineTranslator
    if settings.translation_provider == "vllm":
        provider = PrivateVLLMTranslator(settings)
    else:
        provider = MarianUrduEnglishTranslator(settings)
    return ParagraphPreservingTranslator(provider)


def build_speech_service(settings: Settings) -> SpeechService:
    return FasterWhisperSpeechService(settings)


def build_speech_synthesizer(settings: Settings) -> SpeechSynthesizer:
    return MMSUrduSpeechSynthesizer(settings)


class OllamaGrammarCorrector:
    """Best-effort Urdu grammar/punctuation correction via a local Ollama model.

    Not guaranteed correct - the model can miss real mistakes (verified in manual
    testing). Callers must treat failures as non-fatal and fall back to the raw
    transcript rather than block on this.
    """

    _SYSTEM_PROMPT = (
        "You are an Urdu grammar and punctuation corrector. Fix grammar and "
        "punctuation mistakes in the given Urdu text. Do not translate, do not "
        "change the meaning, do not add or remove information. Use only Urdu/Arabic "
        "script punctuation (۔ for full stop, ، for comma, ؟ for "
        "question mark) - never Chinese, Japanese, or other foreign punctuation "
        "marks. Return only the corrected Urdu text with no notes or quotation marks."
    )

    def __init__(self, settings: Settings) -> None:
        self.base_url = settings.grammar_correction_base_url.rstrip("/")
        self.model_name = settings.grammar_correction_model
        self.timeout = settings.request_timeout_seconds

    async def correct(self, text: str) -> str:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.base_url}/api/chat",
                json={
                    "model": self.model_name,
                    "stream": False,
                    # num_gpu=0 forces CPU-only: this model crashes the local
                    # GPU runtime on low-VRAM hardware (verified in manual testing).
                    "options": {"num_gpu": 0, "temperature": 0.1},
                    "messages": [
                        {"role": "system", "content": self._SYSTEM_PROMPT},
                        {"role": "user", "content": text},
                    ],
                },
            )
            response.raise_for_status()
            payload = response.json()
            corrected = payload["message"]["content"].strip()
            return _normalize_punctuation(corrected)


def build_transcript_corrector(settings: Settings) -> TranscriptCorrector | None:
    if not settings.enable_transcript_correction:
        return None
    return OllamaGrammarCorrector(settings)


class StubLineTranslator:
    """Small deterministic provider used only by automated tests."""

    def __init__(self, transform: Callable[[str], str] | None = None) -> None:
        self.transform = transform or (lambda value: f"translated:{value}")

    async def translate_line(self, text: str) -> str:
        return self.transform(text)
