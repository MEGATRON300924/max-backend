import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';
import type { AuthenticatedRequest } from '../types/auth.js';
import { resolveEcosystemUser } from '../services/user.service.js';
import { createEvent } from '../services/event.service.js';

const router = Router();
router.use(requireAuth);

const uuid = z.string().uuid();
const homeParam = z.object({ homeId: uuid });
const incidentParam = z.object({ homeId: uuid, incidentId: uuid });

async function getMember(userId: string, homeId: string) {
  const member = await prisma.homeMember.findUnique({
    where: { homeId_userId: { homeId, userId } }
  });
  if (!member) throw new ApiError(403, 'HOME_ACCESS_DENIED', 'You are not a member of this home');
  return member;
}

async function requireManager(userId: string, homeId: string) {
  const member = await getMember(userId, homeId);
  if (!['OWNER', 'ADMIN'].includes(member.role)) {
    throw new ApiError(403, 'HOME_PERMISSION_DENIED', 'Only a home owner or administrator can resolve this incident');
  }
  return member;
}

const sosBody = z.object({
  message: z.string().trim().min(1).max(2000).default('A family member needs help'),
  source: z.enum(['MAX_AI', 'MAX_HOME', 'MAX_TV', 'MAX_VOICE', 'DEVICE', 'OTHER']).default('MAX_HOME'),
  latitude: z.number().gte(-90).lte(90).optional(),
  longitude: z.number().gte(-180).lte(180).optional(),
  accuracy: z.number().nonnegative().optional(),
  battery: z.number().int().min(0).max(100).optional(),
  metadata: z.record(z.unknown()).optional()
}).refine(value => (value.latitude === undefined) === (value.longitude === undefined), {
  message: 'Latitude and longitude must be supplied together',
  path: ['latitude']
});

router.post('/:homeId/sos', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { homeId } = homeParam.parse(req.params);
    const user = await resolveEcosystemUser(req.auth!);
    await getMember(user.id, homeId);
    const input = sosBody.parse(req.body);

    const metadata: Prisma.InputJsonObject = {
      source: input.source,
      ...(input.latitude !== undefined && input.longitude !== undefined
        ? { location: { latitude: input.latitude, longitude: input.longitude, ...(input.accuracy !== undefined ? { accuracy: input.accuracy } : {}) } }
        : {}),
      ...(input.battery !== undefined ? { battery: input.battery } : {}),
      ...(input.metadata ? { details: input.metadata as Prisma.InputJsonObject } : {})
    };

    const incident = await prisma.homeIncident.create({
      data: {
        homeId,
        userId: user.id,
        type: 'SOS',
        status: 'OPEN',
        priority: 'CRITICAL',
        message: input.message,
        metadata
      }
    });

    const members = await prisma.homeMember.findMany({
      where: { homeId },
      select: { userId: true }
    });

    await Promise.all([
      createEvent({
        userId: user.id,
        homeId,
        eventType: 'SECURITY_ALERT',
        priority: 'CRITICAL',
        payload: {
          type: 'SOS',
          incidentId: incident.id,
          message: input.message,
          source: input.source,
          ...(input.latitude !== undefined && input.longitude !== undefined
            ? { location: { latitude: input.latitude, longitude: input.longitude, ...(input.accuracy !== undefined ? { accuracy: input.accuracy } : {}) } }
            : {})
        },
        targetType: 'home',
        targetId: homeId
      }),
      prisma.homeNotification.createMany({
        data: members.map(member => ({
          homeId,
          userId: member.userId,
          message: input.message,
          priority: 'CRITICAL' as const,
          status: 'PENDING' as const,
          channel: 'MAX',
          targetType: 'home',
          targetId: homeId
        }))
      })
    ]);

    res.status(201).json({
      data: {
        incident,
        notificationsQueued: members.length,
        deliveryStatus: 'QUEUED',
        emergencyServicesContacted: false
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:homeId/incidents', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { homeId } = homeParam.parse(req.params);
    const user = await resolveEcosystemUser(req.auth!);
    await getMember(user.id, homeId);
    const query = z.object({
      status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'CANCELLED']).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50)
    }).parse(req.query);
    const incidents = await prisma.homeIncident.findMany({
      where: { homeId, ...(query.status ? { status: query.status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: query.limit
    });
    res.json({ data: incidents });
  } catch (error) {
    next(error);
  }
});

router.post('/:homeId/incidents/:incidentId/acknowledge', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { homeId, incidentId } = incidentParam.parse(req.params);
    const user = await resolveEcosystemUser(req.auth!);
    await getMember(user.id, homeId);

    const updated = await prisma.homeIncident.updateMany({
      where: { id: incidentId, homeId, status: 'OPEN' },
      data: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date() }
    });
    if (updated.count === 0) {
      const exists = await prisma.homeIncident.findFirst({ where: { id: incidentId, homeId } });
      if (!exists) throw new ApiError(404, 'INCIDENT_NOT_FOUND', 'Incident not found in this home');
      if (exists.status !== 'ACKNOWLEDGED') {
        throw new ApiError(409, 'INCIDENT_NOT_OPEN', 'Only open incidents can be acknowledged');
      }
    }

    const incident = await prisma.homeIncident.findFirstOrThrow({ where: { id: incidentId, homeId } });
    await createEvent({
      userId: user.id,
      homeId,
      eventType: 'SECURITY_ALERT',
      priority: incident.priority,
      payload: { type: 'INCIDENT_ACKNOWLEDGED', incidentId, acknowledgedBy: user.id },
      targetType: 'home',
      targetId: homeId
    });
    res.json({ data: incident });
  } catch (error) {
    next(error);
  }
});

router.post('/:homeId/incidents/:incidentId/resolve', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { homeId, incidentId } = incidentParam.parse(req.params);
    const user = await resolveEcosystemUser(req.auth!);
    await requireManager(user.id, homeId);

    const updated = await prisma.homeIncident.updateMany({
      where: { id: incidentId, homeId, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
      data: { status: 'RESOLVED', resolvedAt: new Date() }
    });
    if (updated.count === 0) {
      const exists = await prisma.homeIncident.findFirst({ where: { id: incidentId, homeId } });
      if (!exists) throw new ApiError(404, 'INCIDENT_NOT_FOUND', 'Incident not found in this home');
      if (exists.status !== 'RESOLVED') {
        throw new ApiError(409, 'INCIDENT_NOT_ACTIVE', 'Only active incidents can be resolved');
      }
    }

    const incident = await prisma.homeIncident.findFirstOrThrow({ where: { id: incidentId, homeId } });
    await createEvent({
      userId: user.id,
      homeId,
      eventType: 'SECURITY_ALERT',
      priority: incident.priority,
      payload: { type: 'INCIDENT_RESOLVED', incidentId, resolvedBy: user.id },
      targetType: 'home',
      targetId: homeId
    });
    res.json({ data: incident });
  } catch (error) {
    next(error);
  }
});

export const maxHomeSafetyRouter = router;
