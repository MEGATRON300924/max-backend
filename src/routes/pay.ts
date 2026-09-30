import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../types/auth.js';
import { checkoutUrl, entitlements } from '../services/pay.service.js';

const router = Router();
router.use(requireAuth);

router.get('/entitlements', (req: AuthenticatedRequest, res) => {
  res.json({ data: entitlements(req.auth!.tier) });
});
router.get('/checkout', (_req, res, next) => {
  try { res.json({ data: { url: checkoutUrl() } }); } catch (error) { next(error); }
});

export const payRouter = router;
