import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extractGeminiProviderError,
  generateGeminiProjectContent,
  type ProviderConfig
} from './project-generation.provider.js';

const providers: ProviderConfig[] = [
  { name: 'primary', apiKey: 'primary-secret', model: 'primary-model' },
  { name: 'secondary', apiKey: 'secondary-secret', model: 'gemini-flash-latest' },
  { name: 'tertiary', apiKey: 'tertiary-secret', model: 'gemini-3.8-flash' }
];

function okResponse(text = '{"summary":"ok","files":[{"path":"index.html","content":"ok"}]}') {
  return new Response(JSON.stringify({
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }]
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function unavailableResponse(message = 'The service is temporarily unavailable.') {
  return new Response(JSON.stringify({
    error: { code: 503, status: 'UNAVAILABLE', message }
  }), { status: 503, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Gemini project-generation provider errors', () => {
  it('extracts the provider code, status and message', () => {
    expect(extractGeminiProviderError({
      error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Invalid request.' }
    })).toEqual({ code: '400', status: 'INVALID_ARGUMENT', message: 'Invalid request.' });
  });

  it('redacts API keys and bearer credentials from provider messages', () => {
    const result = extractGeminiProviderError({
      error: { message: 'Invalid key=AIzaSyExample12345678901234567890 Bearer secret-token-value' }
    });
    expect(result.message).not.toContain('AIzaSyExample');
    expect(result.message).not.toContain('secret-token-value');
    expect(result.message).toContain('[REDACTED]');
  });

  it('ignores malformed or unexpected provider payloads', () => {
    expect(extractGeminiProviderError(null)).toEqual({});
    expect(extractGeminiProviderError({ error: 'failure' })).toEqual({});
    expect(extractGeminiProviderError({ error: { status: 'not safe!' } })).toEqual({});
  });

  it('limits provider messages to 400 characters', () => {
    expect(extractGeminiProviderError({ error: { message: 'x'.repeat(600) } }).message).toHaveLength(400);
  });
});

describe('Gemini project-generation fallback', () => {
  it('uses the primary provider when it succeeds', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);
    const result = await generateGeminiProjectContent('system', 'prompt', providers, { sleep: async () => undefined });
    expect(result.provider).toBe('primary');
    expect(result.model).toBe('primary-model');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a transient primary failure with backoff and then falls back', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(unavailableResponse())
      .mockResolvedValueOnce(unavailableResponse())
      .mockResolvedValueOnce(okResponse());
    const sleeps: number[] = [];
    vi.stubGlobal('fetch', fetchMock);
    const result = await generateGeminiProjectContent('system', 'prompt', providers, {
      sleep: async ms => { sleeps.push(ms); },
      random: () => 0.5
    });
    expect(result.provider).toBe('secondary');
    expect(result.model).toBe('gemini-flash-latest');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([600]);
    expect(result.attempts[0]).toMatchObject({ httpStatus: 503, providerStatus: 'UNAVAILABLE', outcome: 'retry', retryDelayMs: 600 });
    expect(result.attempts[1]).toMatchObject({ httpStatus: 503, outcome: 'fallback' });
  });

  it('honours Retry-After from the provider', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 503, status: 'UNAVAILABLE' } }), {
        status: 503, headers: { 'Retry-After': '2' }
      }))
      .mockResolvedValueOnce(okResponse());
    const sleeps: number[] = [];
    vi.stubGlobal('fetch', fetchMock);
    const result = await generateGeminiProjectContent('system', 'prompt', [providers[0]!], {
      sleep: async ms => { sleeps.push(ms); }
    });
    expect(result.provider).toBe('primary');
    expect(sleeps).toEqual([2000]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('records a sanitized transport error and falls back after its retry budget', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('network error: key=AIzaSyExample12345678901234567890'))
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal('fetch', fetchMock);
    const result = await generateGeminiProjectContent('system', 'prompt', providers, { sleep: async () => undefined });
    expect(result.provider).toBe('secondary');
    const providerMessage = result.attempts[0]?.providerMessage ?? '';
    expect(providerMessage).not.toContain('AIzaSyExample');
    expect(providerMessage).toContain('[REDACTED]');
  });

  it('does not rotate credentials for authentication failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED' } }), { status: 403 })
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(generateGeminiProjectContent('system', 'prompt', providers, { sleep: async () => undefined }))
      .rejects.toMatchObject({ httpStatus: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('continues to the next provider when a configured model is not found', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 404, status: 'NOT_FOUND' } }), { status: 404 }))
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal('fetch', fetchMock);
    const result = await generateGeminiProjectContent('system', 'prompt', providers, { sleep: async () => undefined });
    expect(result.provider).toBe('secondary');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops before issuing a request when the total generation budget is exhausted', async () => {
    let clock = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      clock = 1000;
      return unavailableResponse();
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(generateGeminiProjectContent('system', 'prompt', providers, {
      now: () => clock,
      totalTimeoutMs: 500,
      sleep: async () => undefined
    })).rejects.toMatchObject({ httpStatus: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns a bounded 503 failure after every configured provider is exhausted', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => unavailableResponse());
    vi.stubGlobal('fetch', fetchMock);
    await expect(generateGeminiProjectContent('system', 'prompt', providers, {
      sleep: async () => undefined
    })).rejects.toMatchObject({ httpStatus: 503, attempts: expect.arrayContaining([
      expect.objectContaining({ provider: 'primary', outcome: 'fallback' }),
      expect.objectContaining({ provider: 'secondary', outcome: 'fallback' }),
      expect.objectContaining({ provider: 'tertiary', outcome: 'stopped' })
    ]) });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('rejects requests when no provider key is configured', async () => {
    await expect(generateGeminiProjectContent('system', 'prompt', [], { sleep: async () => undefined }))
      .rejects.toMatchObject({ httpStatus: 503 });
  });

  it('accepts valid JSON project output from a provider', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);
    const result = await generateGeminiProjectContent('system', 'prompt', [providers[0]!], { sleep: async () => undefined });
    expect(JSON.parse(result.text).files).toHaveLength(1);
  });
});
