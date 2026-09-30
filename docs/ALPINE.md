# MAX AI Backend on Alpine

MAX AI Backend is a Node.js/TypeScript service and does not require Docker or systemd.

## Requirements

- Node.js 20 or newer
- PostgreSQL reachable through DATABASE_URL
- MAX Auth service configuration
- Gemini API key
- ElevenLabs API key and MAX voice ID for voice

## Install

```sh
apk add --no-cache nodejs npm git ca-certificates
npm install
npx prisma generate
npm run typecheck
npm run build
```

## Configure

Copy `.env.example` to `.env` and set production values. Keep MAX_AUTH_SERVICE_TOKEN, GEMINI_API_KEY, and ELEVENLABS_API_KEY server-side only.

## Run

```sh
npx prisma migrate deploy
npm start
```

The service listens on PORT (default 3000). A process supervisor supplied by the hosting environment can restart it; systemd is not required.

## MAX Auth boundary

The backend validates MAX Auth access tokens using the configured JWKS endpoint. Provider credentials are never stored by this backend. Google and Spotify operations go through MAX Auth's authenticated internal service bridge.

## Ecosystem services

MAX Cloud, MAX Browser, MAX Connect, MAX Store, MAX Studio, MAX Security, MAX Pay and MAX OS are included alongside MAX AI, MAX Voice, MAX Music and MAX Home.

MAX Cloud uses MAX_CLOUD_STORAGE_PATH for per-user files and stores file metadata in PostgreSQL. Back up that directory when using local storage in production.

MAX Browser uses Gemini's built-in Google Search and URL Context tools, so no separate search API key is required.

Set MAX_STORE_API_URL to enable TTFL Store product discovery. Set MAX_PAY_CHECKOUT_URL when the MAX Pay checkout provider is ready.

## Voice

Voice uses ElevenLabs for speech-to-text and text-to-speech. Configure ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, and the model/output variables in `.env`.
