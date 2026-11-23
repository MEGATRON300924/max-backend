export type DiscordIdentityContext = {
  displayName?: string;
  [key: string]: unknown;
};

/**
 * A linked MAX identity is only eligible for model context in a private,
 * authenticated conversation. Guild-channel guest mode must not receive it.
 */
export function getDiscordIdentityForContext<T extends DiscordIdentityContext>(
  identity: T | null | undefined,
  allowAccountContext: boolean
): T | null {
  return allowAccountContext && identity ? identity : null;
}

const PRIVATE_CONTEXT_PATTERN =
  /\b(my|mine|me|i am|i'm|i have|i've|my account|my home|my devices|my files|my memories|my email|my calendar|my inbox|my address|my location|my subscription|my payment|my profile|my sessions|my logins|home devices|connected devices|account details|personal data|private data|remembered about me|remember about me|forget me|delete my|send my|read my|who am i|what do you know about me)\b/i;

export function isLikelyPrivateDiscordRequest(content: string): boolean {
  return PRIVATE_CONTEXT_PATTERN.test(content);
}

/** Split Discord replies by Unicode code points without breaking surrogate pairs. */
export function splitDiscordMessage(content: string, maxLength = 1900): string[] {
  if (!Number.isInteger(maxLength) || maxLength < 1) {
    throw new RangeError('maxLength must be a positive integer');
  }
  const characters = Array.from(content.trim());
  const chunks: string[] = [];
  for (let index = 0; index < characters.length; index += maxLength) {
    chunks.push(characters.slice(index, index + maxLength).join(''));
  }
  return chunks;
}
