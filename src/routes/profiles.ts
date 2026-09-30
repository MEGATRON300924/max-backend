import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../types/auth.js';
import { prisma } from '../lib/prisma.js';
import { Prisma } from '@prisma/client';
import { resolveEcosystemUser } from '../services/user.service.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await resolveEcosystemUser(req.auth!);
    res.json({ data: await prisma.profile.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } }) });
  } catch (error) { next(error); }
});

router.post('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await resolveEcosystemUser(req.auth!);
    const body = z.object({
      name: z.string().min(1).max(100),
      profileType: z.enum(['adult','child','guest']).default('adult'),
      avatarUrl: z.string().url().optional(),
      permissions: z.record(z.unknown()).optional(),
      settings: z.record(z.unknown()).optional()
    }).parse(req.body);
    const profile = await prisma.profile.create({ data: { ...body, userId: user.id, permissions: body.permissions as Prisma.InputJsonValue | undefined, settings: body.settings as Prisma.InputJsonValue | undefined } });
    res.status(201).json({ data: profile });
  } catch (error) { next(error); }
});

router.patch('/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await resolveEcosystemUser(req.auth!);
    const id = z.string().uuid().parse(req.params.id);
    const body = z.object({
      name: z.string().min(1).max(100).optional(),
      avatarUrl: z.string().url().nullable().optional(),
      permissions: z.record(z.unknown()).optional(),
      settings: z.record(z.unknown()).optional()
    }).parse(req.body);
    const result = await prisma.profile.updateMany({ where: { id, userId: user.id }, data: { ...body, permissions: body.permissions as Prisma.InputJsonValue | undefined, settings: body.settings as Prisma.InputJsonValue | undefined } });
    if (!result.count) return res.status(404).json({ error: { code: 'PROFILE_NOT_FOUND', message: 'Profile not found' } });
    res.json({ data: await prisma.profile.findUnique({ where: { id } }) });
  } catch (error) { next(error); }
});

export const profilesRouter = router;
