FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MAX_VOICE_MODEL_PATH=/models/kokoro-v1.0.int8.onnx \
    MAX_VOICE_VOICES_PATH=/models/voices-v1.0.bin

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl espeak-ng libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

RUN mkdir -p /models \
    && curl -fsSL --retry 3 \
      https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.int8.onnx \
      -o /models/kokoro-v1.0.int8.onnx \
    && echo "ae31579b623f244700e4afb9246c46a26066782e049ba174bf3ba433970ee9c9  /models/kokoro-v1.0.int8.onnx" | sha256sum -c - \
    && curl -fsSL --retry 3 \
      https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.0.bin \
      -o /models/voices-v1.0.bin \
    && echo "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d  /models/voices-v1.0.bin" | sha256sum -c -

RUN useradd --create-home --uid 10001 appuser \
    && chown -R appuser:appuser /app /models
USER appuser

COPY --chown=appuser:appuser app ./app
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
