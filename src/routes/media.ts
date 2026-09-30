import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../types/auth.js';
import { prisma } from '../lib/prisma.js';
import { resolveEcosystemUser } from '../services/user.service.js';
import { createDeviceCommand } from '../services/event.service.js';

const router = Router();
router.use(requireAuth);

router.get('/continue', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await resolveEcosystemUser(req.auth!);
    res.json({ data: await prisma.mediaState.findMany({ where: { userId: user.id }, orderBy: { updatedAt: 'desc' } }) });
  } catch (error) { next(error); }
});

router.post('/continue', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await resolveEcosystemUser(req.auth!);
    const body = z.object({
      contentId: z.string().min(1).max(500),
      contentType: z.string().min(1).max(50),
      title: z.string().max(500).optional(),
      positionMs: z.number().int().nonnegative(),
      durationMs: z.number().int().positive().optional(),
      sourceDeviceId: z.string().uuid().optional()
    }).parse(req.body);
    const state = await prisma.mediaState.upsert({
      where: { userId_contentId: { userId: user.id, contentId: body.contentId } },
      create: { ...body, userId: user.id },
      update: body
    });
    res.json({ data: state });
  } catch (error) { next(error); }
});

router.post('/send', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await resolveEcosystemUser(req.auth!);
    const body = z.object({
      deviceId: z.string().uuid(),
      contentId: z.string().min(1),
      positionMs: z.number().int().nonnegative().default(0),
      action: z.enum(['open','play','pause','seek']).default('open')
    }).parse(req.body);
    const event = await createDeviceCommand(user.id, body.deviceId, 'media', body);
    res.status(202).json({ data: event });
  } catch (error) { next(error); }
});

export const mediaRouter = router;
