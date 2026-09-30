import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { tvAssistant, tvSearch } from '../services/tv.service.js';

const router = Router();
router.use(requireAuth);

router.post('/search', async (req, res, next) => {
  try {
    const body = z.object({ query: z.string().trim().min(1).max(1000) }).parse(req.body);
    res.json({ data: await tvSearch(body.query) });
  } catch (error) { next(error); }
});

router.post('/assistant', async (req, res, next) => {
  try {
    const body = z.object({ request: z.string().trim().min(1).max(10000), context: z.record(z.unknown()).optional() }).parse(req.body);
    res.json({ data: await tvAssistant(body.request, body.context) });
  } catch (error) { next(error); }
});

export const tvRouter = router;
