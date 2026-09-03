import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';
import type { AuthenticatedRequest } from '../types/auth.js';
import { resolveEcosystemUser } from '../services/user.service.js';
import { generateGeminiResponse } from '../services/ai.service.js';

const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(200).optional()
});

const messageSchema = z.object({
  content: z.string().trim().min(1).max(20000)
});

export const conversationsRouter = Router();
conversationsRouter.use(requireAuth);

async function getUser(req: AuthenticatedRequest) {
  return resolveEcosystemUser(req.auth!);
}

async function getConversationForUser(id: string, userId: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id, userId },
    include: { messages: { orderBy: { createdAt: 'asc' } } }
  });

  if (!conversation) {
    throw new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
  }

  return conversation;
}

conversationsRouter.post('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = createConversationSchema.parse(req.body);
    const user = await getUser(req);
    const conversation = await prisma.conversation.create({
      data: { userId: user.id, title: input.title }
    });
    res.status(201).json({ data: conversation });
  } catch (error) {
    next(error);
  }
});

conversationsRouter.get('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await getUser(req);
    const conversations = await prisma.conversation.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, status: true, createdAt: true, updatedAt: true }
    });
    res.json({ data: conversations });
  } catch (error) {
    next(error);
  }
});

conversationsRouter.get('/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await getUser(req);
    const conversation = await getConversationForUser(req.params.id, user.id);
    res.json({ data: conversation });
  } catch (error) {
    next(error);
  }
});

conversationsRouter.delete('/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await getUser(req);
    await getConversationForUser(req.params.id, user.id);
    await prisma.conversation.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

conversationsRouter.post('/:id/messages', async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = messageSchema.parse(req.body);
    const user = await getUser(req);
    const conversation = await getConversationForUser(req.params.id, user.id);

    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'USER',
        content: input.content
      }
    });

    const turns = [...conversation.messages, { role: 'USER' as const, content: input.content }]
      .filter((message) => message.role === 'USER' || message.role === 'ASSISTANT')
      .slice(-40)
      .map((message) => ({
        role: message.role === 'USER' ? 'user' as const : 'model' as const,
        content: message.content
      }));

    const generated = await generateGeminiResponse(turns);
    const assistantMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'ASSISTANT',
        content: generated.text,
        provider: generated.provider,
        model: generated.model
      }
    });

    res.status(201).json({ data: assistantMessage });
  } catch (error) {
    next(error);
  }
});
