import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
  findDevice: vi.fn(),
  findMany: vi.fn()
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    device: {findFirst: mocks.findDevice},
    maxEvent: {findMany: mocks.findMany}
  }
}));

import {listEventsForDevice} from './event.service.js';

describe('listEventsForDevice replay query', () => {
  beforeEach(() => vi.clearAllMocks());

  it('scopes events to the user/device/home and filters expired events', async () => {
    mocks.findDevice.mockResolvedValue({
      id: 'device-1',
      homeId: 'home-1',
      roomId: 'room-1'
    });
    mocks.findMany.mockResolvedValue([]);

    await listEventsForDevice('user-1', 'device-1', new Date('2026-11-20T10:00:00.000Z'), 100, '00000000-0000-4000-8000-000000000001');

    const query = mocks.findMany.mock.calls[0][0];
    expect(query.orderBy).toEqual([{createdAt: 'asc'}, {id: 'asc'}]);
    expect(query.take).toBe(100);
    expect(query.where.AND).toHaveLength(3);
    expect(query.where.AND[0].OR).toEqual([
      {userId: 'user-1', deviceId: null},
      {deviceId: 'device-1'},
      {homeId: 'home-1'},
      {roomId: 'room-1'}
    ]);
    expect(query.where.AND[1].OR).toEqual([
      {expiresAt: null},
      {expiresAt: {gt: expect.any(Date)}}
    ]);
    expect(query.where.AND[2].OR).toEqual([
      {createdAt: {gt: new Date('2026-11-20T10:00:00.000Z')}},
      {createdAt: new Date('2026-11-20T10:00:00.000Z'), id: {gt: '00000000-0000-4000-8000-000000000001'}}
    ]);
  });

  it('caps event batches at 100', async () => {
    mocks.findDevice.mockResolvedValue({id: 'device-1', homeId: null, roomId: null});
    mocks.findMany.mockResolvedValue([]);

    await listEventsForDevice('user-1', 'device-1', undefined, 500);

    expect(mocks.findMany.mock.calls[0][0].take).toBe(100);
  });
});
