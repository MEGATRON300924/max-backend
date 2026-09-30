import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../types/auth.js';
import { env } from '../config/env.js';
import { ApiError } from '../middleware/errors.js';

const router = Router();
router.use(requireAuth);

router.post('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!env.GEMINI_API_KEY) throw new ApiError(503, 'AI_NOT_CONFIGURED', 'The MAX AI provider is not configured');
    const body = z.object({
      imageBase64: z.string().min(1),
      mimeType: z.enum(['image/jpeg','image/png','image/webp','image/gif']).default('image/jpeg'),
      prompt: z.string().min(1).max(2000).default('Explain what is visible on this TV screen.')
    }).parse(req.body);
    const raw = Buffer.from(body.imageBase64, 'base64');
    if (raw.length > 10 * 1024 * 1024) throw new ApiError(413, 'VISION_PAYLOAD_TOO_LARGE', 'Screen Vision images must be 10 MB or smaller');

    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [
          { text: body.prompt },
          { inline_data: { mime_type: body.mimeType, data: body.imageBase64 } }
        ] }]
      })
    });
    if (!response.ok) throw new ApiError(502, 'VISION_PROVIDER_ERROR', 'The MAX vision provider could not process the image');
    const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim();
    if (!text) throw new ApiError(502, 'VISION_EMPTY_RESPONSE', 'The vision provider returned no response');
    res.json({ data: { text, provider: 'gemini' } });
  } catch (error) { next(error); }
});

export const visionRouter = router;
