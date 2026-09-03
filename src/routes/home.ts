import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../types/auth.js';
import { resolveEcosystemUser } from '../services/user.service.js';
import { homeStatus, maxHomeRequest } from '../services/home.service.js';

const actionSchema = z.object({
  action: z.string().trim().min(1).max(100),
  targetId: z.string().trim().max(200).optional(),
  parameters: z.record(z.unknown()).optional()
});

export const homeRouter = Router();
homeRouter.use(requireAuth);

homeRouter.get('/status', (_req, res) => {
  res.json({ data: homeStatus() });
});

homeRouter.get('/homes', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await resolveEcosystemUser(req.auth!);
    const data = await maxHomeRequest({ path: `/api/v1/users/${encodeURIComponent(user.authSubject)}/homes` });
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

homeRouter.post('/actions', async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = actionSchema.parse(req.body);
    const user = await resolveEcosystemUser(req.auth!);
    const data = await maxHomeRequest({
      path: `/api/v1/users/${encodeURIComponent(user.authSubject)}/actions`,
      method: 'POST',
      body: input
    });
    res.json({ data });
  } catch (error) {
    next(error);
  }
});
