import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: {
    ELEVENLABS_API_KEY: 'eleven-key',
    ELEVENLABS_VOICE_ID: 'eleven-voice',
    ELEVENLABS_TTS_MODEL: 'eleven_multilingual_v2',
    ELEVENLABS_STT_MODEL: 'scribe_v2',
    MAX_VOICE_ENGINE_URL: 'https://voice.internal',
    MAX_VOICE_ENGINE_TOKEN: 'kokoro-token',
    MAX_VOICE_ENGINE_VOICE: 'max-test',
    MAX_VOICE_ENGINE_TIMEOUT_MS: 5000
  },
  elevenLabs: vi.fn()
}));

vi.mock('../config/env.js', () => ({ env: mocks.env }));
vi.mock('./voice.service.js', () => ({ synthesizeWithElevenLabs: mocks.elevenLabs }));

import { getVoiceProviderStatus, synthesizeVoiceResponse } from './voice-provider.service.js';

describe('MAX voice provider adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.env.ELEVENLABS_API_KEY = 'eleven-key';
    mocks.env.ELEVENLABS_VOICE_ID = 'eleven-voice';
    mocks.env.MAX_VOICE_ENGINE_URL = 'https://voice.internal';
    mocks.env.MAX_VOICE_ENGINE_TOKEN = 'kokoro-token';
    mocks.elevenLabs.mockResolvedValue({
      audio: Buffer.from('eleven-audio'),
      contentType: 'audio/mpeg',
      requestId: 'request-1',
      characterCost: '12'
    });
  });

  it('uses ElevenLabs as primary when configured', async () => {
    const result = await synthesizeVoiceResponse('Hello MAX');
    expect(result.provider).toBe('elevenlabs');
    expect(result.model).toBe('eleven_multilingual_v2');
    expect(result.audio.toString()).toBe('eleven-audio');
    expect(mocks.elevenLabs).toHaveBeenCalledWith('Hello MAX');
  });

  it('falls back to authenticated Kokoro when ElevenLabs fails', async () => {
    mocks.elevenLabs.mockRejectedValueOnce(new Error('provider unavailable'));
    const fetchMock = vi.fn().mockResolvedValue(new Response(Buffer.from('RIFF-audio'), {
      status: 200,
      headers: { 'content-type': 'audio/wav' }
    }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await synthesizeVoiceResponse('Fallback speech');
    expect(result.provider).toBe('kokoro');
    expect(result.model).toBe('kokoro-onnx-int8');
    expect(fetchMock).toHaveBeenCalledWith('https://voice.internal/v1/audio/speech', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'X-MAX-Voice-Token': 'kokoro-token' }),
      signal: expect.any(AbortSignal)
    }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      input: 'Fallback speech',
      voice: 'max-test',
      language: 'en-us'
    });
  });

  it('uses Kokoro as primary when ElevenLabs is not configured', async () => {
    mocks.env.ELEVENLABS_API_KEY = '';
    mocks.env.ELEVENLABS_VOICE_ID = '';
    const fetchMock = vi.fn().mockResolvedValue(new Response(Buffer.from('RIFF-audio'), {
      status: 200,
      headers: { 'content-type': 'audio/wav' }
    }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await synthesizeVoiceResponse('Self-hosted speech');
    expect(result.provider).toBe('kokoro');
    expect(mocks.elevenLabs).not.toHaveBeenCalled();
  });

  it('reports provider readiness without exposing credentials', () => {
    expect(getVoiceProviderStatus()).toMatchObject({
      speechToText: true,
      textToSpeech: true,
      primaryProvider: 'elevenlabs',
      fallbackProvider: 'kokoro'
    });
    expect(JSON.stringify(getVoiceProviderStatus())).not.toContain('eleven-key');
    expect(JSON.stringify(getVoiceProviderStatus())).not.toContain('kokoro-token');
  });

  it('rejects synthesis when no provider is configured', async () => {
    mocks.env.ELEVENLABS_API_KEY = '';
    mocks.env.ELEVENLABS_VOICE_ID = '';
    mocks.env.MAX_VOICE_ENGINE_URL = '';
    mocks.env.MAX_VOICE_ENGINE_TOKEN = '';
    await expect(synthesizeVoiceResponse('Hello')).rejects.toMatchObject({ status: 503, code: 'VOICE_NOT_CONFIGURED' });
  });
});
