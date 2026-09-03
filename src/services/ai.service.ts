import { env } from '../config/env.js';
import { ApiError } from '../middleware/errors.js';

export type ChatTurn = {
  role: 'user' | 'model';
  content: string;
};

export type GeminiFunctionDeclaration = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type GeminiFunctionCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

type GeminiPart = {
  text?: string;
  functionCall?: {
    id?: string;
    name?: string;
    args?: Record<string, unknown>;
  };
};

type GeminiPayload = {
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
};

function assertConfigured() {
  if (!env.GEMINI_API_KEY) {
    throw new ApiError(503, 'AI_NOT_CONFIGURED', 'The MAX AI provider is not configured');
  }
}

function requestBody(turns: ChatTurn[], functions: GeminiFunctionDeclaration[] = []) {
  return JSON.stringify({
    contents: turns.map((turn) => ({ role: turn.role, parts: [{ text: turn.content }] })),
    ...(functions.length ? { tools: [{ functionDeclarations: functions }] } : {})
  });
}

function extract(payload: GeminiPayload) {
  const parts = payload.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((part) => part.text ?? '').join('').trim();
  const functionCalls = parts.flatMap((part): GeminiFunctionCall[] => {
    const call = part.functionCall;
    if (!call?.name) return [];
    return [{ id: call.id ?? crypto.randomUUID(), name: call.name, args: call.args ?? {} }];
  });
  return { text, functionCalls };
}

export async function generateGeminiResponse(turns: ChatTurn[]) {
  const result = await generateGeminiResponseWithTools(turns);
  if (!result.text) throw new ApiError(502, 'AI_EMPTY_RESPONSE', 'The MAX AI provider returned no response');
  return { text: result.text, provider: 'gemini', model: env.GEMINI_MODEL };
}

export async function generateGeminiResponseWithTools(turns: ChatTurn[], functions: GeminiFunctionDeclaration[] = []) {
  assertConfigured();
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY!)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: requestBody(turns, functions)
  });
  if (!response.ok) throw new ApiError(502, 'AI_PROVIDER_ERROR', 'The MAX AI provider could not complete the request');
  const payload = (await response.json()) as GeminiPayload;
  return { ...extract(payload), provider: 'gemini', model: env.GEMINI_MODEL };
}

export async function streamGeminiResponse(turns: ChatTurn[], onText: (text: string) => void) {
  assertConfigured();
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_MODEL)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(env.GEMINI_API_KEY!)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: requestBody(turns)
  });
  if (!response.ok || !response.body) throw new ApiError(502, 'AI_PROVIDER_ERROR', 'The MAX AI provider could not start the stream');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = ''; let fullText = '';
  const consume = (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim();
      if (!raw) continue;
      try {
        const text = extract(JSON.parse(raw) as GeminiPayload).text;
        if (text) { fullText += text; onText(text); }
      } catch { continue; }
    }
  };
  while (true) { const { value, done } = await reader.read(); if (done) break; consume(decoder.decode(value, { stream: true })); }
  consume(decoder.decode());
  if (!fullText.trim()) throw new ApiError(502, 'AI_EMPTY_RESPONSE', 'The MAX AI provider returned no response');
  return { text: fullText, provider: 'gemini', model: env.GEMINI_MODEL };
}
