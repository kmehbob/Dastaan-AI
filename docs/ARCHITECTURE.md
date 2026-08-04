# Architecture

## User flow

1. The user types Urdu or records Urdu speech.
2. Recorded audio is sent as multipart data to the web application's server-side `/api/transcribe` route.
3. The route attaches the private credential and forwards audio to the FastAPI gateway.
4. Faster Whisper transcribes Urdu speech entirely inside the private deployment.
5. The resulting Urdu remains editable and independently copyable.
6. The user selects **Translate**.
7. Urdu is forwarded through the same private gateway to the selected self-hosted translation model.
8. The English result appears separately while the Urdu is preserved.
9. The user may select **Listen** to hear the Urdu text read aloud: the web application's `/api/speak` route forwards the text to the FastAPI gateway, which synthesizes speech with Meta's MMS-TTS and streams the audio back.

## Components

| Component | Responsibility |
| --- | --- |
| React/Vinext web application | Accessible UI, voice capture, RTL editing, status and error states |
| Server-side web routes | Hide the backend API credential and enforce browser request limits |
| FastAPI gateway | Authentication, validation, rate limiting, orchestration and response shaping |
| Faster Whisper | Self-hosted Urdu speech recognition |
| Marian adapter | CPU-friendly Urdu-to-English translation |
| Private vLLM adapter | Higher-capacity contextual translation on a private GPU server |
| Meta MMS-TTS | Self-hosted Urdu speech synthesis for the "Listen" feature |

The adapters are intentionally replaceable. A model can be changed without changing the public API or UI.

## Data lifecycle

- The browser retains text only in component memory for the current page session.
- The server proxy and FastAPI gateway do not persist request bodies.
- The application does not send text or audio to analytics, logging, model-training, or public inference services.
- Faster Whisper receives audio as an in-memory byte stream.
- Model weights may be downloaded during provisioning; user content is never included in that operation.
