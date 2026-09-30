import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { storeService } from '../services/store.service.js';

const router = Router();
router.use(requireAuth);

router.get('/products', async (req, res, next) => {
  try {
    const query = z.object({ q: z.string().max(300).optional(), category: z.string().max(100).optional(), page: z.coerce.number().int().min(1).max(1000).optional(), limit: z.coerce.number().int().min(1).max(100).optional() }).parse(req.query);
    res.json({ data: await storeService.search(query) });
  } catch (error) { next(error); }
});
router.get('/products/:slug', async (req, res, next) => {
  try { res.json({ data: await storeService.product(z.string().min(1).max(300).parse(req.params.slug)) }); } catch (error) { next(error); }
});

export const storeRouter = router;
