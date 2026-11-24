import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import main


class FakeEngine:
    def get_voices(self):
        return ["af_sarah", "am_michael"]

    def create(self, text, voice, speed, lang):
        assert text == "Hello from MAX"
        assert voice == "am_michael"
        assert speed == 1.0
        assert lang == "en-us"
        return np.zeros(2400, dtype=np.float32), 24000


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(main, "API_KEY", "test-service-token")
    monkeypatch.setattr(main, "DEFAULT_VOICE", "af_sarah")
    monkeypatch.setattr(main, "_engine", FakeEngine())
    monkeypatch.setattr(main, "_available_voices", {"af_sarah", "am_michael"})
    with TestClient(main.app) as test_client:
        yield test_client


def test_health_is_public_and_reports_loaded_engine(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["loaded"] is True


def test_voice_inventory_requires_service_token(client):
    assert client.get("/v1/audio/voices").status_code == 401
    response = client.get("/v1/audio/voices", headers={"X-MAX-Voice-Token": "test-service-token"})
    assert response.status_code == 200
    assert "am_michael" in response.json()["voices"]


def test_speech_returns_wav_and_requires_service_token(client):
    payload = {"input": "Hello from MAX", "voice": "am_michael", "speed": 1.0}
    assert client.post("/v1/audio/speech", json=payload).status_code == 401

    response = client.post(
        "/v1/audio/speech",
        json=payload,
        headers={"X-MAX-Voice-Token": "test-service-token"},
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert response.content[:4] == b"RIFF"
    assert response.content[8:12] == b"WAVE"
    assert response.headers["x-sample-rate"] == "24000"


def test_unknown_voice_is_rejected(client):
    response = client.post(
        "/v1/audio/speech",
        json={"input": "Hello from MAX", "voice": "not-a-real-voice"},
        headers={"X-MAX-Voice-Token": "test-service-token"},
    )
    assert response.status_code == 422


def test_invalid_speed_is_rejected(client):
    response = client.post(
        "/v1/audio/speech",
        json={"input": "Hello from MAX", "speed": 2.0},
        headers={"X-MAX-Voice-Token": "test-service-token"},
    )
    assert response.status_code == 422
