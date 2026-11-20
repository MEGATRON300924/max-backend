import { prisma } from '../lib/prisma.js';
import { Prisma } from '@prisma/client';
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
  return prisma.maxEvent.create({ data: input as Prisma.MaxEventUncheckedCreateInput });
}

export async function listEvents(userId: string, after?: Date, limit = 50) {
  return prisma.maxEvent.findMany({
    where: {
      userId,
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

export async function listEventsForDevice(
  userId: string,
  deviceId: string,
  after?: Date,
  limit = 50,
  afterId?: string
) {
  const device = await assertDeviceForUser(userId, deviceId);
  const visibility: Prisma.MaxEventWhereInput = {
    OR: [
      { userId },
      { deviceId },
      ...(device.homeId ? [{ homeId: device.homeId }] : []),
      ...(device.roomId ? [{ roomId: device.roomId }] : [])
    ]
  };
  const notExpired: Prisma.MaxEventWhereInput = {
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
  };
  const cursor: Prisma.MaxEventWhereInput | undefined = after
    ? {
        OR: [
          { createdAt: { gt: after } },
          ...(afterId ? [{ createdAt: after, id: { gt: afterId } }] : [])
        ]
      }
    : undefined;

  return prisma.maxEvent.findMany({
    where: {
      AND: [visibility, notExpired, ...(cursor ? [cursor] : [])]
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: Math.min(Math.max(limit, 1), 100)
  });
}
