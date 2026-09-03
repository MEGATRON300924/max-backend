import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../types/auth.js';
import { resolveEcosystemUser } from '../services/user.service.js';

const memorySchema = z.object({
  type: z.enum(['PREFERENCE', 'FACT', 'INTEREST', 'ROUTINE', 'INSTRUCTION']),
  key: z.string().trim().min(1).max(120),
  value: z.string().trim().min(1).max(4000),
  source: z.string().trim().max(120).optional(),
  confidence: z.number().min(0).max(1).optional()
});

export const memoriesRouter = Router();
memoriesRouter.use(requireAuth);

memoriesRouter.get('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await resolveEcosystemUser(req.auth!);
    const type = req.query.type ? z.enum(['PREFERENCE', 'FACT', 'INTEREST', 'ROUTINE', 'INSTRUCTION']).parse(req.query.type) : undefined;
    const memories = await prisma.memory.findMany({
      where: { userId: user.id, ...(type ? { type } : {}) },
      orderBy: { updatedAt: 'desc' }
    });
    res.json({ data: memories });
  } catch (error) {
    next(error);
  }
});

memoriesRouter.put('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = memorySchema.parse(req.body);
    const user = await resolveEcosystemUser(req.auth!);
    const memory = await prisma.memory.upsert({
      where: { userId_type_key: { userId: user.id, type: input.type, key: input.key } },
      create: { userId: user.id, ...input },
      update: { value: input.value, source: input.source, confidence: input.confidence }
    });
    res.json({ data: memory });
  } catch (error) {
    next(error);
  }
});

memoriesRouter.delete('/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await resolveEcosystemUser(req.auth!);
    const result = await prisma.memory.deleteMany({ where: { id: req.params.id, userId: user.id } });
    if (result.count === 0) {
      res.status(404).json({ success: false, error: { code: 'MEMORY_NOT_FOUND', message: 'Memory not found' } });
      return;
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
