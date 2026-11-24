import { env } from '../config/env.js';
import { ApiError } from '../middleware/errors.js';
import { synthesizeWithElevenLabs } from './voice.service.js';

const ELEVENLABS_COOLDOWN_MS = 30_000;
const MAX_KOKORO_AUDIO_BYTES = 15 * 1024 * 1024;
let elevenLabsUnavailableUntil = 0;

export type VoiceSynthesisResult = {
  audio: Buffer;
  contentType: string;
  provider: 'elevenlabs' | 'kokoro';
  model: string;
  voiceId: string;
  requestId: string | null;
  characterCost: string | null;
};

function hasElevenLabs() {
  return Boolean(env.ELEVENLABS_API_KEY && env.ELEVENLABS_VOICE_ID);
}

function hasKokoro() {
  return Boolean(env.MAX_VOICE_ENGINE_URL && env.MAX_VOICE_ENGINE_TOKEN);
}

async function synthesizeWithKokoro(text: string): Promise<VoiceSynthesisResult> {
  if (!hasKokoro()) throw new ApiError(503, 'VOICE_NOT_CONFIGURED', 'No MAX speech synthesis provider is configured');
  const endpoint = `${env.MAX_VOICE_ENGINE_URL.replace(/\/+$/, '')}/v1/audio/speech`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'audio/wav',
        'X-MAX-Voice-Token': env.MAX_VOICE_ENGINE_TOKEN!
      },
      body: JSON.stringify({
        input: text,
        voice: env.MAX_VOICE_ENGINE_VOICE,
        speed: 1,
        language: 'en-us'
      }),
      signal: AbortSignal.timeout(env.MAX_VOICE_ENGINE_TIMEOUT_MS)
    });
  } catch {
    throw new ApiError(502, 'MAX_VOICE_ENGINE_UNAVAILABLE', 'The self-hosted MAX voice engine could not be reached');
  }
  if (!response.ok) {
    throw new ApiError(response.status === 503 ? 503 : 502, 'MAX_VOICE_ENGINE_ERROR', 'The self-hosted MAX voice engine could not synthesize this response');
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('audio/wav')) {
    throw new ApiError(502, 'MAX_VOICE_ENGINE_INVALID_AUDIO', 'The self-hosted MAX voice engine returned an unsupported audio format');
  }
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_KOKORO_AUDIO_BYTES) {
    throw new ApiError(502, 'MAX_VOICE_ENGINE_INVALID_AUDIO', 'The self-hosted MAX voice engine returned invalid audio');
  }
  return {
    audio: Buffer.from(bytes),
    contentType: 'audio/wav',
    provider: 'kokoro',
    model: 'kokoro-onnx-int8',
    voiceId: env.MAX_VOICE_ENGINE_VOICE,
    requestId: null,
    characterCost: null
  };
}

export async function synthesizeVoiceResponse(text: string): Promise<VoiceSynthesisResult> {
  const normalized = text.trim();
  if (!normalized) throw new ApiError(400, 'TEXT_REQUIRED', 'Text is required for speech synthesis');
  if (normalized.length > 10000) throw new ApiError(400, 'TEXT_TOO_LONG', 'Text is too long for one MAX voice response');

  let primaryError: unknown;
  if (hasElevenLabs() && (Date.now() >= elevenLabsUnavailableUntil || !hasKokoro())) {
    try {
      const result = await synthesizeWithElevenLabs(normalized);
      elevenLabsUnavailableUntil = 0;
      return {
        ...result,
        provider: 'elevenlabs',
        model: env.ELEVENLABS_TTS_MODEL,
        voiceId: env.ELEVENLABS_VOICE_ID!
      };
    } catch (error) {
      primaryError = error;
      elevenLabsUnavailableUntil = Date.now() + ELEVENLABS_COOLDOWN_MS;
    }
  }

  if (hasKokoro()) {
    try {
      return await synthesizeWithKokoro(normalized);
    } catch (fallbackError) {
      if (primaryError) {
        throw new ApiError(502, 'VOICE_PROVIDERS_UNAVAILABLE', 'MAX could not generate audio right now. The text response is still available.');
      }
      throw fallbackError;
    }
  }

  if (primaryError) throw primaryError;
  if (hasElevenLabs()) {
    const result = await synthesizeWithElevenLabs(normalized);
    elevenLabsUnavailableUntil = 0;
    return {
      ...result,
      provider: 'elevenlabs',
      model: env.ELEVENLABS_TTS_MODEL,
      voiceId: env.ELEVENLABS_VOICE_ID!
    };
  }
  throw new ApiError(503, 'VOICE_NOT_CONFIGURED', 'No MAX speech synthesis provider is configured');
}

export function getVoiceProviderStatus() {
  const elevenLabs = hasElevenLabs();
  const kokoro = hasKokoro();
  return {
    speechToText: Boolean(env.ELEVENLABS_API_KEY),
    textToSpeech: elevenLabs || kokoro,
    primaryProvider: elevenLabs ? 'elevenlabs' : kokoro ? 'kokoro' : null,
    fallbackProvider: elevenLabs && kokoro ? 'kokoro' : null,
    providers: {
      elevenlabs: { configured: elevenLabs, role: elevenLabs ? 'primary' : null, model: env.ELEVENLABS_TTS_MODEL },
      kokoro: { configured: kokoro, role: elevenLabs && kokoro ? 'fallback' : kokoro ? 'primary' : null, model: 'kokoro-onnx-int8' }
    },
    sttProvider: env.ELEVENLABS_API_KEY ? 'elevenlabs' : null,
    sttModel: env.ELEVENLABS_STT_MODEL
  };
}
