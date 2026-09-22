import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/errors.js';
import { executeTool } from './tools.service.js';
import { recordAuditEvent } from './audit.service.js';

const DEFAULT_TTL_MS = 5 * 60 * 1000;

function confirmationTime(value: unknown, timeZone?: string) {
  if (typeof value !== 'string') return null;
  const hasOffset = /[zZ]|[+-]\\d{2}:?\\d{2}$/.test(value);
  if (!hasOffset) return value.replace('T', ' ') + (timeZone ? ` (${timeZone})` : '');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(date);
}

const actionSelect = {
  id: true,
  userId: true,
  conversationId: true,
  interactionId: true,
  callId: true,
  toolName: true,
  arguments: true,
  status: true,
  expiresAt: true,
  createdAt: true,
  confirmedAt: true
} as const;

type PendingActionContext = {
  conversationId: string;
  interactionId: string;
  callId: string;
};

function formatDateTime(value: unknown) {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

function formatConfirmationSummary(toolName: string, args: Record<string, unknown>) {
  if (!toolName.startsWith('calendar.')) return null;
  const event = typeof args.event === 'object' && args.event !== null ? args.event as Record<string, unknown> : {};
  const context = typeof args.confirmationContext === 'object' && args.confirmationContext !== null ? args.confirmationContext as Record<string, unknown> : {};
  const summary = typeof context.summary === 'string' ? context.summary : typeof event.summary === 'string' ? event.summary : 'this event';
  const contextStart = typeof context.start === 'object' && context.start !== null ? context.start as Record<string, unknown> : null;
  const contextEnd = typeof context.end === 'object' && context.end !== null ? context.end as Record<string, unknown> : null;
  const eventTimeZone = typeof contextStart?.timeZone === 'string' ? contextStart.timeZone : typeof (event.start as any)?.timeZone === 'string' ? (event.start as any).timeZone : undefined;
  if (toolName === 'calendar.create') {
    const start = contextStart?.dateTime ?? (typeof event.start === 'object' && event.start !== null ? (event.start as Record<string, unknown>).dateTime : null);
    const end = contextEnd?.dateTime ?? (typeof event.end === 'object' && event.end !== null ? (event.end as Record<string, unknown>).dateTime : null);
    const when = start ? ` on ${confirmationTime(start, eventTimeZone)}${end ? `–${confirmationTime(end, eventTimeZone)}` : ''}` : '';
    return `Create “${summary}”${when}`;
  }
  if (toolName === 'calendar.update') {
    const eventId = typeof args.eventId === 'string' ? args.eventId : 'the selected event';
    const changes = Object.keys(event).filter((key) => key !== 'id').join(', ');
    const when = start ? ` (${confirmationTime(start, eventTimeZone)}${end ? `–${confirmationTime(end, eventTimeZone)}` : ''})` : '';
    return `Update “${summary}”${when}${changes ? `: ${changes}` : ''}`;
  }
  if (toolName === 'calendar.delete') return `Delete “${summary}”`;
  return null;
}

export async function createPendingAction(
  userId: string,
  toolName: string,
  argumentsValue: Record<string, unknown>,
  context: PendingActionContext
) {
  const expiresAt = new Date(Date.now() + DEFAULT_TTL_MS);
  const action = await prisma.pendingAction.create({
    data: {
      userId,
      conversationId: context.conversationId,
      interactionId: context.interactionId,
      callId: context.callId,
      toolName,
      arguments: argumentsValue,
      expiresAt
    },
    select: actionSelect
  });

  await recordAuditEvent({
    userId,
    eventType: 'confirmation',
    action: 'created',
    resourceType: 'pending_action',
    resourceId: action.id,
    status: 'PENDING',
    metadata: { toolName, conversationId: context.conversationId }
  });

  return { ...action, confirmationSummary: formatConfirmationSummary(toolName, argumentsValue) };
}

export async function getPendingAction(userId: string, actionId: string) {
  const action = await prisma.pendingAction.findFirst({
    where: { id: actionId, userId },
    select: actionSelect
  });

  if (!action) throw new ApiError(404, 'CONFIRMATION_NOT_FOUND', 'Confirmation request was not found');

  if (action.status === 'PENDING' && action.expiresAt.getTime() <= Date.now()) {
    await prisma.pendingAction.update({ where: { id: action.id }, data: { status: 'EXPIRED' } });
    await recordAuditEvent({
      userId,
      eventType: 'confirmation',
      action: 'expired',
      resourceType: 'pending_action',
      resourceId: action.id,
      status: 'EXPIRED',
      metadata: { toolName: action.toolName }
    });
    throw new ApiError(410, 'CONFIRMATION_EXPIRED', 'Confirmation request has expired');
  }

  return {
    ...action,
    confirmationSummary: formatConfirmationSummary(action.toolName, action.arguments as Record<string, unknown>)
  };
}

export async function confirmPendingAction(userId: string, actionId: string) {
  const action = await getPendingAction(userId, actionId);

  if (action.status !== 'PENDING') {
    throw new ApiError(409, 'CONFIRMATION_NOT_PENDING', 'Confirmation request is no longer pending');
  }

  const confirmed = await prisma.pendingAction.updateMany({
    where: { id: action.id, userId, status: 'PENDING' },
    data: { status: 'CONFIRMED', confirmedAt: new Date() }
  });

  if (confirmed.count !== 1) {
    throw new ApiError(409, 'CONFIRMATION_NOT_PENDING', 'Confirmation request is no longer pending');
  }

  const result = await prisma.pendingAction.findUniqueOrThrow({ where: { id: action.id }, select: actionSelect });
  await recordAuditEvent({
    userId,
    eventType: 'confirmation',
    action: 'confirmed',
    resourceType: 'pending_action',
    resourceId: action.id,
    status: 'CONFIRMED',
    metadata: { toolName: action.toolName }
  });
  return {
    ...result,
    confirmationSummary: formatConfirmationSummary(result.toolName, result.arguments as Record<string, unknown>)
  };
}

export async function executeConfirmedAction(userId: string, authSubject: string, actionId: string, authAccessToken?: string, timezone?: string | null) {
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

  await recordAuditEvent({
    userId,
    eventType: 'confirmation',
    action: 'execution_started',
    resourceType: 'pending_action',
    resourceId: action.id,
    status: 'EXECUTING',
    metadata: { toolName: action.toolName }
  });

  try {
    const startedAt = Date.now();
    const result = await executeTool(action.toolName, {
      userId,
      authSubject,
      authAccessToken,
      timezone,
      confirmed: true
    }, action.arguments);

    const completed = await prisma.pendingAction.update({
      where: { id: action.id },
      data: { status: 'COMPLETED' },
      select: actionSelect
    });

    await recordAuditEvent({
      userId,
      eventType: 'confirmation',
      action: 'execution_completed',
      resourceType: 'pending_action',
      resourceId: action.id,
      status: 'COMPLETED',
      metadata: { toolName: action.toolName, durationMs: Date.now() - startedAt }
    });

    return { action: completed, result };
  } catch (error) {
    await prisma.pendingAction.update({
      where: { id: action.id },
      data: { status: 'FAILED' }
    });
    await recordAuditEvent({
      userId,
      eventType: 'confirmation',
      action: 'execution_failed',
      resourceType: 'pending_action',
      resourceId: action.id,
      status: 'FAILED',
      metadata: { toolName: action.toolName, errorType: error instanceof Error ? error.name : 'unknown' }
    });
    throw error;
  }
}

export async function cancelPendingAction(userId: string, actionId: string) {
  const action = await getPendingAction(userId, actionId);

  if (action.status !== 'PENDING') {
    throw new ApiError(409, 'CONFIRMATION_NOT_PENDING', 'Confirmation request is no longer pending');
  }

  const cancelled = await prisma.pendingAction.updateMany({
    where: { id: action.id, userId, status: 'PENDING' },
    data: { status: 'CANCELLED' }
  });

  if (cancelled.count !== 1) {
    throw new ApiError(409, 'CONFIRMATION_NOT_PENDING', 'Confirmation request is no longer pending');
  }

  await recordAuditEvent({
    userId,
    eventType: 'confirmation',
    action: 'cancelled',
    resourceType: 'pending_action',
    resourceId: action.id,
    status: 'CANCELLED',
    metadata: { toolName: action.toolName }
  });

  return { id: action.id, status: 'CANCELLED' as const };
}
