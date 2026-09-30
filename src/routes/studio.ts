import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { generateStudioAsset } from '../services/studio.service.js';

const router = Router();
router.use(requireAuth);

router.post('/generate', async (req, res, next) => {
  try {
    const body = z.object({ prompt: z.string().trim().min(1).max(20000), type: z.enum(['text','code','prompt']).default('text'), context: z.string().max(20000).optional() }).parse(req.body);
    res.json({ data: await generateStudioAsset(body) });
  } catch (error) { next(error); }
});

export const studioRouter = router;
