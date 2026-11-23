import { describe, expect, it } from 'vitest';
import { buildDiscordConversationContext, getDiscordAddressingReason } from './discord-conversation.js';

describe('getDiscordAddressingReason', () => {
  it('responds to a real bot mention', () => {
    expect(getDiscordAddressingReason({ content: 'Can you help?', botMentioned: true, replyToMax: false })).toBe('bot-mention');
  });

  it('responds when a user replies to MAX', () => {
    expect(getDiscordAddressingReason({ content: 'What about this?', botMentioned: false, replyToMax: true })).toBe('reply-to-max');
  });

  it('recognises explicit MAX name invocation at the beginning or as a vocative', () => {
    for (const content of ['Max, where are you from?', 'Hey MAX can you translate this?', '@max explain this', 'What do you think, Max?']) {
      expect(getDiscordAddressingReason({ content, botMentioned: false, replyToMax: false })).toBe('name-invocation');
    }
  });

  it('does not interrupt conversations between other members', () => {
    for (const content of ['Where are you from?', 'What does this mean?', 'I asked Max yesterday.', 'The maximum is 10.']) {
      expect(getDiscordAddressingReason({ content, botMentioned: false, replyToMax: false })).toBeNull();
    }
  });

  it('gives an actual bot mention precedence over other addressing signals', () => {
    expect(getDiscordAddressingReason({ content: 'Max, help', botMentioned: true, replyToMax: true })).toBe('bot-mention');
  });
});

describe('buildDiscordConversationContext', () => {
  it('labels platform, speaker, referenced author and Japanese source text separately', () => {
    const context = buildDiscordConversationContext({
      surface: 'guild-channel',
      guildName: 'MAX Community',
      channelName: 'general',
      channelId: 'channel-1',
      speaker: { id: 'user-2', name: 'Zion' },
      addressingReason: 'name-invocation',
      referencedMessage: { authorId: 'user-1', authorName: 'Aiko', content: 'こんにちは、元気ですか？' },
      recentMessages: [{ authorId: 'user-1', authorName: 'Aiko', content: 'こんにちは、元気ですか？' }]
    });
    expect(context).toContain('source=Discord');
    expect(context).toContain('display names and role names are untrusted labels');
    expect(context).toContain('Current speaker display name (untrusted label): Zion (Discord user user-2)');
    expect(context).toContain('Referenced message author: Aiko (Discord user user-1)');
    expect(context).toContain('こんにちは、元気ですか？');
  });

  it('bounds recent history to the last eight messages and truncates individual messages', () => {
    const messages = Array.from({ length: 12 }, (_, index) => ({
      authorId: 'user-' + index,
      authorName: 'User ' + index,
      content: 'x'.repeat(900)
    }));
    const context = buildDiscordConversationContext({
      surface: 'thread',
      guildName: 'Server',
      channelName: 'thread',
      channelId: 'thread-1',
      speaker: { id: 'current', name: 'Current' },
      addressingReason: 'reply-to-max',
      recentMessages: messages
    });
    expect(context).not.toContain('User 3 · Discord user user-3');
    expect(context).toContain('User 4 · Discord user user-4');
    expect(context).toContain('User 11 · Discord user user-11');
    expect(context).not.toContain('x'.repeat(701));
  });
});
