import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../types/auth.js';
import { registerTv, sendTvCommand, tvConfig } from '../services/tv-device.service.js';

const router = Router();
router.use(requireAuth);

router.get('/config', async (req: AuthenticatedRequest, res, next) => {
  try { res.json({ data: await tvConfig(req.auth!) }); } catch (error) { next(error); }
});

router.post('/register', async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = z.object({
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
    }).parse(req.body);
    res.status(201).json({ data: await registerTv(req.auth!, body) });
  } catch (error) { next(error); }
});

router.post('/:id/commands', async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = z.object({ command: z.string().min(1).max(200), parameters: z.record(z.unknown()).optional() }).parse(req.body);
    res.status(202).json({ data: await sendTvCommand(req.auth!, z.string().uuid().parse(req.params.id), body.command, body.parameters) });
  } catch (error) { next(error); }
});

export const tvDeviceRouter = router;
