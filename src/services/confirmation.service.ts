import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/errors.js';

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export async function createPendingAction(userId: string, toolName: string, argumentsValue: Record<string, unknown>) {
  const expiresAt = new Date(Date.now() + DEFAULT_TTL_MS);
  const action = await prisma.pendingAction.create({
    data: {
      userId,
      toolName,
      arguments: argumentsValue,
      expiresAt
    },
    select: {
      id: true,
      toolName: true,
      arguments: true,
      status: true,
      expiresAt: true,
      createdAt: true
    }
  });

  return action;
}

export async function getPendingAction(userId: string, actionId: string) {
  const action = await prisma.pendingAction.findFirst({
    where: { id: actionId, userId },
    select: {
      id: true,
      userId: true,
      toolName: true,
      arguments: true,
      status: true,
      expiresAt: true,
      createdAt: true,
      confirmedAt: true
    }
  });

  if (!action) throw new ApiError(404, 'CONFIRMATION_NOT_FOUND', 'Confirmation request was not found');

  if (action.status === 'PENDING' && action.expiresAt.getTime() <= Date.now()) {
    await prisma.pendingAction.update({ where: { id: action.id }, data: { status: 'EXPIRED' } });
    throw new ApiError(410, 'CONFIRMATION_EXPIRED', 'Confirmation request has expired');
  }

  return action;
}

export async function confirmPendingAction(userId: string, actionId: string) {
  const action = await getPendingAction(userId, actionId);

  if (action.status !== 'PENDING') {
    throw new ApiError(409, 'CONFIRMATION_NOT_PENDING', 'Confirmation request is no longer pending');
  }

  return prisma.pendingAction.update({
    where: { id: action.id },
    data: { status: 'CONFIRMED', confirmedAt: new Date() },
    select: {
      id: true,
      toolName: true,
      arguments: true,
      status: true,
      expiresAt: true,
      confirmedAt: true
    }
  });
}

export async function cancelPendingAction(userId: string, actionId: string) {
  const action = await getPendingAction(userId, actionId);

  if (action.status !== 'PENDING') {
    throw new ApiError(409, 'CONFIRMATION_NOT_PENDING', 'Confirmation request is no longer pending');
  }

  return prisma.pendingAction.update({
    where: { id: action.id },
    data: { status: 'CANCELLED' },
    select: {
      id: true,
      status: true
    }
  });
}
