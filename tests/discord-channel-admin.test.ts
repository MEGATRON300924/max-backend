import { describe, expect, it } from 'vitest';
import { parseChannelAdminCommand } from '../src/services/discord-channel-admin.js';

describe('Discord staff channel administration command parser', () => {
  it('parses multiple channel names as an enable command', () => {
    expect(parseChannelAdminCommand('!max-channel #max-chat, #max-support')).toEqual({ action: 'enable', references: ['#max-chat', '#max-support'] });
  });
  it('preserves channel mentions and raw IDs for later resolution', () => {
    expect(parseChannelAdminCommand('!max-channel <#1358871225119539303>, 123456789012345678')).toEqual({ action: 'enable', references: ['<#1358871225119539303>', '123456789012345678'] });
  });
  it('parses disable, status, clear and help actions', () => {
    expect(parseChannelAdminCommand('!max-channel disable #general')).toEqual({ action: 'disable', references: ['#general'] });
    expect(parseChannelAdminCommand('!max-channel status')).toEqual({ action: 'status', references: [] });
    expect(parseChannelAdminCommand('!max-channel clear')).toEqual({ action: 'clear', references: [] });
    expect(parseChannelAdminCommand('!max-channel help')).toEqual({ action: 'help', references: [] });
  });
  it('ignores unrelated messages', () => {
    expect(parseChannelAdminCommand('hello MAX')).toBeNull();
  });
});
