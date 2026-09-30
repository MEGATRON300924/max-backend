import { env } from '../config/env.js';
import { ApiError } from '../middleware/errors.js';

type BrowserCitation = { title?: string; url: string };

function assertConfigured() {
  if (!env.GEMINI_API_KEY) throw new ApiError(503, 'BROWSER_NOT_CONFIGURED', 'MAX Browser requires the Gemini provider');
}

function extract(payload: any) {
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
  return { text: payload?.output_text?.trim() || textParts.join('').trim(), citations: [...new Map(citations.map((item) => [item.url, item])).values()] };
}

async function interact(input: string, tools: Array<{ type: string }>) {
  assertConfigured();
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY! },
    body: JSON.stringify({ model: env.GEMINI_MODEL, input, tools })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(502, 'BROWSER_PROVIDER_ERROR', body?.error?.message || 'MAX Browser could not retrieve web information');
  return extract(body);
}

export async function searchWeb(query: string, options?: { maxResults?: number }) {
  const result = await interact(
    `Search the public web for: ${query}. Return the most useful current results and concise factual summaries. Prefer primary or authoritative sources. Return at most ${Math.min(options?.maxResults ?? 8, 10)} distinct sources.`,
    [{ type: 'google_search' }]
  );
  return { query, ...result };
}

export async function openWeb(url: string, prompt?: string) {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new ApiError(400, 'BROWSER_INVALID_URL', 'The URL is invalid'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new ApiError(400, 'BROWSER_PROTOCOL_NOT_ALLOWED', 'Only HTTP and HTTPS URLs can be opened');
  const result = await interact(
    `Read and analyze this public web page: ${parsed.toString()}. ${prompt || 'Summarize the page accurately, preserving important names, dates, numbers and links.'}`,
    [{ type: 'url_context' }]
  );
  return { url: parsed.toString(), ...result };
}
