import { env } from '../config/env.js';
import { ApiError } from '../middleware/errors.js';

export type ChatTurn = {
  role: 'user' | 'model';
  content: string;
};

type GeminiPayload = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
};

function assertConfigured() {
  if (!env.GEMINI_API_KEY) {
    throw new ApiError(503, 'AI_NOT_CONFIGURED', 'The MAX AI provider is not configured');
  }
}

function requestBody(turns: ChatTurn[]) {
  return JSON.stringify({
    contents: turns.map((turn) => ({
      role: turn.role,
      parts: [{ text: turn.content }]
    }))
  });
}

export async function generateGeminiResponse(turns: ChatTurn[]) {
  assertConfigured();

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY!)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: requestBody(turns)
    }
  );

  if (!response.ok) {
    throw new ApiError(502, 'AI_PROVIDER_ERROR', 'The MAX AI provider could not complete the request');
  }

  const payload = (await response.json()) as GeminiPayload;
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim();
  if (!text) {
    throw new ApiError(502, 'AI_EMPTY_RESPONSE', 'The MAX AI provider returned no response');
  }

  return { text, provider: 'gemini', model: env.GEMINI_MODEL };
}

export async function streamGeminiResponse(turns: ChatTurn[], onText: (text: string) => void) {
  assertConfigured();

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_MODEL)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(env.GEMINI_API_KEY!)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: requestBody(turns)
    }
  );

  if (!response.ok || !response.body) {
    throw new ApiError(502, 'AI_PROVIDER_ERROR', 'The MAX AI provider could not start the stream');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  const consume = (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim();
      if (!raw) continue;

      try {
        const payload = JSON.parse(raw) as GeminiPayload;
        const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
        if (text) {
          fullText += text;
          onText(text);
        }
      } catch {
        continue;
      }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    consume(decoder.decode(value, { stream: true }));
  }

  consume(decoder.decode());
  if (!fullText.trim()) {
    throw new ApiError(502, 'AI_EMPTY_RESPONSE', 'The MAX AI provider returned no response');
  }

  return { text: fullText, provider: 'gemini', model: env.GEMINI_MODEL };
}
