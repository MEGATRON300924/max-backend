import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../types/auth.js';
import { connectProvider, disconnectProvider, listConnections } from '../services/connect.service.js';

const router = Router();
router.use(requireAuth);

function token(req: AuthenticatedRequest) {
  const value = req.header('authorization');
  if (!value) throw new Error('Missing authorization header');
  return value;
}

router.get('/accounts', async (req: AuthenticatedRequest, res, next) => {
  try { res.json({ data: await listConnections(token(req)) }); } catch (error) { next(error); }
});

router.get('/:provider/connect', async (req: AuthenticatedRequest, res, next) => {
  try { res.json({ data: await connectProvider(token(req), z.string().min(1).max(50).parse(req.params.provider)) }); } catch (error) { next(error); }
});

router.delete('/accounts/:accountId', async (req: AuthenticatedRequest, res, next) => {
  try { res.json({ data: await disconnectProvider(token(req), z.string().uuid().parse(req.params.accountId)) }); } catch (error) { next(error); }
});

export const connectRouter = router;
