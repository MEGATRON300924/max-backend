import { env } from '../config/env.js';
import { ApiError } from '../middleware/errors.js';

type ChatTurn = {
  role: 'user' | 'model';
  content: string;
};

export async function generateGeminiResponse(turns: ChatTurn[]) {
  if (!env.GEMINI_API_KEY) {
    throw new ApiError(503, 'AI_NOT_CONFIGURED', 'The MAX AI provider is not configured');
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: turns.map((turn) => ({
          role: turn.role,
          parts: [{ text: turn.content }]
        }))
      })
    }
  );

  if (!response.ok) {
    throw new ApiError(502, 'AI_PROVIDER_ERROR', 'The MAX AI provider could not complete the request');
  }

  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim();
  if (!text) {
    throw new ApiError(502, 'AI_EMPTY_RESPONSE', 'The MAX AI provider returned no response');
  }

  return { text, provider: 'gemini', model: env.GEMINI_MODEL };
}
