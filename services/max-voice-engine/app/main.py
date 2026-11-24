from __future__ import annotations

import hmac
import io
import os
import threading
from contextlib import asynccontextmanager
from typing import Any, Literal

import soundfile as sf
from fastapi import Depends, FastAPI, Header, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from typing_extensions import Annotated

MODEL_PATH = os.getenv("MAX_VOICE_MODEL_PATH", "/models/kokoro-v1.0.int8.onnx")
VOICES_PATH = os.getenv("MAX_VOICE_VOICES_PATH", "/models/voices-v1.0.bin")
API_KEY = os.getenv("MAX_VOICE_API_KEY", "")
DEFAULT_VOICE = os.getenv("MAX_VOICE_ID", "af_sarah")
MAX_TEXT_CHARS = int(os.getenv("MAX_VOICE_MAX_TEXT_CHARS", "4000"))
MAX_SPEED = 1.2
MIN_SPEED = 0.8

_engine: Any | None = None
_available_voices: set[str] = set()
_synthesis_lock = threading.Lock()


class SpeechRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_TEXT_CHARS)]
    voice: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=80)] | None = None
    speed: float = Field(default=1.0, ge=MIN_SPEED, le=MAX_SPEED)
    language: Literal["en-us", "en-gb"] = "en-us"


def _load_engine() -> None:
    global _engine, _available_voices
    if not API_KEY:
        raise RuntimeError("MAX_VOICE_API_KEY must be configured before starting the voice engine")
    if not os.path.isfile(MODEL_PATH) or not os.path.isfile(VOICES_PATH):
        raise RuntimeError("Kokoro model assets are missing; check MAX_VOICE_MODEL_PATH and MAX_VOICE_VOICES_PATH")

    from kokoro_onnx import Kokoro

    instance = Kokoro(MODEL_PATH, VOICES_PATH)
    voices = set(instance.get_voices())
    if not voices:
        raise RuntimeError("Kokoro loaded without any available voice profiles")
    if DEFAULT_VOICE not in voices:
        raise RuntimeError("MAX_VOICE_ID is not present in the installed voice pack")
    _engine = instance
    _available_voices = voices


@asynccontextmanager
async def lifespan(_: FastAPI):
    if _engine is None:
        _load_engine()
    yield


app = FastAPI(
    title="MAX Voice Engine",
    version="0.1.0",
    description="Private, authenticated Kokoro ONNX speech synthesis service for the MAX AI Ecosystem.",
    lifespan=lifespan,
)


def require_service_token(x_max_voice_token: str | None = Header(default=None)) -> None:
    if not API_KEY:
        raise HTTPException(status_code=503, detail="Voice engine authentication is not configured")
    if not x_max_voice_token or not hmac.compare_digest(x_max_voice_token, API_KEY):
        raise HTTPException(status_code=401, detail="Invalid voice engine token")


@app.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "engine": "max-kokoro-onnx", "loaded": _engine is not None}


@app.get("/ready")
def readiness() -> dict[str, Any]:
    if _engine is None:
        raise HTTPException(status_code=503, detail="Voice model is not ready")
    return {"status": "ready", "engine": "max-kokoro-onnx", "voiceCount": len(_available_voices)}


@app.get("/v1/audio/voices", dependencies=[Depends(require_service_token)])
def list_voices() -> dict[str, Any]:
    if _engine is None:
        raise HTTPException(status_code=503, detail="Voice model is not ready")
    return {"voices": sorted(_available_voices), "defaultVoice": DEFAULT_VOICE}


@app.post("/v1/audio/speech", dependencies=[Depends(require_service_token)])
def synthesize(request: SpeechRequest) -> Response:
    if _engine is None:
        raise HTTPException(status_code=503, detail="Voice model is not ready")

    voice = request.voice or DEFAULT_VOICE
    if voice not in _available_voices:
        raise HTTPException(status_code=422, detail="Requested voice is not available")

    try:
        # The ONNX session is shared by requests. Serialize inference until concurrency
        # benchmarks prove a higher parallelism level is safe for the selected CPU plan.
        with _synthesis_lock:
            samples, sample_rate = _engine.create(
                request.input,
                voice=voice,
                speed=request.speed,
                lang=request.language,
            )
        output = io.BytesIO()
        sf.write(output, samples, sample_rate, format="WAV", subtype="PCM_16")
        audio = output.getvalue()
        if not audio:
            raise RuntimeError("The speech engine returned an empty audio buffer")
    except HTTPException:
        raise
    except Exception as error:
        # Do not include user text, audio, model internals, or secrets in the response.
        raise HTTPException(status_code=502, detail="Speech synthesis failed") from error

    return Response(
        content=audio,
        media_type="audio/wav",
        headers={
            "Cache-Control": "no-store",
            "X-Sample-Rate": str(sample_rate),
            "X-MAX-Voice-Engine": "kokoro-onnx-int8",
        },
    )
