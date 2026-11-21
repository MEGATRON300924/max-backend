# MAX AI Ecosystem Backend

The central backend for MAX AI. MAX Auth remains the identity and connector authority. This service provides the AI brain, memory, tool orchestration, voice, cloud, browser, Store, Studio, Security, Pay and ecosystem APIs.

## Services

- MAX AI — Google Gemini-powered chat, conversations, memory, streaming and tool calling. Gemini 3.5 Flash-Lite is the only supported AI model provider.
- MAX Voice — ElevenLabs Scribe STT and ElevenLabs TTS.
- MAX Music — Spotify through MAX Auth; provider credentials stay in MAX Auth.
- MAX Connect — unified connector status/connect/disconnect bridge to MAX Auth.
- MAX Cloud — authenticated per-user file storage with quotas and checksums.
- MAX Browser — Gemini Google Search grounding and URL Context (currently still requires GEMINI_API_KEY).
- MAX Store — optional read bridge to TTFL Store.
- MAX Studio — authenticated generation workflows.
- MAX Security — MAX Auth audit, usage, device and session bridge.
- MAX Pay — subscription entitlement and checkout configuration surface.
- MAX OS — ecosystem service manifest for clients.
- MAX Home — optional device/home execution bridge.

## Authentication

MAX Auth signs the access token. This backend validates it through MAX Auth JWKS. OAuth provider credentials are not duplicated here. Google and Spotify requests are routed through the MAX Auth internal service bridge.

## Run on Alpine

See docs/ALPINE.md. Docker and systemd are not required.

## Configuration

Set GEMINI_API_KEY to enable Google Gemini and GEMINI_MODEL to choose a supported model (default: gemini-3.5-flash-lite). Gemini is the only AI provider; there is no fallback. MAX Browser also uses GEMINI_API_KEY for Google Search grounding and URL Context. Set DATABASE_URL and MAX Auth JWKS/service-token settings. Set ElevenLabs credentials for voice. Set MAX_CLOUD_STORAGE_PATH for Cloud. Set MAX_STORE_API_URL only when TTFL Store discovery should be enabled. Set MAX_PAY_CHECKOUT_URL when an external checkout page is ready.

### Mobile chat attachment support

The authenticated conversation stream accepts up to three previously signed and completed image attachment IDs. It verifies that each image belongs to the authenticated user and the target conversation, and links the attachments to the persisted user message so conversation history returns their metadata and secure preview URLs. Accepted image formats and the 10 MB per-image limit are enforced by the attachment-sign/complete endpoints. Detailed activity updates continue to stream through the `activity` SSE event from the shared orchestrator contract.


The Android client also uses the authenticated `/api/v1/cloud/files` upload and download endpoints for PDF, text, Markdown, CSV, JSON and HTML documents. Chat messages may include bounded `documentContext` plus MAX Cloud file references; the stream route verifies every referenced Cloud file belongs to the authenticated user, stores the context in message metadata, and restores it for later turns. `POST /api/v1/cloud/files/:id/analyze` analyses a user's own PDF through Gemini after verifying ownership and file integrity. This endpoint does not expose storage credentials or accept arbitrary external file URLs.
