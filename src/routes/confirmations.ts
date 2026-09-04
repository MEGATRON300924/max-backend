import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../types/auth.js';
import { resolveEcosystemUser } from '../services/user.service.js';
import { cancelPendingAction, confirmPendingAction, executeConfirmedAction, getPendingAction } from '../services/confirmation.service.js';
import { continueAfterConfirmation } from '../services/orchestrator.service.js';

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
    const execution = await executeConfirmedAction(user.id, user.authSubject, id);
    const response = await continueAfterConfirmation(user, execution.action, execution.result);
    const assistantMessage = await prisma.message.create({
      data: {
        conversationId: execution.action.conversationId,
        role: 'ASSISTANT',
        content: response.text,
        provider: response.provider,
        model: response.model,
        metadata: {
          intent: response.intent,
          tools: response.tools,
          confirmations: response.confirmations,
          interactionId: response.interactionId,
          confirmationId: execution.action.id
        }
      }
    });

    res.json({
      data: {
        actionId: execution.action.id,
        status: execution.action.status,
        result: execution.result,
        message: assistantMessage
      },
      confirmations: response.confirmations
    });
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
