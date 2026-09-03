import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../types/auth.js';
import { resolveEcosystemUser } from '../services/user.service.js';
import { cancelPendingAction, confirmPendingAction, executeConfirmedAction, getPendingAction } from '../services/confirmation.service.js';

const idSchema = z.object({ id: z.string().uuid() });

export const confirmationsRouter = Router();
confirmationsRouter.use(requireAuth);

confirmationsRouter.get('/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = idSchema.parse(req.params);
    const user = await resolveEcosystemUser(req.auth!);
    const action = await getPendingAction(user.id, id);
    res.json({ data: action });
  } catch (error) {
    next(error);
  }
});

confirmationsRouter.post('/:id/confirm', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = idSchema.parse(req.params);
    const user = await resolveEcosystemUser(req.auth!);
    const action = await confirmPendingAction(user.id, id);
    res.json({ data: action });
  } catch (error) {
    next(error);
  }
});

confirmationsRouter.post('/:id/execute', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = idSchema.parse(req.params);
    const user = await resolveEcosystemUser(req.auth!);
    const result = await executeConfirmedAction(user.id, user.authSubject, id);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

confirmationsRouter.post('/:id/cancel', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = idSchema.parse(req.params);
    const user = await resolveEcosystemUser(req.auth!);
    const action = await cancelPendingAction(user.id, id);
    res.json({ data: action });
  } catch (error) {
    next(error);
  }
});
