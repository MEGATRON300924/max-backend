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
  return { text: payload?.output_text?.trim() || textParts.join('').trim(), citations: [...new Map(citations.map((item) => [item.url, item])).values()] };
}

function extractGroq(content: string) {
  const citations: BrowserCitation[] = [];
  const markdownLinks = content.matchAll(/\[([^\]]{1,200})\]\((https?:\/\/[^\s)]+)\)/g);
  for (const match of markdownLinks) citations.push({ title: match[1], url: match[2] });
  const bareUrls = content.matchAll(/https?:\/\/[^\s)\]>]+/g);
  for (const match of bareUrls) citations.push({ url: match[0].replace(/[.,;]+$/, '') });
  return { text: content.trim(), citations: [...new Map(citations.map((item) => [item.url, item])).values()] };
}

function assertConfigured() {
  if (!env.GEMINI_API_KEY && !env.GROQ_API_KEY) {
    throw new ApiError(503, 'BROWSER_NOT_CONFIGURED', 'MAX Browser is not configured. Set GROQ_API_KEY or GEMINI_API_KEY.');
  }
}

async function groqInteract(input: string) {
  if (!env.GROQ_API_KEY) throw new ApiError(503, 'BROWSER_NOT_CONFIGURED', 'Groq web research is not configured.');
  const configuredModel = env.GROQ_MODEL;
  const model = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'].includes(configuredModel)
    ? configuredModel
    : 'openai/gpt-oss-20b';
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + env.GROQ_API_KEY,
      'content-type': 'application/json',
      accept: 'application/json'
    },
    signal: AbortSignal.timeout(90000),
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: 'You are MAX Browser, a careful web research assistant. Use browser search to inspect the requested subject or URL. Distinguish facts from inference, include the page title and canonical URL where available, and list the most relevant source links. Never claim to have read a page if the browser tool did not retrieve it.'
        },
        { role: 'user', content: input }
      ],
      tools: [{ type: 'browser_search' }],
      tool_choice: 'required',
      temperature: 0.2,
      reasoning_effort: 'low',
      max_completion_tokens: 4096
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(502, 'BROWSER_PROVIDER_ERROR', payload?.error?.message || 'Groq browser search could not retrieve web information.');
  }
  const text = payload?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new ApiError(502, 'BROWSER_EMPTY_RESPONSE', 'Groq browser search returned no usable page content.');
  return extractGroq(text);
}

async function geminiInteract(input: string, tools: Array<{ type: string }>) {
  if (!env.GEMINI_API_KEY) throw new ApiError(503, 'BROWSER_NOT_CONFIGURED', 'Gemini web research is not configured.');
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    signal: AbortSignal.timeout(90000),
    body: JSON.stringify({ model: env.GEMINI_MODEL, input, tools })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(502, 'BROWSER_PROVIDER_ERROR', body?.error?.message || 'MAX Browser could not retrieve web information.');
  return extractGemini(body);
}

export async function searchWeb(query: string, options?: { maxResults?: number }) {
  assertConfigured();
  const limit = Math.min(options?.maxResults ?? 8, 10);
  const instruction = `Search the public web for: ${query}. Return up to ${limit} distinct useful results. For each result provide its exact title, canonical URL, publication date when available, and a concise factual summary. Prefer primary and authoritative sources. Separate confirmed findings from uncertainty.`;
  const result = env.GROQ_API_KEY
    ? await groqInteract(instruction)
    : await geminiInteract(instruction, [{ type: 'google_search' }]);
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
  const result = env.GROQ_API_KEY
    ? await groqInteract(instruction)
    : await geminiInteract(instruction, [{ type: 'url_context' }]);
  return { url: parsed.toString(), ...result };
}
