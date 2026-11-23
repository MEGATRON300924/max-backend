export type ChannelAdminAction = 'enable' | 'disable' | 'status' | 'clear' | 'help';

export function parseChannelAdminCommand(content: string): { action: ChannelAdminAction; references: string[] } | null {
  const match = content.trim().match(/^!max-channel(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  const remainder = (match[1] ?? '').trim();
  if (!remainder) return { action: 'help', references: [] };
  const firstSpace = remainder.search(/\s/);
  const firstToken = (firstSpace === -1 ? remainder : remainder.slice(0, firstSpace)).toLowerCase();
  if (['enable', 'disable', 'status', 'clear', 'help'].includes(firstToken)) {
    const action = firstToken as ChannelAdminAction;
    const rest = firstSpace === -1 ? '' : remainder.slice(firstSpace + 1);
    return { action, references: rest.split(',').map((value) => value.trim()).filter(Boolean) };
  }
  return { action: 'enable', references: remainder.split(',').map((value) => value.trim()).filter(Boolean) };
}
