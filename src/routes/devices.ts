import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../types/auth.js';
import { listDevices, registerDevice, revokeDevice, touchDevice } from '../services/device.service.js';
import { resolveEcosystemUser } from '../services/user.service.js';

const router = Router();
router.use(requireAuth);

const registration = z.object({
  deviceType: z.enum(['mobile','tablet','tv','desktop','speaker','car','other']),
  platform: z.string().min(1).max(100),
  deviceId: z.string().uuid().optional(),
  deviceName: z.string().min(1).max(200),
  manufacturer: z.string().max(200).optional(),
  model: z.string().max(200).optional(),
  osVersion: z.string().max(100).optional(),
  appVersion: z.string().max(100).optional(),
  capabilities: z.record(z.unknown()).optional(),
  timezone: z.string().max(100).optional(),
  language: z.string().max(50).optional(),
  homeId: z.string().max(200).optional(),
  roomId: z.string().max(200).optional()
});

router.post('/register', async (req: AuthenticatedRequest, res, next) => {
  try {
    const data = await registerDevice(req.auth!, registration.parse(req.body));
    res.status(201).json({ data });
  } catch (error) { next(error); }
});

router.get('/', async (req: AuthenticatedRequest, res, next) => {
  try { res.json({ data: await listDevices(req.auth!) }); } catch (error) { next(error); }
});

router.post('/:id/heartbeat', async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = z.object({ sessionKey: z.string().min(1).optional() }).parse(req.body);
    const device = await touchDevice(req.auth!, z.string().uuid().parse(req.params.id), body.sessionKey);
    res.json({ data: device });
  } catch (error) { next(error); }
});

router.post('/:id/revoke', async (req: AuthenticatedRequest, res, next) => {
  try { res.json({ data: await revokeDevice(req.auth!, z.string().uuid().parse(req.params.id)) }); } catch (error) { next(error); }
});

export const devicesRouter = router;
