import { env } from '../config/env.js';

export type GeminiProviderErrorDetails = {
  code?: string;
  status?: string;
  message?: string;
};

export type GeminiProjectProviderAttempt = {
  provider: 'primary' | 'secondary' | 'tertiary';
  model: string;
  httpStatus?: number;
  providerCode?: string;
  providerStatus?: string;
  providerMessage?: string;
  retryDelayMs?: number;
  outcome: 'retry' | 'fallback' | 'success' | 'stopped';
};

export type GeminiProjectGenerationResult = {
  text: string;
  provider: 'primary' | 'secondary' | 'tertiary';
  model: string;
  attempts: GeminiProjectProviderAttempt[];
};

export class GeminiProjectGenerationError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly attempts: GeminiProjectProviderAttempt[]
  ) {
    super(message);
    this.name = 'GeminiProjectGenerationError';
  }
}

function safeProviderText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const sanitized = value
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED]')
    .replace(/\\bBearer\\s+\\S+/gi, 'Bearer [REDACTED]')
    .replace(/(api[_-]?key|key)\\s*[:=]\\s*["']?[^,\\s"']+/gi, '$1=[REDACTED]')
    .replace(/[\\u0000-\\u001f\\u007f]/g, ' ')
    .replace(/\\s+/g, ' ')
    .trim();
  return sanitized ? sanitized.slice(0, 400) : undefined;
}

export function extractGeminiProviderError(payload: unknown): GeminiProviderErrorDetails {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== 'object' || Array.isArray(error)) return {};
  const value = error as { code?: unknown; status?: unknown; message?: unknown };
  const message = safeProviderText(value.message);
  return {
    ...(typeof value.code === 'number' && Number.isInteger(value.code) ? { code: String(value.code) } : {}),
    ...(typeof value.status === 'string' && /^[A-Z0-9_]{1,80}$/.test(value.status) ? { status: value.status } : {}),
    ...(message ? { message } : {})
  };
}

export type ProviderConfig = {
  name: GeminiProjectProviderAttempt['provider'];
  apiKey?: string;
  model: string;
};

export type GeminiRetryOptions = {
  totalTimeoutMs?: number;
  requestTimeoutMs?: number;
  maxRetriesPerProvider?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
};

const providers: ProviderConfig[] = [
  { name: 'primary', apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL },
  { name: 'secondary', apiKey: env.GEMINI_FALLBACK_API_KEY, model: env.GEMINI_FALLBACK_MODEL },
  { name: 'tertiary', apiKey: env.GEMINI_TERTIARY_API_KEY, model: env.GEMINI_TERTIARY_MODEL }
];

const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const DEFAULT_TOTAL_TIMEOUT_MS = 90_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RETRIES_PER_PROVIDER = 1;
const DEFAULT_BASE_DELAY_MS = 600;
const DEFAULT_MAX_DELAY_MS = 5_000;

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function retryAfterMs(value: string | null, now: number): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(10_000, Math.ceil(seconds * 1000));
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.min(10_000, Math.max(0, date - now));
}

function extractGeneratedText(payload: any): string {
  const candidate = payload?.candidates?.[0];
  if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
    throw new Error('The provider returned an incomplete generation.');
  }
  const text = candidate?.content?.parts?.map((part: { text?: string }) => part.text || '').join('').trim();
  if (!text) throw new Error('The provider returned an empty generation.');
  const raw = text.replace(/^\\uFEFF/, '').trim().replace(/^\\x60{3}(?:json)?\\s*/i, '').replace(/\\s*\\x60{3}$/, '');
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('The provider returned invalid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.files)) {
    throw new Error('The provider returned JSON without a files array.');
  }
  return raw;
}

export async function generateGeminiProjectContent(
  systemInstruction: string,
  prompt: string,
  providerConfigs: ProviderConfig[] = providers,
  retryOptions: GeminiRetryOptions = {}
): Promise<GeminiProjectGenerationResult> {
  const configured = providerConfigs.filter(provider => Boolean(provider.apiKey));
  if (!configured.length) {
    throw new GeminiProjectGenerationError('No Gemini project-generation API keys are configured.', 503, []);
  }

  const now = retryOptions.now || Date.now;
  const sleep = retryOptions.sleep || delay;
  const random = retryOptions.random || Math.random;
  const totalTimeoutMs = retryOptions.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
  const requestTimeoutMs = retryOptions.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const maxRetries = retryOptions.maxRetriesPerProvider ?? DEFAULT_MAX_RETRIES_PER_PROVIDER;
  const baseDelayMs = retryOptions.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = retryOptions.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const deadline = now() + totalTimeoutMs;
  const attempts: GeminiProjectProviderAttempt[] = [];
  let lastHttpStatus = 503;

  for (let providerIndex = 0; providerIndex < configured.length; providerIndex += 1) {
    const provider = configured[providerIndex]!;
    let shouldFallback = false;

    for (let retry = 0; retry <= maxRetries; retry += 1) {
      const remainingMs = deadline - now();
      if (remainingMs <= 0) {
        attempts.push({ provider: provider.name, model: provider.model, outcome: 'stopped', providerMessage: 'Generation retry budget exhausted.' });
        throw new GeminiProjectGenerationError('Project generation timed out while waiting for an available provider.', lastHttpStatus, attempts);
      }

      try {
        const response = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(provider.model) + ':generateContent',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': provider.apiKey! },
            signal: AbortSignal.timeout(Math.max(1, Math.min(requestTimeoutMs, remainingMs))),
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemInstruction }] },
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 12000 }
            })
          }
        );
        const responseText = await response.text().catch(() => '');
        let payload: any = {};
        try { payload = responseText ? JSON.parse(responseText) : {}; } catch { payload = {}; }

        if (!response.ok) {
          lastHttpStatus = response.status;
          const details = extractGeminiProviderError(payload);
          const retryable = RETRYABLE_HTTP_STATUSES.has(response.status);
          const hasNext = providerIndex < configured.length - 1;
          const canRetry = retryable && retry < maxRetries;
          const backoff = Math.min(maxDelayMs, baseDelayMs * (2 ** retry));
          const jittered = Math.round(backoff * (0.8 + random() * 0.4));
          const retryDelay = retryAfterMs(response.headers.get('retry-after'), now()) ?? jittered;
          const outcome = canRetry ? 'retry' : (hasNext && (retryable || response.status === 404) ? 'fallback' : 'stopped');
          attempts.push({
            provider: provider.name, model: provider.model, httpStatus: response.status,
            ...(details.code ? { providerCode: details.code } : {}),
            ...(details.status ? { providerStatus: details.status } : {}),
            ...(details.message ? { providerMessage: details.message } : {}),
            ...(canRetry ? { retryDelayMs: retryDelay } : {}),
            outcome
          });

          if (canRetry) {
            if (retryDelay >= deadline - now()) {
              throw new GeminiProjectGenerationError('Project generation retry budget was exhausted before the next provider attempt.', lastHttpStatus, attempts);
            }
            await sleep(retryDelay);
            continue;
          }
          if (hasNext && (retryable || response.status === 404)) {
            shouldFallback = true;
            break;
          }
          throw new GeminiProjectGenerationError(
            'Gemini rejected the project-generation request.',
            response.status,
            attempts
          );
        }

        if (!responseText || !Object.keys(payload).length) {
          throw new Error('The provider returned an invalid response body.');
        }
        const generatedText = extractGeneratedText(payload);
        attempts.push({ provider: provider.name, model: provider.model, outcome: 'success' });
        return { text: generatedText, provider: provider.name, model: provider.model, attempts };
      } catch (error) {
        if (error instanceof GeminiProjectGenerationError) throw error;
        lastHttpStatus = 502;
        const hasNext = providerIndex < configured.length - 1;
        const canRetry = retry < maxRetries && deadline - now() > 0;
        const backoff = Math.min(maxDelayMs, baseDelayMs * (2 ** retry));
        const retryDelay = Math.round(backoff * (0.8 + random() * 0.4));
        const message = safeProviderText(error instanceof Error ? error.message : 'Provider transport or response failure.');
        attempts.push({
          provider: provider.name, model: provider.model,
          ...(message ? { providerMessage: message } : {}),
          ...(canRetry ? { retryDelayMs: retryDelay } : {}),
          outcome: canRetry ? 'retry' : hasNext ? 'fallback' : 'stopped'
        });
        if (canRetry) {
          if (retryDelay >= deadline - now()) {
            throw new GeminiProjectGenerationError('Project generation retry budget was exhausted before the next provider attempt.', lastHttpStatus, attempts);
          }
          await sleep(retryDelay);
          continue;
        }
        if (hasNext) {
          shouldFallback = true;
          break;
        }
        throw new GeminiProjectGenerationError('All configured Gemini providers failed to generate valid project files.', lastHttpStatus, attempts);
      }
    }

    if (!shouldFallback && providerIndex < configured.length - 1) {
      shouldFallback = true;
    }
    if (providerIndex === configured.length - 1) {
      throw new GeminiProjectGenerationError('All configured Gemini providers failed to generate valid project files.', lastHttpStatus, attempts);
    }
  }

  throw new GeminiProjectGenerationError('Gemini project generation failed.', lastHttpStatus, attempts);
}
