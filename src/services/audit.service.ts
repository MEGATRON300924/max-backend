import { prisma } from '../lib/prisma.js';
import { logger } from '../config/logger.js';

export type AuditEventInput = {
  userId?: string;
  correlationId?: string;
  eventType: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  status: string;
  metadata?: Record<string, unknown>;
};

const SECRET_KEYS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'accessToken',
  'refreshToken',
  'password',
  'token',
  'secret',
  'apiKey',
  'api_key',
  'clientSecret',
  'client_secret'
]);

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[TRUNCATED]';
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
      output[key] = SECRET_KEYS.has(key) || SECRET_KEYS.has(key.toLowerCase()) ? '[REDACTED]' : sanitizeValue(item, depth + 1);
    }
    return output;
  }
  return '[UNSUPPORTED]';
}

export async function recordAuditEvent(input: AuditEventInput): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        userId: input.userId,
        correlationId: input.correlationId,
        eventType: input.eventType,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        status: input.status,
        metadata: input.metadata ? sanitizeValue(input.metadata) as object : undefined
      }
    });
  } catch (error) {
    logger.error({ err: error, eventType: input.eventType, action: input.action }, 'audit event persistence failed');
  }
}

export function sanitizeAuditMetadata(metadata: Record<string, unknown>) {
  return sanitizeValue(metadata) as Record<string, unknown>;
}
