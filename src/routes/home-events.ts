import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../types/auth.js';
import { createEvent } from '../services/event.service.js';
import { resolveEcosystemUser } from '../services/user.service.js';

const router = Router();
router.use(requireAuth);

const messageBody = z.object({
  homeId: z.string().min(1).max(200),
  roomId: z.string().max(200).optional(),
  message: z.string().min(1).max(5000),
  priority: z.enum(['INFO','NORMAL','IMPORTANT','CRITICAL']).default('NORMAL'),
  targets: z.array(z.string().max(200)).optional()
});

router.post('/announcements', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await resolveEcosystemUser(req.auth!);
    const body = messageBody.parse(req.body);
    const event = await createEvent({
      userId: user.id, homeId: body.homeId, roomId: body.roomId,
      eventType: 'ANNOUNCEMENT', priority: body.priority,
      payload: { type: 'announcement', message: body.message, targets: body.targets ?? ['home'] },
      targetType: 'home', targetId: body.homeId
    });
    res.status(201).json({ data: event });
  } catch (error) { next(error); }
});

router.post('/broadcasts', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await resolveEcosystemUser(req.auth!);
    const body = messageBody.parse(req.body);
    const event = await createEvent({
      userId: user.id, homeId: body.homeId, roomId: body.roomId,
      eventType: 'BROADCAST', priority: body.priority,
      payload: { type: 'broadcast', message: body.message, targets: body.targets ?? ['home'] },
      targetType: 'home', targetId: body.homeId
    });
    res.status(201).json({ data: event });
  } catch (error) { next(error); }
});

router.post('/security', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await resolveEcosystemUser(req.auth!);
    const body = messageBody.parse(req.body);
    if (!['IMPORTANT','CRITICAL'].includes(body.priority)) return res.status(400).json({ error: { code: 'INVALID_SECURITY_PRIORITY', message: 'Security events must be IMPORTANT or CRITICAL' } });
    const event = await createEvent({
      userId: user.id, homeId: body.homeId, roomId: body.roomId,
      eventType: 'SECURITY_ALERT', priority: body.priority,
      payload: { type: 'security_alert', message: body.message, targets: body.targets ?? ['home'] },
      targetType: 'home', targetId: body.homeId
    });
    res.status(201).json({ data: event });
  } catch (error) { next(error); }
});

export const homeEventsRouter = router;
