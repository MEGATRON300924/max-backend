import { env } from '../config/env.js';
import { ApiError } from '../middleware/errors.js';

function requireApiKey() {
  if (!env.ELEVENLABS_API_KEY) throw new ApiError(503, 'VOICE_NOT_CONFIGURED', 'ElevenLabs is not configured');
  return env.ELEVENLABS_API_KEY;
}

function providerError(text: string) {
  try {
    const parsed = JSON.parse(text) as any;
    if (typeof parsed.message === 'string') return parsed.message;
    if (typeof parsed.detail === 'string') return parsed.detail;
    if (parsed.detail && typeof parsed.detail.message === 'string') return parsed.detail.message;
  } catch {}
  return text.slice(0, 500);
}

function assertAudio(audio: Buffer) {
  if (!audio.length) throw new ApiError(400, 'AUDIO_REQUIRED', 'Audio data is required');
  if (audio.length > env.ELEVENLABS_MAX_AUDIO_BYTES) throw new ApiError(413, 'AUDIO_TOO_LARGE', 'The audio file is too large');
}

export async function transcribeWithElevenLabs(audio: Buffer, mimeType = 'audio/webm') {
  const apiKey = requireApiKey();
  assertAudio(audio);
  const form = new FormData();
  form.append('model_id', env.ELEVENLABS_STT_MODEL);
  if (env.ELEVENLABS_STT_LANGUAGE) form.append('language_code', env.ELEVENLABS_STT_LANGUAGE);
  form.append('file', new Blob([audio], { type: mimeType }), 'max-voice.webm');
  const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': apiKey }, body: form });
  if (!response.ok) throw new ApiError(502, 'VOICE_STT_PROVIDER_ERROR', providerError(await response.text().catch(() => '')) || 'ElevenLabs speech recognition failed');
  const body = await response.json() as { text?: string; language_code?: string; language_probability?: number };
  if (!body.text?.trim()) throw new ApiError(502, 'VOICE_EMPTY_TRANSCRIPT', 'ElevenLabs returned no transcript');
  return { text: body.text.trim(), languageCode: body.language_code ?? null, languageProbability: body.language_probability ?? null };
}

export async function synthesizeWithElevenLabs(text: string) {
  const apiKey = requireApiKey();
  if (!env.ELEVENLABS_VOICE_ID) throw new ApiError(503, 'VOICE_NOT_CONFIGURED', 'MAX voice ID is not configured');
  const normalized = text.trim();
  if (!normalized) throw new ApiError(400, 'TEXT_REQUIRED', 'Text is required for speech synthesis');
  if (normalized.length > 10000) throw new ApiError(400, 'TEXT_TOO_LONG', 'Text is too long for one MAX voice response');
  const url = new URL('https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(env.ELEVENLABS_VOICE_ID));
  url.searchParams.set('output_format', env.ELEVENLABS_TTS_OUTPUT_FORMAT);
  const response = await fetch(url, { method: 'POST', headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' }, body: JSON.stringify({ text: normalized, model_id: env.ELEVENLABS_TTS_MODEL }) });
  if (!response.ok) throw new ApiError(502, 'VOICE_TTS_PROVIDER_ERROR', providerError(await response.text().catch(() => '')) || 'ElevenLabs speech synthesis failed');
  const audio = Buffer.from(await response.arrayBuffer());
  if (!audio.length) throw new ApiError(502, 'VOICE_EMPTY_AUDIO', 'ElevenLabs returned empty audio');
  return { audio, contentType: response.headers.get('content-type') || 'audio/mpeg', requestId: response.headers.get('request-id') || null, characterCost: response.headers.get('character-cost') || null };
}

export function voiceStatus() {
  return { provider: 'elevenlabs', speechToText: Boolean(env.ELEVENLABS_API_KEY), textToSpeech: Boolean(env.ELEVENLABS_API_KEY && env.ELEVENLABS_VOICE_ID), sttModel: env.ELEVENLABS_STT_MODEL, ttsModel: env.ELEVENLABS_TTS_MODEL, voiceConfigured: Boolean(env.ELEVENLABS_VOICE_ID) };
}
