import { generateGeminiResponse } from './ai.service.js';
import { ApiError } from '../middleware/errors.js';

export async function generateStudioAsset(input: { prompt: string; type: 'text' | 'code' | 'prompt'; context?: string }) {
  const instruction = input.type === 'code'
    ? 'Create production-quality code. Return only the requested code unless a brief explanation is essential.'
    : input.type === 'prompt'
      ? 'Create a polished reusable prompt for the requested task.'
      : 'Create the requested content clearly and naturally.';
  const context = input.context ? `\nContext:\n${input.context}` : '';
  const result = await generateGeminiResponse([
    { role: 'user', content: `${instruction}\n\nUser request:\n${input.prompt}${context}` }
  ]);
  if (!result.text) throw new ApiError(502, 'STUDIO_EMPTY_RESULT', 'MAX Studio returned no generated content');
  return { type: input.type, content: result.text, provider: result.provider, model: result.model, interactionId: result.interactionId };
}
