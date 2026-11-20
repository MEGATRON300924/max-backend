import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
  findSession: vi.fn(),
  findDevice: vi.fn(),
  updateSession: vi.fn()
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    deviceSession: {
      findFirst: mocks.findSession,
      update: mocks.updateSession
    },
    device: {
      findFirst: mocks.findDevice
    }
  }
}));

import {resolveDeviceEventStreamSession} from './device.service.js';

describe('resolveDeviceEventStreamSession', () => {
  beforeEach(() => vi.clearAllMocks());

  it('accepts a valid active device session and slides its expiry', async () => {
    mocks.findSession.mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
      deviceId: 'device-1'
    });
    mocks.findDevice.mockResolvedValue({
      id: 'device-1',
      homeId: 'home-1',
      roomId: 'room-1'
    });
    mocks.updateSession.mockResolvedValue({});

    const result = await resolveDeviceEventStreamSession('device-1', 'x'.repeat(43));

    expect(result).toEqual({
      userId: 'user-1',
      deviceId: 'device-1',
      homeId: 'home-1',
      roomId: 'room-1'
    });
    expect(mocks.updateSession).toHaveBeenCalledWith(expect.objectContaining({
      where: {id: 'session-1'},
      data: expect.objectContaining({lastSeenAt: expect.any(Date), expiresAt: expect.any(Date)})
    }));
  });

  it('rejects missing, revoked or expired device sessions', async () => {
    mocks.findSession.mockResolvedValue(null);
    await expect(
      resolveDeviceEventStreamSession('device-1', 'x'.repeat(43))
    ).rejects.toMatchObject({statusCode: 401, code: 'DEVICE_SESSION_INVALID'});
    expect(mocks.findDevice).not.toHaveBeenCalled();
  });

  it('rejects a session when its device has been revoked', async () => {
    mocks.findSession.mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
      deviceId: 'device-1'
    });
    mocks.findDevice.mockResolvedValue(null);

    await expect(
      resolveDeviceEventStreamSession('device-1', 'x'.repeat(43))
    ).rejects.toMatchObject({statusCode: 401, code: 'DEVICE_REVOKED'});
    expect(mocks.updateSession).not.toHaveBeenCalled();
  });
});
