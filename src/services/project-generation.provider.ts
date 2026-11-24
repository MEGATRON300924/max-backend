export type GeminiProviderErrorDetails = {
  code?: string;
  status?: string;
  message?: string;
};

function safeProviderText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const sanitized = value
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/(api[_-]?key|key)\s*[:=]\s*["']?[^,\s"']+/gi, '$1=[REDACTED]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitized ? sanitized.slice(0, 400) : undefined;
}

export function extractGeminiProviderError(payload: unknown): GeminiProviderErrorDetails {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== 'object' || Array.isArray(error)) return {};
  const value = error as { code?: unknown; status?: unknown; message?: unknown };
  return {
    ...(typeof value.code === 'number' && Number.isInteger(value.code) ? { code: String(value.code) } : {}),
    ...(typeof value.status === 'string' && /^[A-Z0-9_]{1,80}$/.test(value.status) ? { status: value.status } : {}),
    ...(safeProviderText(value.message) ? { message: safeProviderText(value.message) } : {})
  };
}
