import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/errors.js';
import { executeTool } from './tools.service.js';

const DEFAULT_TTL_MS = 5 * 60 * 1000;

const actionSelect = {
  id: true,
  toolName: true,
  arguments: true,
  status: true,
  expiresAt: true,
  createdAt: true,
  confirmedAt: true
} as const;

export async function createPendingAction(userId: string, toolName: string, argumentsValue: Record<string, unknown>) {
  const expiresAt = new Date(Date.now() + DEFAULT_TTL_MS);
  return prisma.pendingAction.create({
    data: { userId, toolName, arguments: argumentsValue, expiresAt },
    select: actionSelect
  });
}

export async function getPendingAction(userId: string, actionId: string) {
  const action = await prisma.pendingAction.findFirst({
    where: { id: actionId, userId },
    select: { ...actionSelect, userId: true }
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
    select: actionSelect
  });
}

export async function executeConfirmedAction(userId: string, authSubject: string, actionId: string) {
  const action = await getPendingAction(userId, actionId);

  if (action.status !== 'CONFIRMED') {
    throw new ApiError(409, 'CONFIRMATION_NOT_EXECUTABLE', 'Confirmation request must be confirmed before execution');
  }

  const claimed = await prisma.pendingAction.updateMany({
    where: { id: action.id, userId, status: 'CONFIRMED' },
    data: { status: 'EXECUTING' }
  });

  if (claimed.count !== 1) {
    throw new ApiError(409, 'CONFIRMATION_ALREADY_EXECUTING', 'Confirmation request is already being executed');
  }

  try {
    const result = await executeTool(action.toolName, {
      userId,
      authSubject,
      confirmed: true
    }, action.arguments);

    await prisma.pendingAction.update({
      where: { id: action.id },
      data: { status: 'COMPLETED' }
    });

    return { actionId: action.id, status: 'COMPLETED', result };
  } catch (error) {
    await prisma.pendingAction.update({
      where: { id: action.id },
      data: { status: 'FAILED' }
    });
    throw error;
  }
}

export async function cancelPendingAction(userId: string, actionId: string) {
  const action = await getPendingAction(userId, actionId);

  if (action.status !== 'PENDING') {
    throw new ApiError(409, 'CONFIRMATION_NOT_PENDING', 'Confirmation request is no longer pending');
  }

  return prisma.pendingAction.update({
    where: { id: action.id },
    data: { status: 'CANCELLED' },
    select: { id: true, status: true }
  });
}
