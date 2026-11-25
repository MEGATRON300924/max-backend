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
    const result = await generateGeminiProjectContent('system', 'prompt', providers);
    expect(result.provider).toBe('primary');
    expect(result.model).toBe('primary-model');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a transient primary failure and then falls back to the secondary model', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 503, status: 'UNAVAILABLE' } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 503, status: 'UNAVAILABLE' } }), { status: 503 }))
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal('fetch', fetchMock);
    const result = await generateGeminiProjectContent('system', 'prompt', providers);
    expect(result.provider).toBe('secondary');
    expect(result.model).toBe('gemini-flash-latest');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not rotate credentials for authentication failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED' } }), { status: 403 })
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(generateGeminiProjectContent('system', 'prompt', providers)).rejects.toMatchObject({ httpStatus: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('continues to the next provider when a configured model is not found', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 404, status: 'NOT_FOUND' } }), { status: 404 }))
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal('fetch', fetchMock);
    const result = await generateGeminiProjectContent('system', 'prompt', providers);
    expect(result.provider).toBe('secondary');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects requests when no provider key is configured', async () => {
    await expect(generateGeminiProjectContent('system', 'prompt', []))
      .rejects.toMatchObject({ httpStatus: 503 });
  });

  it('accepts valid JSON project output from a provider', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);
    const result = await generateGeminiProjectContent('system', 'prompt', [providers[0]!]);
    expect(JSON.parse(result.text).files).toHaveLength(1);
  });
});
