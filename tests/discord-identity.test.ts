import { describe, expect, it } from 'vitest';
import {
  getDiscordErrorMetadata,
  getDiscordIdentityForContext,
  isLikelyPrivateDiscordRequest,
  splitDiscordMessage
} from '../src/services/discord-identity.js';

describe('Discord identity context isolation', () => {
  const linkedIdentity = { maxUserId: 'max-user-1', displayName: 'Zion' };

  it('does not expose a linked MAX identity to shared guild guest mode', () => {
    expect(getDiscordIdentityForContext(linkedIdentity, false)).toBeNull();
  });

  it('retains the trusted identity in an authenticated private context', () => {
    expect(getDiscordIdentityForContext(linkedIdentity, true)).toEqual(linkedIdentity);
  });

  it('treats questions about the speaker identity as private-context requests', () => {
    expect(isLikelyPrivateDiscordRequest('How do you know my name is Zion?')).toBe(true);
    expect(isLikelyPrivateDiscordRequest('What do you know about me?')).toBe(true);
    expect(isLikelyPrivateDiscordRequest('Tell me a joke')).toBe(false);
  });
});

describe('Discord message chunking', () => {
  it('splits long replies without losing text or breaking Unicode characters', () => {
    const content = 'A'.repeat(1899) + '😀' + 'B'.repeat(10);
    const chunks = splitDiscordMessage(content, 1900);
    expect(chunks).toHaveLength(2);
    expect(chunks.join('')).toBe(content);
    expect(chunks.every((chunk) => Array.from(chunk).length <= 1900)).toBe(true);
  });

  it('returns no chunks for empty content', () => {
    expect(splitDiscordMessage('   ')).toEqual([]);
  });
});

describe('Discord safe error metadata', () => {
  it('records only error type, code and status', () => {
    expect(getDiscordErrorMetadata({
      name: 'ApiError',
      code: 'RESOURCE_EXHAUSTED',
      status: 429,
      message: 'private provider payload'
    })).toEqual({
      errorType: 'ApiError',
      errorCode: 'RESOURCE_EXHAUSTED',
      errorStatus: 429
    });
  });
});
