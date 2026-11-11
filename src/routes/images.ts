import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { env } from '../config/env.js';
import { ApiError } from '../middleware/errors.js';

const router = Router();
router.use(requireAuth);

router.post('/generate', async (req, res, next) => {
  try {
    const input = z.object({
      prompt: z.string().trim().min(1).max(8000),
      size: z.enum(['1024x1024', '1536x1024', '1024x1536', 'auto']).default('1024x1024')
    }).parse(req.body);
    if (!env.OPENAI_API_KEY) {
      throw new ApiError(503, 'IMAGE_PROVIDER_NOT_CONFIGURED', 'MAX image generation is not configured. Add OPENAI_API_KEY to the MAX backend service.');
    }

    const generate = async (size: string) => fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.OPENAI_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      signal: AbortSignal.timeout(90000),
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt: input.prompt,
        size,
        quality: 'medium',
        output_format: 'png'
      })
    });

    let response = await generate(input.size);
    let payload = await response.json().catch(() => ({}));
    const providerMessage = String(payload?.error?.message || '');
    if (!response.ok && /size|dimension|resolution/i.test(providerMessage) && input.size !== 'auto') {
      response = await generate('auto');
      payload = await response.json().catch(() => ({}));
    }
    if (!response.ok) {
      const message = payload?.error?.message || 'The image provider could not generate this image.';
      throw new ApiError(response.status === 429 ? 429 : 502, 'IMAGE_PROVIDER_ERROR', message);
    }
    const image = payload?.data?.[0];
    if (typeof image?.b64_json !== 'string' || !image.b64_json) {
      throw new ApiError(502, 'IMAGE_EMPTY_RESPONSE', 'The image provider returned no image data.');
    }
    res.json({ data: { base64: image.b64_json, mimeType: 'image/png', revisedPrompt: image.revised_prompt || null, provider: 'openai' } });
  } catch (error) { next(error); }
});

export const imagesRouter = router;
