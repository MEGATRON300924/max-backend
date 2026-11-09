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

export const oauthMemoryRouter = Router();
oauthMemoryRouter.get('/oauth', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const scopes = Array.isArray(req.auth?.claims.scopes)
      ? req.auth.claims.scopes.filter((scope): scope is string => typeof scope === 'string')
      : [];
    if (!scopes.includes('memory:read')) {
      res.status(403).json({
        success: false,
        error: { code: 'INSUFFICIENT_SCOPE', message: 'The access token does not include MAX Memory permission' }
      });
      return;
    }

    const user = await resolveEcosystemUser(req.auth!);
    const memories = await prisma.memory.findMany({
      where: {
        userId: user.id,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
      },
      orderBy: { updatedAt: 'desc' },
      take: 1000
    });

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.json({
      success: true,
      data: memories.map((memory) => ({
        id: memory.id,
        type: memory.type,
        content: memory.value,
        source: memory.source ?? 'MAX',
        productSource: memory.productSource ?? 'max-backend',
        confidence: memory.confidence ?? 0.5,
        importance: memory.importance,
        isExplicit: memory.isExplicit,
        expiresAt: memory.expiresAt?.toISOString() ?? null,
        createdAt: memory.createdAt.toISOString(),
        updatedAt: memory.updatedAt.toISOString()
      }))
    });
  } catch (error) {
    next(error);
  }
});

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
    const id = z.string().uuid().parse(req.params.id);
    const user = await resolveEcosystemUser(req.auth!);
    const result = await prisma.memory.deleteMany({ where: { id, userId: user.id } });
    if (result.count === 0) {
      res.status(404).json({ success: false, error: { code: 'MEMORY_NOT_FOUND', message: 'Memory not found' } });
      return;
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
