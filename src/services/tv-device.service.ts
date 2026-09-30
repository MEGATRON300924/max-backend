import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/errors.js';
import type { AuthPrincipal } from '../types/auth.js';
import { createEvent, assertDeviceForUser } from './event.service.js';
import { registerDevice } from './device.service.js';

export async function registerTv(principal: AuthPrincipal, input: Omit<Parameters<typeof registerDevice>[1], 'deviceType'>) {
  return registerDevice(principal, { ...input, deviceType: 'tv' });
}

async function getUser(principal: AuthPrincipal) {
  const user = await prisma.ecosystemUser.findUnique({ where: { authSubject: principal.subject } });
  if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'MAX account is not initialized');
  return user;
}

export async function sendTvCommand(principal: AuthPrincipal, deviceId: string, command: string, parameters: Record<string, unknown> = {}) {
  const user = await getUser(principal);
  await assertDeviceForUser(user.id, deviceId);
  return createEvent({
    userId: user.id,
    deviceId,
    eventType: 'COMMAND',
    priority: 'NORMAL',
    payload: { command, parameters },
    targetType: 'device',
    targetId: deviceId
  });
}

export async function tvConfig(principal: AuthPrincipal) {
  const user = await getUser(principal);
  const devices = await prisma.device.findMany({
    where: { userId: user.id, deviceType: 'TV', revokedAt: null },
    select: { id: true, deviceName: true, platform: true, capabilities: true, appVersion: true }
  });
  return {
    version: 1,
    maintenance: false,
    minimumAppVersion: '1.0.0',
    features: {
      voice: true, screenVision: true, universalSearch: true, maxHome: true,
      announcements: true, broadcast: true, crossDevice: true, ambientMode: true,
      dailyBrief: true, music: true, gaming: true, browser: true
    },
    devices
  };
}
