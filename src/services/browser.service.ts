import { env } from '../config/env.js';
import { ApiError } from '../middleware/errors.js';

type BrowserCitation = { title?: string; url: string };

function extractGemini(payload: any) {
  const citations: BrowserCitation[] = [];
  const textParts: string[] = [];
  for (const step of payload?.steps ?? []) {
    if (step?.type !== 'model_output') continue;
    for (const block of step?.content ?? []) {
      if (block?.type !== 'text') continue;
      if (typeof block.text === 'string') textParts.push(block.text);
      for (const annotation of block.annotations ?? []) {
        if (annotation?.type === 'url_citation' && typeof annotation.url === 'string') {
          citations.push({ title: annotation.title, url: annotation.url });
        }
      }
    }
  }
  return {
    text: payload?.output_text?.trim() || textParts.join('').trim(),
    citations: [...new Map(citations.map((item) => [item.url, item])).values()]
  };
}

function assertConfigured() {
  if (!env.GEMINI_API_KEY) {
    throw new ApiError(503, 'BROWSER_NOT_CONFIGURED', 'MAX Browser requires the Gemini provider to be configured.');
  }
}

async function geminiInteract(input: string, tools: Array<{ type: string }>) {
  if (!env.GEMINI_API_KEY) {
    throw new ApiError(503, 'BROWSER_NOT_CONFIGURED', 'Gemini web research is not configured.');
  }
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    signal: AbortSignal.timeout(90000),
    body: JSON.stringify({ model: env.GEMINI_MODEL, input, tools })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(502, 'BROWSER_PROVIDER_ERROR', body?.error?.message || 'MAX Browser could not retrieve web information.');
  }
  const result = extractGemini(body);
  if (!result.text) throw new ApiError(502, 'BROWSER_EMPTY_RESPONSE', 'Gemini returned no usable web research content.');
  return result;
}

export async function searchWeb(query: string, options?: { maxResults?: number }) {
  assertConfigured();
  const limit = Math.min(options?.maxResults ?? 8, 10);
  const instruction = `Search the public web for: ${query}. Return up to ${limit} distinct useful results. For each result provide its exact title, canonical URL, publication date when available, and a concise factual summary. Prefer primary and authoritative sources. Separate confirmed findings from uncertainty.`;
  const result = await geminiInteract(instruction, [{ type: 'google_search' }]);
  return { query, ...result };
}

export async function openWeb(url: string, prompt?: string) {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new ApiError(400, 'BROWSER_INVALID_URL', 'The URL is invalid'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new ApiError(400, 'BROWSER_PROTOCOL_NOT_ALLOWED', 'Only public HTTP and HTTPS URLs can be opened');
  }
  assertConfigured();
  const instruction = `Open and inspect this exact public web page: ${parsed.toString()}. ${prompt || 'Summarize the actual page content, identify its purpose and important sections, and list the canonical URL and any useful links you can verify. Do not merely guess from the URL.'}`;
  const result = await geminiInteract(instruction, [{ type: 'url_context' }]);
  return { url: parsed.toString(), ...result };
}
