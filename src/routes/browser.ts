import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { openWeb, searchWeb } from '../services/browser.service.js';

const router = Router();
router.use(requireAuth);

router.post('/search', async (req, res, next) => {
  try {
    const body = z.object({ query: z.string().trim().min(1).max(1000), maxResults: z.number().int().min(1).max(10).optional() }).parse(req.body);
    res.json({ data: await searchWeb(body.query, body) });
  } catch (error) { next(error); }
});

router.post('/open', async (req, res, next) => {
  try {
    const body = z.object({ url: z.string().url(), prompt: z.string().trim().max(4000).optional() }).parse(req.body);
    res.json({ data: await openWeb(body.url, body.prompt) });
  } catch (error) { next(error); }
});

export const browserRouter = router;
