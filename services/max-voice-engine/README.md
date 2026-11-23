# MAX Voice Engine (prototype)

A private, standalone text-to-speech service for the MAX AI Ecosystem. It uses Kokoro ONNX on CPU and is designed to run as a separate Render Docker service; it is not part of the Node.js API process.

## Current scope

- Loads one Kokoro ONNX model and voice pack once at startup.
- Provides authenticated voice inventory and speech synthesis endpoints.
- Uses a pinned INT8 model and verifies both model asset SHA-256 hashes during the Docker build.
- Serializes inference initially to protect a small CPU instance from concurrent model execution.
- Returns PCM-16 WAV audio and never logs request text or audio.
- Exposes public liveness/readiness endpoints; synthesis and voice inventory require the internal service token.

This is a prototype foundation, not yet the production MAX Voice Engine. It does not yet provide provider failover, STT, audio streaming, synthesis caching, custom MAX voice training, Discord voice sessions, or MAX Music integration.

## Model and licensing

The service uses the 82M-parameter Kokoro model through the MIT-licensed `kokoro-onnx` runtime. The upstream Kokoro model weights are Apache-2.0. Keep the upstream model notices and runtime/dependency notices with any redistributed image. Model source: https://huggingface.co/hexgrad/Kokoro-82M. Runtime: https://github.com/thewh1teagle/kokoro-onnx.

The initial default voice is a temporary stock voice profile (`af_sarah`) so the service can be smoke-tested. It is not the final MAX voice identity. Select a suitable licensed profile, then design an original MAX voice identity. Do not clone an identifiable person's voice without their explicit permission and rights to the recordings.

## Local run

1. Install Python 3.11 and the system package `espeak-ng`.
2. Install dependencies: `pip install -r requirements-dev.txt`.
3. Download the pinned model assets from the URLs in the Dockerfile into a local `models/` folder.
4. Set environment variables:

```bash
MAX_VOICE_API_KEY=replace-with-a-long-random-secret
MAX_VOICE_MODEL_PATH=./models/kokoro-v1.0.int8.onnx
MAX_VOICE_VOICES_PATH=./models/voices-v1.0.bin
MAX_VOICE_ID=af_sarah
```

5. Start the service: `uvicorn app.main:app --host 0.0.0.0 --port 8000`.
6. Run tests from this directory: `pytest -q`.

## API

- `GET /health` — public liveness.
- `GET /ready` — public readiness.
- `GET /v1/audio/voices` — authenticated list of available voices.
- `POST /v1/audio/speech` — authenticated speech synthesis.

Send `X-MAX-Voice-Token` on the two `/v1/audio/*` endpoints. Example request:

```json
{
  "input": "Hello. I am MAX.",
  "voice": "af_sarah",
  "speed": 1.0,
  "language": "en-us"
}
```

The response is `audio/wav` with a PCM-16 WAV payload.

## Render deployment plan (not yet deployed)

Create a separate Render Docker web service from this repository:

- Root directory: `services/max-voice-engine`
- Dockerfile: `Dockerfile`
- Health check: `/ready`
- Environment: `MAX_VOICE_API_KEY` (generate a long random secret), `MAX_VOICE_ID` (selected voice)
- Do not expose the service URL publicly to clients; only MAX Backend should call it.
- Benchmark cold start, memory, CPU, synthesis latency and concurrent requests before selecting a paid instance size.

Do not deploy or upgrade a Render plan until the benchmark and monthly cost are reviewed and explicitly approved.
