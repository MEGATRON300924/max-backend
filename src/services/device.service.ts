import { randomBytes } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { Prisma } from '@prisma/client';
import { ApiError } from '../middleware/errors.js';
import type { AuthPrincipal } from '../types/auth.js';

export type DeviceRegistration = {
  deviceType: 'mobile' | 'tablet' | 'tv' | 'desktop' | 'speaker' | 'car' | 'other';
  platform: string;
  deviceId?: string;
  deviceName: string;
  manufacturer?: string;
  model?: string;
  osVersion?: string;
  appVersion?: string;
  capabilities?: Record<string, unknown>;
  timezone?: string;
  language?: string;
  homeId?: string;
  roomId?: string;
};

const typeMap = {
  mobile: 'MOBILE', tablet: 'TABLET', tv: 'TV', desktop: 'DESKTOP',
  speaker: 'SPEAKER', car: 'CAR', other: 'OTHER'
} as const;

export async function registerDevice(principal: AuthPrincipal, input: DeviceRegistration) {
  const user = await prisma.ecosystemUser.findUnique({ where: { authSubject: principal.subject } });
  const existing = input.deviceId && user
    ? await prisma.device.findFirst({ where: { userId: user.id, externalId: input.deviceId } })
    : null;
  if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'MAX account is not initialized');

  const device = existing
    ? await prisma.device.update({
        where: { id: existing.id },
        data: {
          externalId: input.deviceId,
          deviceType: typeMap[input.deviceType],
          platform: input.platform,
          deviceName: input.deviceName,
          manufacturer: input.manufacturer,
          model: input.model,
          osVersion: input.osVersion,
          appVersion: input.appVersion,
          capabilities: input.capabilities as Prisma.InputJsonValue | undefined,
          timezone: input.timezone,
          language: input.language,
          homeId: input.homeId,
          roomId: input.roomId,
          revokedAt: null,
          lastSeenAt: new Date()
        }
      })
    : await prisma.device.create({
        data: {
          userId: user.id,
          externalId: input.deviceId,
          deviceType: typeMap[input.deviceType],
          platform: input.platform,
          deviceName: input.deviceName,
          manufacturer: input.manufacturer,
          model: input.model,
          osVersion: input.osVersion,
          appVersion: input.appVersion,
          capabilities: input.capabilities as Prisma.InputJsonValue | undefined,
          timezone: input.timezone,
          language: input.language,
          homeId: input.homeId,
          roomId: input.roomId,
          lastSeenAt: new Date()
        }
      });

  await prisma.deviceSession.updateMany({
    where: { deviceId: device.id, status: 'ACTIVE' },
    data: { status: 'REVOKED', expiresAt: new Date() }
  });

  const session = await prisma.deviceSession.create({
    data: {
      deviceId: device.id,
      userId: user.id,
      sessionKey: randomBytes(32).toString('base64url'),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    }
  });

  return { device, session: { id: session.id, sessionKey: session.sessionKey, expiresAt: session.expiresAt } };
}

export async function listDevices(principal: AuthPrincipal) {
  const user = await prisma.ecosystemUser.findUnique({ where: { authSubject: principal.subject } });
  if (!user) return [];
  return prisma.device.findMany({
    where: { userId: user.id },
    orderBy: { lastSeenAt: 'desc' },
    select: {
      id: true, deviceType: true, platform: true, deviceName: true,
      manufacturer: true, model: true, osVersion: true, appVersion: true,
      capabilities: true, timezone: true, language: true, homeId: true, roomId: true,
      revokedAt: true, lastSeenAt: true, createdAt: true
    }
  });
}

export async function revokeDevice(principal: AuthPrincipal, deviceId: string) {
  const user = await prisma.ecosystemUser.findUnique({ where: { authSubject: principal.subject } });
  if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'MAX account is not initialized');
  const device = await prisma.device.findFirst({ where: { id: deviceId, userId: user.id } });
  if (!device) throw new ApiError(404, 'DEVICE_NOT_FOUND', 'MAX device was not found');
  await prisma.$transaction([
    prisma.device.update({ where: { id: device.id }, data: { revokedAt: new Date() } }),
    prisma.deviceSession.updateMany({ where: { deviceId: device.id, status: 'ACTIVE' }, data: { status: 'REVOKED' } })
  ]);
  return { revoked: true, deviceId };
}

export async function touchDevice(principal: AuthPrincipal, deviceId: string, sessionKey?: string) {
  const user = await prisma.ecosystemUser.findUnique({ where: { authSubject: principal.subject } });
  if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'MAX account is not initialized');
  const device = await prisma.device.findFirst({ where: { id: deviceId, userId: user.id, revokedAt: null } });
  if (!device) throw new ApiError(404, 'DEVICE_NOT_FOUND', 'MAX device was not found or revoked');
  if (sessionKey) {
    const now = new Date();
    const session = await prisma.deviceSession.findFirst({
      where: { deviceId, userId: user.id, sessionKey, status: 'ACTIVE', expiresAt: { gt: now } }
    });
    if (!session) throw new ApiError(401, 'DEVICE_SESSION_INVALID', 'MAX device session is invalid or expired');
    await prisma.deviceSession.update({
      where: { id: session.id },
      data: {
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
      }
    });
  }
  return prisma.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
}


/**
 * Resolve a device-scoped event-stream credential. This credential is separate
 * from MAX Auth access/refresh tokens and can be revoked with the device.
 */
export async function resolveDeviceEventStreamSession(deviceId: string, sessionKey: string) {
  const now = new Date();
  const session = await prisma.deviceSession.findFirst({
    where: {
      deviceId,
      sessionKey,
      status: 'ACTIVE',
      expiresAt: { gt: now }
    },
    select: { id: true, userId: true, deviceId: true }
  });

  if (!session) {
    throw new ApiError(401, 'DEVICE_SESSION_INVALID', 'MAX device session is invalid or expired');
  }

  const device = await prisma.device.findFirst({
    where: { id: deviceId, userId: session.userId, revokedAt: null },
    select: { id: true, homeId: true, roomId: true }
  });

  if (!device) {
    throw new ApiError(401, 'DEVICE_REVOKED', 'This MAX device has been revoked');
  }

  await prisma.deviceSession.update({
    where: { id: session.id },
    data: {
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    }
  });

  return {
    userId: session.userId,
    deviceId: session.deviceId,
    homeId: device.homeId,
    roomId: device.roomId
  };
}
