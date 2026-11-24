import { describe, expect, it } from 'vitest';
import { extractGeminiProviderError } from './project-generation.provider.js';

describe('Gemini project-generation provider errors', () => {
  it('extracts the provider code, status and message', () => {
    expect(extractGeminiProviderError({
      error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Invalid request.' }
    })).toEqual({
      code: '400',
      status: 'INVALID_ARGUMENT',
      message: 'Invalid request.'
    });
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
    const result = extractGeminiProviderError({ error: { message: 'x'.repeat(600) } });
    expect(result.message).toHaveLength(400);
  });
});
