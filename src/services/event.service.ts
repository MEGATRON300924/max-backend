import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/errors.js';

export type MaxEventInput = {
  eventType: 'ANNOUNCEMENT' | 'BROADCAST' | 'SECURITY_ALERT' | 'COMMAND' | 'MEDIA_ACTION' | 'NOTIFICATION' | 'AUTOMATION_EVENT' | 'DEVICE_CHANGED' | 'ACCOUNT_UPDATED' | 'SUBSCRIPTION_UPDATED';
  priority?: 'INFO' | 'NORMAL' | 'IMPORTANT' | 'CRITICAL';
  payload: Record<string, unknown>;
  userId?: string;
  deviceId?: string;
  homeId?: string;
  roomId?: string;
  targetType?: string;
  targetId?: string;
  expiresAt?: Date;
};

export async function createEvent(input: MaxEventInput) {
  return prisma.maxEvent.create({ data: input });
}

export async function listEvents(userId: string, after?: Date, limit = 50) {
  return prisma.maxEvent.findMany({
    where: {
      OR: [{ userId }, { userId: null }],
      ...(after ? { createdAt: { gt: after } } : {})
    },
    orderBy: { createdAt: 'asc' },
    take: Math.min(Math.max(limit, 1), 100)
  });
}

export async function assertDeviceForUser(userId: string, deviceId: string) {
  const device = await prisma.device.findFirst({ where: { id: deviceId, userId, revokedAt: null } });
  if (!device) throw new ApiError(403, 'DEVICE_NOT_AUTHORIZED', 'The target MAX device is not authorized');
  return device;
}

export async function createDeviceCommand(userId: string, targetDeviceId: string, command: string, parameters: Record<string, unknown> = {}) {
  const device = await assertDeviceForUser(userId, targetDeviceId);
  return createEvent({
    userId,
    deviceId: device.id,
    eventType: 'COMMAND',
    priority: 'NORMAL',
    payload: { command, parameters },
    targetType: 'device',
    targetId: device.id
  });
}
