import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../types/auth.js';
import { getDeviceTelemetry, listDevices, registerDevice, revokeDevice, touchDevice, updateDeviceTelemetry } from '../services/device.service.js';
import { resolveEcosystemUser } from '../services/user.service.js';

const router = Router();
router.use(requireAuth);

const telemetrySchema = z.object({
  batteryPercent: z.number().int().min(0).max(100).optional(),
  isCharging: z.boolean().optional(),
  locationSharingEnabled: z.boolean().optional(),
  location: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracyMeters: z.number().min(0).max(100000).optional()
  }).optional()
}).refine((value) => value.locationSharingEnabled !== true || value.location !== undefined || true);

const registration = z.object({
  deviceType: z.enum(['mobile','tablet','tv','desktop','speaker','car','other']),
  platform: z.string().min(1).max(100),
  deviceId: z.string().trim().max(255).optional(),
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


router.put('/:id/telemetry', async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = telemetrySchema.parse(req.body);
    if (body.location && body.locationSharingEnabled !== true) {
      return res.status(400).json({ error: { code: 'LOCATION_CONSENT_REQUIRED', message: 'Enable location sharing explicitly before sending location.' } });
    }
    const data = await updateDeviceTelemetry(req.auth!, z.string().uuid().parse(req.params.id), body);
    res.json({ data });
  } catch (error) { next(error); }
});

router.get('/:id/telemetry', async (req: AuthenticatedRequest, res, next) => {
  try {
    const data = await getDeviceTelemetry(req.auth!, z.string().uuid().parse(req.params.id));
    res.json({ data });
  } catch (error) { next(error); }
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
