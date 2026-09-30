# MAX AI Ecosystem Backend

The central backend for MAX AI. MAX Auth remains the identity and connector authority. This service provides the AI brain, memory, tool orchestration, voice, cloud, browser, Store, Studio, Security, Pay and ecosystem APIs.

## Services

- MAX AI — Gemini Interactions API orchestration, conversations, memory and tool calling.
- MAX Voice — ElevenLabs Scribe STT and ElevenLabs TTS.
- MAX Music — Spotify through MAX Auth; provider credentials stay in MAX Auth.
- MAX Connect — unified connector status/connect/disconnect bridge to MAX Auth.
- MAX Cloud — authenticated per-user file storage with quotas and checksums.
- MAX Browser — Gemini Google Search grounding and URL Context.
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

Set DATABASE_URL, MAX Auth JWKS/service-token settings, and GEMINI_API_KEY. Set ElevenLabs credentials for voice. Set MAX_CLOUD_STORAGE_PATH for Cloud. Set MAX_STORE_API_URL only when TTFL Store discovery should be enabled. Set MAX_PAY_CHECKOUT_URL when an external checkout page is ready.
