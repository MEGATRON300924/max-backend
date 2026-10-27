# MAX AI Ecosystem Backend

The central backend for MAX AI. MAX Auth remains the identity and connector authority. This service provides the AI brain, memory, tool orchestration, voice, cloud, browser, Store, Studio, Security, Pay and ecosystem APIs.

## Services

- MAX AI — Groq-powered chat, conversations, memory, streaming and tool calling. Gemini remains an optional legacy chat provider.
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

Set GROQ_API_KEY to enable Groq as the primary chat provider and GROQ_MODEL to choose a supported model (default: openai/gpt-oss-20b). MAX Browser currently still requires GEMINI_API_KEY for Google Search grounding and URL Context; Gemini can also serve as a legacy chat provider when GROQ_API_KEY is absent. Set DATABASE_URL and MAX Auth JWKS/service-token settings. Set ElevenLabs credentials for voice. Set MAX_CLOUD_STORAGE_PATH for Cloud. Set MAX_STORE_API_URL only when TTFL Store discovery should be enabled. Set MAX_PAY_CHECKOUT_URL when an external checkout page is ready.
