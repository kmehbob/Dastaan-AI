# Project Structure, Features & Scope-of-Work Compliance

This document inventories everything currently built across the three parts of this
repository and maps it against the client Scope of Work ("AI Translation Feature
(Urdu to English)"). Status is reported honestly, including open gaps - several
items below are **not** fully met yet and need a decision or further work before
this can be called production-ready.

## 1. Repository structure

```
Tarjuma-Private-Project/
├── app/                          # Main Next.js web application ("Dastaan AI")
│   ├── api/
│   │   ├── health/route.ts       # Proxies GET /health from the private backend
│   │   ├── transcribe/route.ts   # Proxies POST /api/v1/transcribe (audio -> Urdu text)
│   │   ├── translate/route.ts    # Proxies POST /api/v1/translate (Urdu -> English)
│   │   └── speak/route.ts        # Proxies POST /api/v1/speak (Urdu text -> speech)
│   ├── layout.tsx
│   └── page.tsx                  # The whole UI: top nav, book workspace, voice dictation
│                                  # overlay (record -> review -> insert), translate, listen,
│                                  # copy, toast notifications
│
├── backend/                      # Private FastAPI gateway (the actual AI service)
│   ├── app/
│   │   ├── config.py             # All settings, env-driven, no secrets hard-coded;
│   │   │                         # auto-loads backend/.env via python-dotenv
│   │   ├── main.py               # Routes: /health, /api/v1/{translate,transcribe,speak}
│   │   ├── schemas.py            # Request/response models (pydantic)
│   │   ├── security.py           # API key auth, rate limit, HTTPS, security headers
│   │   └── services.py           # Model adapters (translation, STT, TTS, correction)
│   ├── .env.example              # Template for local (non-Docker) runs
│   └── tests/                    # 13 automated tests (pytest), all passing
│
├── docker-compose.yml             # CPU profile (Marian translation, Faster Whisper)
├── docker-compose.gpu.yml         # GPU profile (private vLLM translation server)
└── docs/
    ├── ARCHITECTURE.md            # High-level component/data-flow doc
    ├── SECURITY.md                # Security controls + production checklist
    └── SCOPE_OF_WORK_COMPLIANCE.md  # This file
```

> **Note:** the standalone `legacy-recorder/` mini-app (a separate Express server
> that only recorded/transcribed/spoke Urdu, with no translation UI) has been
> removed. Its one feature that `app/` lacked - text-to-speech playback of Urdu
> text via the backend's `/api/v1/speak` endpoint - is now wired into `app/`
> directly (see the "Listen" button next to the Urdu editor, and `app/api/speak/route.ts`).

## 2. Components & features

### 2.1 Main application (`app/`)

| Feature | Where | Status |
| --- | --- | --- |
| Type Urdu directly | `page.tsx` editable Urdu panel | Working |
| Record Urdu speech (mic → text) | `page.tsx` voice dictation overlay (`startDictation` → `/api/transcribe` → backend `/api/v1/transcribe`), with a live waveform, pause/resume, and elapsed timer | Working |
| Editable transcript review before inserting | Dictation overlay shows the transcribed text in an editable, RTL preview (`draftTranscript`); the user explicitly discards or selects "Insert into manuscript" (`insertTranscript`) rather than it being appended automatically | Working |
| Best-effort Urdu grammar/punctuation auto-correction | Backend-side (see §2.2); surfaces automatically since the frontend just displays whatever `text` the backend returns | Working, best-effort (see §3.1) |
| Translate Urdu → English | "Translate" button, Ctrl+Enter shortcut → `/api/translate` → backend `/api/v1/translate` | Working, quality caveat (see §3.1) |
| Independent copy of Urdu / English | Separate "Copy" buttons on each panel | Working |
| Loading / notification / offline states | `isTranslating`, `dictationPhase`, `isSpeaking`, `modelState`; failures surface as an auto-dismissing toast notification (`toast`/`showToast`), not an inline banner | Working |
| Preserve paragraphs/line breaks | Backend `ParagraphPreservingTranslator` (translates line-by-line, keeps blank lines) | Working |
| Text-to-speech playback (listen to Urdu text) | "Listen" icon button next to the Urdu editor → `/api/speak` → backend `/api/v1/speak` | Working |

### 2.2 Private backend (`backend/`)

| Endpoint | Purpose | Model | Notes |
| --- | --- | --- | --- |
| `GET /health` | Readiness/config status | - | No auth required |
| `POST /api/v1/translate` | Urdu → English | `Helsinki-NLP/opus-mt-ur-en` (Marian, default) or a self-hosted LLM via vLLM/Ollama (`TRANSLATION_PROVIDER=vllm`) | See §3.1 for the natural-vs-literal tradeoff |
| `POST /api/v1/transcribe` | Urdu audio → Urdu text | `faster-whisper` ("small") | Returns `text` (corrected), `raw_text` (unmodified ASR), `corrected` (bool) |
| `POST /api/v1/speak` | Urdu text → speech | `facebook/mms-tts-urd-script_arabic` (Meta MMS-TTS) | Single voice, no speed control (see §3.1) |

Cross-cutting: API-key auth (constant-time compare), rate limiting, CORS/trusted-host
allowlists, `REQUIRE_HTTPS` enforcement middleware, hardened response headers,
no request-content logging or persistence. All model adapters are swappable via
environment variables without touching route code (`build_translation_service`,
`build_speech_service`, `build_speech_synthesizer`, `build_transcript_corrector`
in `services.py`).

## 3. Scope-of-Work compliance

### 3.1 Functional requirements

| Requirement | Status | Notes |
| --- | --- | --- |
| Type or speak Urdu | ✅ Met | `app/` |
| Transcribe speech to Urdu text | ✅ Met | `faster-whisper`, fully private |
| "Translate to English" button | ✅ Met | Present in `app/` |
| Grammatically correct | ⚠️ Partial | Marian (default) produces standard, largely correct MT output but does no post-hoc grammar QA of its own English output. A separate best-effort *Urdu-side* grammar corrector was added for transcription, but nothing currently proofreads the *English translation* output |
| Context aware | ❌ Gap | `ParagraphPreservingTranslator` translates line-by-line; each line is translated independently with no cross-sentence context |
| Natural sounding, not literal | ❌ Gap by default | The default provider (Marian) is a literal, direct NMT model - the UI even labels the output panel "Natural literary voice," which overstates what it currently delivers. A general-purpose LLM natural-translation path exists (`TRANSLATION_PROVIDER=vllm` via Ollama, `qwen2.5:7b-instruct`) but **our own testing found it unreliable for Urdu on the available hardware** - it hallucinated unrelated sentences for simple, unambiguous Urdu input (e.g. "My name is Ali" → "The moon is bright tonight"). It is implemented but intentionally not the default because of this. See §3.1a for an Urdu-specialized candidate that may close this gap, not yet evaluated here |
| Preserve meaning, tone, intent | ⚠️ Partial | Generally true for Marian on straightforward sentences; tone/register nuance is limited compared to what an LLM could offer, and is exactly what fails when the LLM path hallucinates |
| Separate output areas, Urdu preserved | ✅ Met | |
| Independent copy of both outputs | ✅ Met | |

### 3.1a Candidate for the natural-translation gap: `qwen2.5-7b-urdu-v3` (not yet evaluated)

> **Provenance note:** everything in this subsection comes from external research
> the client supplied, not from testing performed in this project. Figures like
> "97% win rate" and "$5-6 training cost" are the model author's own reported
> claims and have **not** been independently verified here. Treat this as a
> candidate to evaluate, not a validated result.

Our own hallucination findings above were against `Qwen/Qwen2.5-7B-Instruct`
(the general-purpose base model). `qwen2.5-7b-urdu-v3` is a different artifact: a
~154 MB QLoRA **adapter** on top of that same base, fine-tuned by a third party
(Muhammad Tayyab) specifically for Urdu-English translation and explicitly
trained on code-mixed Urdu/English text. Because it's a different (fine-tuned)
model, it is not automatically subject to the same hallucination failures we
measured against the vanilla base model - but that also hasn't been checked, so
this needs the same adversarial testing (short sentences, long paragraphs,
conversational/formal register, code-mixed input) before it's trusted with real
transcripts.

**Hardware comparison against what's actually in this deployment (NVIDIA MX330,
2GB VRAM):**

| Model | Precision | Minimum GPU VRAM | Context window | Fits current hardware? |
| --- | --- | --- | --- | --- |
| Qwen2.5-7B-Instruct | BF16/FP16 | 24GB (RTX 3090) | up to 128K | ❌ No |
| Qwen2.5-7B-Instruct | Int8 | 10-12GB (RTX 3080) | up to 128K | ❌ No |
| Qwen2.5-7B-Instruct | Int4 | 8GB (RTX 3070) | up to 128K | ❌ No |
| Qwen2.5-14B-Instruct | BF16/FP16 | 40GB (A100) | up to 128K | ❌ No |
| Qwen2.5-14B-Instruct | Int4/Int8 | 24GB (RTX 3090) | up to 128K | ❌ No |
| **`qwen2.5-7b-urdu-v3`** (adapter) | 4-bit (NF4) | **8-12GB** (RTX 3070/3080) | 4096 tokens | ❌ No |

**Bottom line for this deployment:** even the lightest option in this table still
needs 4-6x the VRAM this machine's GPU has. Running it here would mean CPU-only
inference (same constraint we already hit with the generic 7B model, and the
same reason that model had to run CPU-only after crashing this GPU) - so the
~10-25s response times we measured for the generic model are the realistic
expectation here too, not the faster GPU numbers in the table above. Getting
GPU-accelerated "natural" translation at the quality this table implies requires
either a hardware upgrade (RTX 3070 or better) or renting cloud GPU capacity for
inference - both are infrastructure decisions the client needs to make, not
something resolved by picking a different model file.

**Suggested software stack if this is pursued** (also from the client's
research, not yet set up in this repo): load via
[Unsloth](https://github.com/unslothai/unsloth)'s `FastLanguageModel` in 4-bit
(the adapter was calibrated against a 4-bit base, and Unsloth reports ~2x
inference speed over plain `transformers`/`peft` loading), Python 3.10 + CUDA
12.2 + matching PyTorch on Linux (Ubuntu 22.04 recommended over Windows for
GPU workload stability), served behind the same API-key-authenticated,
TLS-terminated gateway pattern already implemented in `backend/`.

### 3.1b Additional candidates: Whisper (ASR) + NLLB-200 (translation)

> **Provenance note:** as with §3.1a, the comparative claims below (e.g. the
> specific "~44% improvement" figure) come from external research supplied for
> this review, not from testing performed in this project. Treat them as a
> starting point for evaluation, not a validated result.

| Component | Recommended model | Key advantage | Status here |
| --- | --- | --- | --- |
| Transcription (ASR) | Whisper | Best balance of accuracy and efficiency for conversational Urdu, proven on limited hardware | **Already in place** - `faster-whisper` (§2.2) is a CTranslate2 reimplementation of OpenAI Whisper, not a different model |
| Translation | NLLB-200 (Meta) | Purpose-built for low-resource languages including Urdu; reported to outperform literal MT models on naturalness | **Not integrated** - see feasibility below |

**Transcription:** the ASR half of this recommendation is effectively already
satisfied. `SPEECH_MODEL` (`backend/app/config.py`) already accepts any
faster-whisper size - `tiny`, `base`, `small` (current default), `medium`,
`large-v3` - and `SPEECH_DEVICE`/`SPEECH_COMPUTE_TYPE` already default to
`cpu`/`int8` (`docker-compose.yml`). If the 2GB VRAM budget is a hard
constraint, dropping to `SPEECH_MODEL=tiny` or `base` is a config change, not
new code. Avoid models optimized for read speech (e.g. `seamless-large`) for
this use case - they underperform Whisper-family models on conversational,
informal dialogue.

**Translation:** NLLB-200 is a closer fit than it first appears, but it is
**not a drop-in config change** like switching Marian model IDs would be.
`MarianUrduEnglishTranslator` (`backend/app/services.py`) already loads its
model via generic `AutoModelForSeq2SeqLM`/`AutoTokenizer`, which NLLB-200
checkpoints are compatible with - but NLLB is a single multilingual model, not
a language-pair-specific one like Marian, so it needs source/target language
codes set explicitly (`src_lang="urd_Arab"` and a forced BOS token for
`eng_Latn`) that the current adapter doesn't set. Supporting it would mean a
small, contained code change to that one class, not a new architecture.
`translation_provider` in `config.py` is also currently validated to only
`"marian"` or `"vllm"` and would need a third option (or NLLB could simply be
loaded through the existing `"marian"` path once it handles language codes,
since the loader itself is already generic).

NLLB-200 also isn't one fixed size: Meta released it as distilled 600M/1.3B/
3.3B dense checkpoints as well as a 54.5B-parameter mixture-of-experts model.
The 54B MoE variant is what's out of reach on this hardware (same VRAM
argument as §3.1a); the 600M-1.3B distilled variants are much closer to
Marian's footprint and CPU-friendly, and would be the realistic starting
point for local evaluation rather than the largest checkpoint. The existing
`Helsinki-NLP/opus-mt-ur-en` (Marian) stays available as the CPU-friendly,
already-working fallback regardless of what happens with NLLB.

**If cloud hosting is preferred instead of a code change:** run transcription
locally (already private, already working) and route only translation to a
hosted NLLB-200 endpoint via the existing `vllm`/`INFERENCE_BASE_URL` path
(§2.2) - this needs `ALLOW_PUBLIC_INFERENCE_URL` and the associated trust
tradeoff called out in §3.2's "Encrypted communication" and "Self-hosted"
rows, since content would then leave the local deployment.

**Decision framing for §4 item 1** (the natural-vs-literal tradeoff), restated
with this option included:

1. **Accept literal, deploy now** - keep Marian as-is. Works on the existing
   2GB-VRAM hardware and meets the core functional requirements; the
   "naturalness" gap remains, and the UI's "Natural Translation" label should
   be corrected to avoid overstating it (already flagged in §3.1).
2. **Cloud hybrid** - keep Marian local for routine, low-latency translation,
   and selectively route to a hosted NLLB-200 (or the `qwen2.5-7b-urdu-v3`
   path from §3.1a) when higher-quality output is worth the added latency and
   the privacy tradeoff of leaving the local deployment.
3. **Hardware upgrade** - an RTX 3070-class GPU or better would allow
   `whisper-large` and either a distilled NLLB-200 checkpoint or the
   `qwen2.5-7b-urdu-v3` adapter (§3.1a) to run fully locally, closing the
   naturalness gap without a cloud dependency. This is the same hardware
   conclusion §3.1a already reaches, now with NLLB-200 as an additional
   candidate for that upgraded hardware rather than only the Qwen adapter.

### 3.2 AI, hosting & security requirements

| Requirement | Status | Notes |
| --- | --- | --- |
| No OpenAI APIs/services | ✅ Met | Confirmed: no OpenAI calls anywhere in translation, transcription, or speech synthesis. The previously-flagged unused `app/chatgpt-auth.ts` (a dead "Sign in with ChatGPT" identity-header reader, never wired into any route or page) has been removed |
| Closed/private AI model | ✅ Met | Marian, faster-whisper, MMS-TTS, and the optional Ollama/Qwen model are all open-weight models running entirely locally |
| Self-hosted on own/private infra | ⚠️ Partial | Fully self-hosted *in principle* (Docker Compose profiles exist for CPU and GPU deployment) - but as of this document, everything has only been run and verified on a local development machine. No deployment to actual production/private-cloud infrastructure has happened yet |
| No public shared AI services | ✅ Met | |
| Data privacy / not used for AI training | ✅ Met | No request logging or persistence anywhere in the stack (documented in `SECURITY.md`) |
| Encrypted communication | ⚠️ Partial | The app supports enforcing HTTPS (`REQUIRE_HTTPS`) and rejects public inference URLs by default, but the current local setup runs over plain HTTP (`REQUIRE_HTTPS=false`). TLS termination at a reverse proxy/ingress is a documented pre-production step (`SECURITY.md`) that has **not** been done yet |
| Secure API authentication | ✅ Met | Long API key, constant-time comparison (`hmac.compare_digest`), required on every AI endpoint |
| Industry best-practice data security | ⚠️ Mostly met | Rate limiting, CORS/trusted-host allowlists, security headers, input validation, no error detail leakage are all implemented; a formal security review/penetration test has not been performed |

### 3.3 Performance requirements

| Requirement | Status | Notes |
| --- | --- | --- |
| Translation in a few seconds | ✅ Met (default Marian path) | Measured: 165ms-4s per request, including cold model load |
| ...but only on the default path | ⚠️ Caveat | If switched to the "natural" LLM path (Ollama/Qwen), response time was 10-25s in testing on this hardware, and it must run CPU-only because the available 2GB-VRAM GPU crashes running that model. Natural-sounding output and multi-second responses are currently a direct tradeoff on this hardware, not something that can be had for free |
| Short sentences / long paragraphs / conversational / formal / mixed Urdu-English | ⚠️ Structurally supported, not linguistically validated | Up to 5,000 characters per request, paragraph structure preserved. No dedicated test corpus covering all these registers has been run - this is the same gap `SECURITY.md` already calls out as a pre-launch requirement ("human-reviewed Urdu translation quality test suite") |

### 3.4 User experience

| Requirement | Status |
| --- | --- |
| One-tap translation | ✅ Met |
| Loading indicator during translation | ✅ Met ("Translating…" state, animated loading panel) |
| Clear error message on failure | ✅ Met (distinct messages for timeout, unconfigured, unavailable, rate-limited, surfaced as an auto-dismissing toast notification rather than inline page content) |
| Preserve original formatting/paragraphs/line breaks | ✅ Met |

### 3.5 Deliverables

| Deliverable | Status |
| --- | --- |
| Urdu→English translation integrated into the bot | ✅ Met (in `app/`) |
| Self-hosted private AI translation service | ✅ Met, locally verified; not yet deployed anywhere else |
| Secure backend implementation | ⚠️ Mostly met | TLS/production hardening steps in `SECURITY.md` are still outstanding |
| End-to-end testing and QA | ⚠️ Partial | 13 automated backend tests pass (auth, rate limiting, translation, transcription). No human-reviewed Urdu linguistic QA suite, no load testing yet |
| Deployment to production environment | ❌ Not done | Everything documented here has only run in a local development environment |

## 4. Recommended next steps (priority order)

1. **Decide the natural-vs-literal translation tradeoff.** Either accept Marian's literal style as "good enough," evaluate the `qwen2.5-7b-urdu-v3` adapter from §3.1a or NLLB-200 from §3.1b (both need their own adversarial testing before trusting them, and the larger checkpoints still don't fit this machine's 2GB VRAM), or scope a human-reviewed fallback (e.g., flag low-confidence translations for review) - the SOW's "natural sounding" requirement is not met by the safe default today. See §3.1b for a concrete three-path decision framing (accept literal / cloud hybrid / hardware upgrade).
2. **Stand up production infrastructure and TLS**, following the steps already in `docs/SECURITY.md`.
3. **Run a real Urdu linguistic QA pass** (native-speaker-reviewed) across short/long/formal/conversational/mixed-language samples before calling this launch-ready.

## 5. Product expansion: Dastaan AI for novelists

The SOW above scopes a translation utility. Everything in this section is a
**proposal, not a commitment** - none of it has been built, and it goes well
beyond the original "AI Translation Feature (Urdu to English)" SOW. It's
recorded here because it reframes the same private Urdu↔English pipeline as
the foundation of a dedicated literary tool, and several items are natural,
low-effort extensions of what already exists (§2.1/§2.2) rather than new
infrastructure.

Dastaan AI can be developed as a private Urdu writing and literary translation
workspace designed specifically for novelists, storytellers, screenwriters,
and authors.

### 5.1 Core features already available

These map directly to the working features in §2.1 - reframed for a literary
audience, not new work:

* **Urdu voice dictation** - authors can narrate scenes, dialogue, or ideas in
  Urdu and automatically convert speech into editable Urdu text.
* **Direct Urdu writing** - write and edit Urdu directly inside the
  application using a clean, distraction-free editor.
* **Urdu-to-English translation** - translate Urdu chapters, scenes, and
  dialogue into English while keeping the original Urdu text preserved.
* **Side-by-side writing view** - the original Urdu and translated English are
  shown in separate panels for easy comparison and editing.
* **Paragraph and formatting preservation** - paragraph breaks, dialogue
  structure, and line spacing are maintained during translation.
* **Independent copying** - copy Urdu or English text separately with one
  click.
* **Urdu text-to-speech** - listen to written Urdu to catch awkward sentences,
  missing words, or dialogue that doesn't sound natural.
* **Private and self-hosted AI** - manuscripts remain on private
  infrastructure and are not submitted to public AI services or used for
  model training.

### 5.2 Novel-writing features that could be added

None of the following exist in this repository today. They are grouped by
theme, in roughly the order they'd add value to a novelist.

#### 5.2.1 Literary translation modes

Authors could choose how their writing should be translated:

* **Faithful translation** - closely preserves the original meaning.
* **Natural translation** - produces fluent, natural English.
* **Literary translation** - focuses on emotion, imagery, rhythm, and
  storytelling.
* **Dialogue translation** - keeps conversations natural and
  character-specific.
* **Formal or classical style** - suitable for historical and traditional
  writing.

#### 5.2.2 Writing and editing tools

* Urdu grammar, spelling, and punctuation correction
* English translation proofreading
* Sentence improvement suggestions
* Rewriting without changing the original meaning
* Shorten, expand, simplify, or enrich selected passages
* Improve dialogue flow
* Strengthen emotional descriptions
* Remove repeated words and phrases
* Detect overly long or unclear sentences

#### 5.2.3 Novel and chapter management

* Create multiple novels and writing projects
* Organize manuscripts by chapters and scenes
* Rename, reorder, duplicate, or archive chapters
* Automatic draft saving
* Version history and previous-draft restoration
* Search and replace across the entire manuscript
* Word, paragraph, chapter, and page counts
* Daily and overall writing goals

#### 5.2.4 Character and story management

* **Character profiles** - names, appearance, personality, relationships, and
  background
* **Character voice profiles** - preserve how each character speaks
* **Location and world notes** - track cities, places, cultures, and
  fictional settings
* **Timeline management** - organize events in chronological order
* **Continuity checking** - detect inconsistent names, ages, dates,
  relationships, or events
* **Plot and scene tracking** - record the purpose and status of each scene

#### 5.2.5 Translation consistency

* Create a custom glossary for character names, places, cultural terms, and
  recurring phrases
* Lock selected names and words so they are never translated incorrectly
* Maintain the same translation across every chapter
* Compare original, translated, and revised versions
* Highlight uncertain or potentially inaccurate translations
* Add translator notes for idioms and cultural expressions

#### 5.2.6 AI writing assistance

* Generate chapter or scene summaries
* Suggest chapter titles
* Create a synopsis from the completed manuscript
* Identify plot gaps and unresolved storylines
* Suggest alternative dialogue or scene directions
* Analyze pacing and emotional tone
* Identify character appearances and relationships
* Generate back-cover descriptions and book blurbs

The AI should provide suggestions separately and never replace the
novelist's original writing without approval.

#### 5.2.7 Export and publishing

* Export Urdu, English, or bilingual manuscripts
* Microsoft Word, PDF, plain text, and eBook-ready formats
* Export selected chapters or the complete novel
* Generate a table of contents
* Add title page, author name, chapter headings, and page numbers
* Prepare manuscripts for editors, translators, and publishers

### 5.3 Recommended product positioning

> **Dastaan AI is a private writing and literary translation workspace that
> helps novelists dictate, write, organize, refine, and translate Urdu
> stories into natural English - without losing their voice, emotion, or
> cultural identity.**

The strongest novelist-focused additions would be chapter management,
literary translation modes, custom terminology, character profiles,
continuity checking, version history, and manuscript export.

A stronger Urdu-specialized model and improved GPU infrastructure would be
required before promising fully context-aware literary translation across
long chapters - see §3.1 and §3.1a, which already document why the current
default (Marian) is literal rather than literary, and why the evaluated
LLM alternative hallucinated on this hardware.
