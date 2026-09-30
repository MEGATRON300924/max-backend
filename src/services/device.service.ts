import { prisma } from '../lib/prisma.js';
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
  const existing = input.deviceId
    ? await prisma.device.findFirst({ where: { userId: principal.subject, id: input.deviceId } }).catch(() => null)
    : null;

  const user = await prisma.ecosystemUser.findUnique({ where: { authSubject: principal.subject } });
  if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'MAX account is not initialized');

  const device = existing
    ? await prisma.device.update({
        where: { id: existing.id },
        data: {
          deviceType: typeMap[input.deviceType],
          platform: input.platform,
          deviceName: input.deviceName,
          manufacturer: input.manufacturer,
          model: input.model,
          osVersion: input.osVersion,
          appVersion: input.appVersion,
          capabilities: input.capabilities,
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
          deviceType: typeMap[input.deviceType],
          platform: input.platform,
          deviceName: input.deviceName,
          manufacturer: input.manufacturer,
          model: input.model,
          osVersion: input.osVersion,
          appVersion: input.appVersion,
          capabilities: input.capabilities,
          timezone: input.timezone,
          language: input.language,
          homeId: input.homeId,
          roomId: input.roomId,
          lastSeenAt: new Date()
        }
      });

  const session = await prisma.deviceSession.create({
    data: {
      deviceId: device.id,
      userId: user.id,
      sessionKey: crypto.randomUUID(),
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
    const session = await prisma.deviceSession.findFirst({ where: { deviceId, userId: user.id, sessionKey, status: 'ACTIVE' } });
    if (!session) throw new ApiError(401, 'DEVICE_SESSION_INVALID', 'MAX device session is invalid');
    await prisma.deviceSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }
  return prisma.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
}
