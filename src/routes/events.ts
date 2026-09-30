import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../types/auth.js';
import { assertDeviceForUser, createEvent, listEvents } from '../services/event.service.js';
import { resolveEcosystemUser } from '../services/user.service.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await resolveEcosystemUser(req.auth!);
    const after = req.query.after ? new Date(z.string().parse(req.query.after)) : undefined;
    if (after && Number.isNaN(after.getTime())) throw new Error('Invalid after timestamp');
    res.json({ data: await listEvents(user.id, after) });
  } catch (error) { next(error); }
});

router.post('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await resolveEcosystemUser(req.auth!);
    const body = z.object({
      eventType: z.enum(['ANNOUNCEMENT','BROADCAST','SECURITY_ALERT','COMMAND','MEDIA_ACTION','NOTIFICATION','AUTOMATION_EVENT','DEVICE_CHANGED','ACCOUNT_UPDATED','SUBSCRIPTION_UPDATED']),
      priority: z.enum(['INFO','NORMAL','IMPORTANT','CRITICAL']).default('NORMAL'),
      payload: z.record(z.unknown()),
      deviceId: z.string().uuid().optional(),
      homeId: z.string().max(200).optional(),
      roomId: z.string().max(200).optional(),
      targetType: z.string().max(50).optional(),
      targetId: z.string().max(200).optional()
    }).parse(req.body);
    if (body.deviceId) await assertDeviceForUser(user.id, body.deviceId);
    const event = await createEvent({ ...body, userId: user.id });
    res.status(201).json({ data: event });
  } catch (error) { next(error); }
});

router.get('/stream', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await resolveEcosystemUser(req.auth!);
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const deviceId = req.query.deviceId ? z.string().uuid().parse(req.query.deviceId) : undefined;
    let cursor = new Date();
    let closed = false;
    const heartbeat = setInterval(() => {
      if (!closed) res.write(': ping\\n\\n');
    }, 15000);
    const poll = setInterval(async () => {
      if (closed) return;
      try {
        const events = deviceId ? await listEventsForDevice(user.id, deviceId, cursor, 100) : await listEvents(user.id, cursor, 100);
        for (const event of events) {
          cursor = event.createdAt;
          res.write(`event: ${event.eventType.toLowerCase()}\\ndata: ${JSON.stringify(event)}\\n\\n`);
        }
      } catch { /* connection will be retried by the client */ }
    }, 2000);

    req.on('close', () => {
      closed = true;
      clearInterval(heartbeat);
      clearInterval(poll);
    });
  } catch (error) { next(error); }
});

export const eventsRouter = router;
