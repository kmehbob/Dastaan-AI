"use client";

import {
  AlertTriangle,
  ArrowLeftRight,
  BookX,
  Check,
  CircleHelp,
  Copy,
  Leaf,
  LockKeyhole,
  Mic,
  Pause,
  Play,
  RotateCcw,
  Settings,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const SAMPLE_URDU =
  "آج کی ملاقات میں ہم نے نئے منصوبے کے اہم نکات، ذمہ داریوں اور اگلے اقدامات پر تفصیل سے بات کی۔ براہِ کرم اس متن کا قدرتی اور واضح انگریزی ترجمہ کریں۔";
const SAMPLE_ENGLISH =
  "In today’s meeting, we discussed the key points of the new project, responsibilities, and next steps in detail. Please translate this text into natural and clear English.";
const MAX_CHARACTERS = 5000;
const WAVEFORM_BAR_COUNT = 27;

type CopyTarget = "urdu" | "english" | null;
type Panel = "settings" | "help" | null;
type ModelState = "checking" | "ready" | "offline";
type DictationPhase = "idle" | "listening" | "paused" | "transcribing" | "review";

function formatElapsed(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function BrandMark() {
  return (
    <svg
      className="brand-mark"
      viewBox="0 0 40 40"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 6.5V33.5" />
      <path d="M35 6.5V33.5" />
      <path d="M20 12.5c-2.9-2.5-6.6-3.8-10.5-3.8V28c3.9 0 7.6 1.3 10.5 3.8" />
      <path d="M20 12.5c2.9-2.5 6.6-3.8 10.5-3.8V28c-3.9 0-7.6 1.3-10.5 3.8" />
      <path d="M20 12.5V31.8" />
      <path d="M17 34.5l3 3 3-3" strokeWidth="1.1" />
      <text
        x="20"
        y="24.5"
        textAnchor="middle"
        fontFamily="var(--font-playfair)"
        fontSize="13"
        fontWeight="700"
        stroke="none"
        fill="currentColor"
      >
        D
      </text>
    </svg>
  );
}

export default function Home() {
  const [urduText, setUrduText] = useState(SAMPLE_URDU);
  const [englishText, setEnglishText] = useState(SAMPLE_ENGLISH);
  const [isTranslating, setIsTranslating] = useState(false);
  const [dictationPhase, setDictationPhase] = useState<DictationPhase>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [draftTranscript, setDraftTranscript] = useState("");
  const [recordedSeconds, setRecordedSeconds] = useState<number | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [toast, setToast] = useState("");
  const [copied, setCopied] = useState<CopyTarget>(null);
  const [activePanel, setActivePanel] = useState<Panel>(null);
  const [modelState, setModelState] = useState<ModelState>("checking");
  const [processingTime, setProcessingTime] = useState<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const speechAudioRef = useRef<HTMLAudioElement | null>(null);
  const speechUrlRef = useRef<string | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);
  const elapsedRef = useRef(0);
  const timerIntervalRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const waveformFrameRef = useRef<number | null>(null);
  const waveformBarRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const discardDictationRef = useRef(false);

  const showToast = useCallback((message: string) => {
    if (toastTimeoutRef.current) window.clearTimeout(toastTimeoutRef.current);
    setToast(message);
    toastTimeoutRef.current = window.setTimeout(() => setToast(""), 6000);
  }, []);

  const dismissToast = useCallback(() => {
    if (toastTimeoutRef.current) window.clearTimeout(toastTimeoutRef.current);
    setToast("");
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 3500);

    fetch("/api/health", { signal: controller.signal, cache: "no-store" })
      .then((response) => setModelState(response.ok ? "ready" : "offline"))
      .catch(() => setModelState("offline"))
      .finally(() => window.clearTimeout(timer));

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(
    () => () => {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      if (speechUrlRef.current) URL.revokeObjectURL(speechUrlRef.current);
      if (toastTimeoutRef.current) window.clearTimeout(toastTimeoutRef.current);
      if (timerIntervalRef.current) window.clearInterval(timerIntervalRef.current);
      if (waveformFrameRef.current) cancelAnimationFrame(waveformFrameRef.current);
      if (audioCtxRef.current) audioCtxRef.current.close().catch(() => {});
    },
    [],
  );

  const translate = useCallback(async () => {
    const text = urduText.trim();
    if (!text || isTranslating) return;

    setIsTranslating(true);
    dismissToast();
    setProcessingTime(null);

    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          source_language: "ur",
          target_language: "en",
        }),
      });
      const payload = (await response.json()) as {
        translation?: string;
        translated_text?: string;
        processing_ms?: number;
        detail?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          payload.detail ||
            payload.error ||
            "Translation failed. Please try again.",
        );
      }

      const result = payload.translation || payload.translated_text;
      if (!result) throw new Error("The private model returned an empty result.");

      setEnglishText(result);
      setProcessingTime(payload.processing_ms ?? null);
      setModelState("ready");
    } catch (requestError) {
      showToast(
        requestError instanceof Error
          ? requestError.message
          : "Translation failed. Please try again.",
      );
      setModelState("offline");
    } finally {
      setIsTranslating(false);
    }
  }, [dismissToast, isTranslating, showToast, urduText]);

  useEffect(() => {
    const onKeyboard = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        void translate();
      }
      if (event.key === "Escape") setActivePanel(null);
    };
    window.addEventListener("keydown", onKeyboard);
    return () => window.removeEventListener("keydown", onKeyboard);
  }, [translate]);

  const copyText = async (target: Exclude<CopyTarget, null>, text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(target);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      showToast("Copy was blocked by your browser. Select the text and copy it manually.");
    }
  };

  const stopTimer = useCallback(() => {
    if (timerIntervalRef.current) window.clearInterval(timerIntervalRef.current);
    timerIntervalRef.current = null;
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();
    timerIntervalRef.current = window.setInterval(() => {
      elapsedRef.current += 1;
      setElapsedSeconds(elapsedRef.current);
    }, 1000);
  }, [stopTimer]);

  const stopWaveform = useCallback(() => {
    if (waveformFrameRef.current) cancelAnimationFrame(waveformFrameRef.current);
    waveformFrameRef.current = null;
  }, []);

  const runWaveform = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const bars = waveformBarRefs.current;
    const step = Math.max(1, Math.floor(data.length / bars.length));

    const draw = () => {
      analyser.getByteFrequencyData(data);
      for (let i = 0; i < bars.length; i++) {
        const bar = bars[i];
        if (!bar) continue;
        const value = data[i * step] ?? 0;
        bar.style.transform = `scaleY(${0.12 + (value / 255) * 0.88})`;
      }
      waveformFrameRef.current = requestAnimationFrame(draw);
    };
    waveformFrameRef.current = requestAnimationFrame(draw);
  }, []);

  const teardownAudioGraph = useCallback(() => {
    stopWaveform();
    analyserRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }, [stopWaveform]);

  const runTranscription = useCallback(async (audio: Blob, seconds: number) => {
    if (!audio.size) {
      showToast("No audio was captured. Please try again.");
      setDictationPhase("idle");
      return;
    }

    try {
      const formData = new FormData();
      const extension = audio.type.includes("ogg") ? "ogg" : "webm";
      formData.append("audio", audio, `urdu-recording.${extension}`);

      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as {
        text?: string;
        detail?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          payload.detail || payload.error || "Speech transcription failed.",
        );
      }
      if (!payload.text?.trim()) {
        throw new Error("No Urdu speech was detected in the recording.");
      }

      setDraftTranscript(payload.text.trim());
      setRecordedSeconds(seconds);
      setDictationPhase("review");
      setModelState("ready");
    } catch (requestError) {
      showToast(
        requestError instanceof Error
          ? requestError.message
          : "Speech transcription failed. Please retry.",
      );
      setDictationPhase("idle");
    }
  }, [showToast]);

  const startDictation = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      showToast("Audio recording is not supported in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      discardDictationRef.current = false;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        showToast("Recording stopped unexpectedly. Check microphone permission.");
        teardownAudioGraph();
        stopTimer();
        stream.getTracks().forEach((track) => track.stop());
        setDictationPhase("idle");
      };
      recorder.onstop = () => {
        const audio = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        const seconds = elapsedRef.current;
        stream.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        teardownAudioGraph();

        if (discardDictationRef.current) {
          setDictationPhase("idle");
          return;
        }
        setDictationPhase("transcribing");
        void runTranscription(audio, seconds);
      };

      try {
        const AudioContextCtor =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (AudioContextCtor) {
          const audioCtx = new AudioContextCtor();
          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 64;
          source.connect(analyser);
          audioCtxRef.current = audioCtx;
          analyserRef.current = analyser;
          runWaveform();
        }
      } catch {
        // The waveform is a visual nicety; recording still works without it.
      }

      dismissToast();
      setDraftTranscript("");
      elapsedRef.current = 0;
      setElapsedSeconds(0);
      setDictationPhase("listening");
      startTimer();
      recorder.start(500);
    } catch {
      showToast("Microphone access was not granted. Allow access and try again.");
    }
  }, [dismissToast, runTranscription, runWaveform, showToast, startTimer, stopTimer, teardownAudioGraph]);

  const pauseDictation = useCallback(() => {
    if (mediaRecorderRef.current?.state !== "recording") return;
    mediaRecorderRef.current.pause();
    stopTimer();
    stopWaveform();
    setDictationPhase("paused");
  }, [stopTimer, stopWaveform]);

  const resumeDictation = useCallback(() => {
    if (mediaRecorderRef.current?.state !== "paused") return;
    mediaRecorderRef.current.resume();
    startTimer();
    runWaveform();
    setDictationPhase("listening");
  }, [runWaveform, startTimer]);

  const stopDictation = useCallback(() => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      stopTimer();
      discardDictationRef.current = false;
      mediaRecorderRef.current.stop();
    }
  }, [stopTimer]);

  const discardDictation = useCallback(() => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      discardDictationRef.current = true;
      stopTimer();
      mediaRecorderRef.current.stop();
    }
    setDictationPhase("idle");
    setDraftTranscript("");
  }, [stopTimer]);

  const insertTranscript = useCallback(() => {
    const text = draftTranscript.trim();
    if (text) {
      setUrduText((current) =>
        `${current}${current ? "\n" : ""}${text}`.slice(0, MAX_CHARACTERS),
      );
    }
    setDictationPhase("idle");
    setDraftTranscript("");
  }, [draftTranscript]);

  const speakUrdu = useCallback(async () => {
    const text = urduText.trim();
    if (!text || isSpeaking) return;

    setIsSpeaking(true);
    dismissToast();

    try {
      const response = await fetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          detail?: string;
          error?: string;
        };
        throw new Error(
          payload.detail || payload.error || "Text-to-speech failed. Please try again.",
        );
      }

      const audioBlob = await response.blob();
      if (speechUrlRef.current) URL.revokeObjectURL(speechUrlRef.current);
      const url = URL.createObjectURL(audioBlob);
      speechUrlRef.current = url;

      const audio = speechAudioRef.current ?? new Audio();
      speechAudioRef.current = audio;
      audio.src = url;
      audio.onended = () => setIsSpeaking(false);
      audio.onerror = () => {
        setIsSpeaking(false);
        showToast("Playback failed. Please try again.");
      };
      await audio.play();
    } catch (requestError) {
      setIsSpeaking(false);
      showToast(
        requestError instanceof Error
          ? requestError.message
          : "Text-to-speech failed. Please try again.",
      );
    }
  }, [dismissToast, isSpeaking, showToast, urduText]);

  const modelLabel =
    modelState === "ready"
      ? "Ready"
      : modelState === "offline"
        ? "Setup needed"
        : "Checking";

  return (
    <main className="app-shell">
      <header className="topnav">
        <a
          className="brand"
          href="#workspace"
          aria-label="Dastaan AI — translate stories without losing their soul"
        >
          <BrandMark />
          <span className="brand-text">
            <strong>
              Dastaan <span className="brand-word-ai">AI</span>
            </strong>
            <small>Urdu &rarr; English Literary Workspace</small>
          </span>
        </a>

        <div className="topnav-trust" aria-label="Privacy commitments">
          <span title="Runs in your environment">
            <Leaf size={13} />
            <span>Private</span>
          </span>
          <span title="Protected in transit">
            <LockKeyhole size={13} />
            <span>Encrypted</span>
          </span>
          <span title="Your text is never retained">
            <BookX size={13} />
            <span>No training</span>
          </span>
        </div>

        <nav className="top-actions" aria-label="Application controls">
          <span className={`model-status model-status-${modelState}`}>
            <span className="status-dot" aria-hidden="true" />
            {modelLabel}
          </span>
          <button
            className="top-action"
            type="button"
            onClick={() =>
              setActivePanel((current) =>
                current === "settings" ? null : "settings",
              )
            }
            aria-expanded={activePanel === "settings"}
          >
            <Settings size={15} />
            <span>Settings</span>
          </button>
          <button
            className="top-action"
            type="button"
            onClick={() =>
              setActivePanel((current) => (current === "help" ? null : "help"))
            }
            aria-expanded={activePanel === "help"}
          >
            <CircleHelp size={15} />
            <span>Help</span>
          </button>
        </nav>

        {activePanel && (
          <aside className="utility-panel" aria-live="polite">
            <button
              className="icon-button panel-close"
              type="button"
              onClick={() => setActivePanel(null)}
              aria-label="Close panel"
              title="Close"
            >
              <X size={15} />
            </button>
            {activePanel === "settings" ? (
              <>
                <span className="panel-kicker">Private inference</span>
                <h2>Translation settings</h2>
                <dl>
                  <div>
                    <dt>Source</dt>
                    <dd>Urdu · ur-PK</dd>
                  </div>
                  <div>
                    <dt>Target</dt>
                    <dd>Natural English</dd>
                  </div>
                  <div>
                    <dt>Maximum length</dt>
                    <dd>{MAX_CHARACTERS.toLocaleString()} characters</dd>
                  </div>
                </dl>
                <p>Model selection and security policy are controlled by your private server.</p>
              </>
            ) : (
              <>
                <span className="panel-kicker">Quick help</span>
                <h2>Translate in one step</h2>
                <ol>
                  <li>Type Urdu or record Urdu speech in the left page.</li>
                  <li>Select Translate, or press Ctrl + Enter.</li>
                  <li>Copy either result independently.</li>
                </ol>
                <p>Your text is not retained by this interface.</p>
              </>
            )}
          </aside>
        )}
      </header>

      <div className="main-area">
        <section className="book" id="workspace" aria-label="Translator workspace">
          <article className="book-page input-page">
            <header className="page-header">
              <div className="language-label">
                <span className="language-avatar avatar-ur" lang="ur" dir="rtl">اردو</span>
                <span>
                  <strong>Urdu manuscript</strong>
                  <small>Editable source</small>
                </span>
              </div>
              <span className="detected-label">
                <Sparkles size={12} />
                Urdu detected
              </span>
            </header>

            <div className="editor-surface">
              <label className="sr-only" htmlFor="urdu-input">
                Urdu text to translate
              </label>
              <textarea
                id="urdu-input"
                className="urdu-editor"
                lang="ur"
                dir="rtl"
                maxLength={MAX_CHARACTERS}
                value={urduText}
                onChange={(event) => {
                  setUrduText(event.target.value);
                  dismissToast();
                }}
                placeholder="یہاں اردو میں لکھیں یا مائیکروفون استعمال کریں…"
                spellCheck="false"
              />

              <div className="editor-footer">
                <div className="editor-actions">
                  <button
                    className="pill-button"
                    type="button"
                    onClick={() => void startDictation()}
                    disabled={dictationPhase !== "idle"}
                    title="Record Urdu speech"
                  >
                    <Mic size={14} />
                    <span>Record</span>
                  </button>
                  <button
                    className="pill-button"
                    type="button"
                    onClick={() => void speakUrdu()}
                    disabled={!urduText.trim() || isSpeaking}
                    title={isSpeaking ? "Speaking…" : "Listen to Urdu text"}
                  >
                    <Volume2 size={14} />
                    <span>Listen</span>
                  </button>
                  <button
                    className="pill-button"
                    type="button"
                    onClick={() => {
                      setUrduText("");
                      setEnglishText("");
                      setProcessingTime(null);
                      dismissToast();
                    }}
                  >
                    <Trash2 size={14} />
                    <span>Clear</span>
                  </button>
                  <button
                    className="pill-button"
                    type="button"
                    onClick={() => void copyText("urdu", urduText)}
                    disabled={!urduText}
                    title="Copy Urdu text"
                  >
                    {copied === "urdu" ? <Check size={14} /> : <Copy size={14} />}
                    <span>Copy</span>
                  </button>
                </div>
                <span className="editor-count">
                  {urduText.length.toLocaleString()} / {MAX_CHARACTERS.toLocaleString()}
                </span>
              </div>
            </div>
          </article>

          <div className="book-spine" aria-hidden="true" />

          <button
            className="translate-button"
            type="button"
            onClick={() => void translate()}
            disabled={!urduText.trim() || isTranslating}
          >
            <ArrowLeftRight size={20} aria-hidden="true" />
            <span>{isTranslating ? "Translating" : "Translate"}</span>
            <small>Ctrl + Enter</small>
          </button>

          <article className="book-page output-page" aria-busy={isTranslating}>
            <header className="page-header">
              <div className="language-label">
                <span className="language-avatar avatar-en">EN</span>
                <span>
                  <strong>English translation</strong>
                  <small>Natural literary voice</small>
                </span>
              </div>
              <span className={`result-state ${isTranslating ? "is-working" : ""}`}>
                {isTranslating ? <RotateCcw size={12} /> : <Check size={12} />}
                {isTranslating ? "Working" : englishText ? "Ready" : "Waiting"}
              </span>
            </header>

            <div className="editor-surface output-surface">
              {isTranslating ? (
                <div className="loading-state" role="status">
                  <span className="loading-orbit"><Zap size={18} /></span>
                  <strong>Creating a natural English translation</strong>
                  <span>Preserving meaning, tone, paragraphs, and line breaks.</span>
                </div>
              ) : englishText ? (
                <p className="english-output" lang="en">{englishText}</p>
              ) : (
                <div className="empty-state">
                  <ArrowLeftRight size={20} />
                  <strong>Your English translation will appear here.</strong>
                  <span>The original Urdu text will remain unchanged.</span>
                </div>
              )}

              <div className="editor-footer output-footer">
                <span className="translation-note">
                  <span className="ready-dot" aria-hidden="true" />
                  {processingTime
                    ? `Translated privately in ${(processingTime / 1000).toFixed(1)}s`
                    : englishText
                      ? "Translation ready"
                      : "Awaiting Urdu text"}
                </span>
                <button
                  className="pill-button"
                  type="button"
                  onClick={() => void copyText("english", englishText)}
                  disabled={!englishText || isTranslating}
                >
                  {copied === "english" ? <Check size={14} /> : <Copy size={14} />}
                  <span>{copied === "english" ? "Copied" : "Copy"}</span>
                </button>
              </div>
            </div>
          </article>
        </section>
      </div>

      {dictationPhase !== "idle" && (
        <div className="dictation-overlay">
          <div
            className="dictation-card"
            role="dialog"
            aria-modal="true"
            aria-label="Urdu voice dictation"
          >
            <header className="dictation-header">
              <span className="dictation-mic-badge" aria-hidden="true">
                <Mic size={20} />
              </span>
              <div className="dictation-title">
                <strong>
                  {dictationPhase === "review"
                    ? "Review transcription"
                    : dictationPhase === "transcribing"
                      ? "Transcribing…"
                      : dictationPhase === "paused"
                        ? "Paused"
                        : "Listening in Urdu"}
                </strong>
                <span className="dictation-lang-pill" lang="ur">
                  Urdu &middot; اردو
                </span>
              </div>

              {(dictationPhase === "listening" || dictationPhase === "paused") && (
                <span className="dictation-timer">
                  <span
                    className={`dictation-rec-dot ${dictationPhase === "paused" ? "is-paused" : ""}`}
                    aria-hidden="true"
                  />
                  {formatElapsed(elapsedSeconds)}
                </span>
              )}

              <div className="dictation-controls">
                {dictationPhase === "listening" && (
                  <button className="pill-button" type="button" onClick={pauseDictation}>
                    <Pause size={14} />
                    <span>Pause</span>
                  </button>
                )}
                {dictationPhase === "paused" && (
                  <button className="pill-button" type="button" onClick={resumeDictation}>
                    <Play size={14} />
                    <span>Resume</span>
                  </button>
                )}
                {(dictationPhase === "listening" || dictationPhase === "paused") && (
                  <button className="pill-button" type="button" onClick={stopDictation}>
                    <Square size={14} />
                    <span>Stop</span>
                  </button>
                )}
              </div>
            </header>

            {(dictationPhase === "listening" || dictationPhase === "paused") && (
              <>
                <p className="dictation-hint">
                  Speak naturally in Urdu. Your words will appear here for review.
                </p>
                <div className="dictation-waveform" aria-hidden="true">
                  {Array.from({ length: WAVEFORM_BAR_COUNT }).map((_, index) => (
                    <span
                      key={index}
                      ref={(node) => {
                        waveformBarRefs.current[index] = node;
                      }}
                    />
                  ))}
                </div>
              </>
            )}

            {dictationPhase === "transcribing" && (
              <div className="dictation-processing" role="status">
                <RotateCcw size={18} />
                <span>Transcribing your recording…</span>
              </div>
            )}

            {dictationPhase === "review" && (
              <>
                <label className="sr-only" htmlFor="dictation-preview">
                  Transcribed Urdu text
                </label>
                <textarea
                  id="dictation-preview"
                  className="dictation-preview"
                  lang="ur"
                  dir="rtl"
                  value={draftTranscript}
                  onChange={(event) => setDraftTranscript(event.target.value)}
                />
                <div className="dictation-meta">
                  {recordedSeconds !== null && (
                    <span>
                      <Check size={13} />
                      Transcribed {formatElapsed(recordedSeconds)} of audio
                    </span>
                  )}
                  <span>
                    <LockKeyhole size={13} />
                    Voice is processed privately and is not stored.
                  </span>
                </div>
              </>
            )}

            <footer className="dictation-actions">
              <button className="pill-button" type="button" onClick={discardDictation}>
                <Trash2 size={14} />
                <span>Discard</span>
              </button>
              {dictationPhase === "review" && (
                <button
                  className="dictation-insert"
                  type="button"
                  onClick={insertTranscript}
                  disabled={!draftTranscript.trim()}
                >
                  <Check size={16} />
                  <span>Insert into manuscript</span>
                </button>
              )}
            </footer>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast-viewport">
          <div className="toast" role="alert">
            <AlertTriangle size={16} />
            <span>{toast}</span>
            <button
              className="icon-button"
              type="button"
              onClick={dismissToast}
              aria-label="Dismiss notification"
              title="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
