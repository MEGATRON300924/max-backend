import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';
import type { AuthenticatedRequest } from '../types/auth.js';
import {
  assertDeviceForUser,
  createEvent,
  listEvents,
  listEventsForDevice
} from '../services/event.service.js';
import { resolveDeviceEventStreamSession } from '../services/device.service.js';
import { resolveEcosystemUser } from '../services/user.service.js';

const router = Router();

/**
 * Device-scoped notification stream.
 *
 * The device session key is issued only after an authenticated MAX Auth
 * device-registration request. It is not an account access/refresh token.
 * Revoking the device revokes this stream credential as well.
 */
router.get('/device-stream', async (req, res, next) => {
  try {
    const deviceId = z.string().uuid().parse(req.header('x-max-device-id'));
    const sessionKey = z.string().min(32).max(255).parse(req.header('x-max-device-session'));
    const session = await resolveDeviceEventStreamSession(deviceId, sessionKey);

    const afterValue = typeof req.query.after === 'string' ? req.query.after : undefined;
    const after = afterValue ? new Date(afterValue) : new Date();
    if (Number.isNaN(after.getTime())) {
      throw new ApiError(400, 'INVALID_EVENT_CURSOR', 'The event cursor is invalid');
    }
    const afterId = typeof req.query.after_id === 'string'
      ? z.string().uuid().parse(req.query.after_id)
      : undefined;

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let cursor = after;
    let cursorId = afterId;
    let closed = false;
    let polling = false;

    const sendEvents = async () => {
      if (closed || polling) return;
      polling = true;
      try {
        const events = await listEventsForDevice(
          session.userId,
          session.deviceId,
          cursor,
          100,
          cursorId
        );
        for (const event of events) {
          if (closed) break;
          cursor = event.createdAt;
          cursorId = event.id;
          res.write(
            `id: ${event.id}\nevent: ${event.eventType.toLowerCase()}\ndata: ${JSON.stringify(event)}\n\n`
          );
        }
      } catch {
        // Keep the connection open; the client reconnects if the stream closes.
      } finally {
        polling = false;
      }
    };

    const heartbeat = setInterval(() => {
      if (!closed) res.write(': ping\n\n');
    }, 15_000);
    const poll = setInterval(() => { void sendEvents(); }, 2_000);
    void sendEvents();

    res.on('close', () => {
      closed = true;
      clearInterval(heartbeat);
      clearInterval(poll);
    });
  } catch (error) {
    next(error);
  }
});

// All account-scoped event endpoints below continue to require MAX Auth.
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
      if (!closed) res.write(': ping\n\n');
    }, 15000);
    const poll = setInterval(async () => {
      if (closed) return;
      try {
        const events = deviceId ? await listEventsForDevice(user.id, deviceId, cursor, 100) : await listEvents(user.id, cursor, 100);
        for (const event of events) {
          cursor = event.createdAt;
          res.write(`event: ${event.eventType.toLowerCase()}\ndata: ${JSON.stringify(event)}\n\n`);
        }
      } catch { /* connection will be retried by the client */ }
    }, 2000);

    res.on('close', () => {
      closed = true;
      clearInterval(heartbeat);
      clearInterval(poll);
    });
  } catch (error) { next(error); }
});

export const eventsRouter = router;
