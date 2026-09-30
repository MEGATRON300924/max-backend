import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../types/auth.js';
import { maxAuthService } from '../services/max-auth.service.js';
import { getPersonalizationContext } from '../services/personalization.service.js';

const router = Router();
router.use(requireAuth);

function userId(req: AuthenticatedRequest) {
  if (!req.auth?.subject) throw new Error('Missing authenticated MAX user');
  return req.auth.subject;
}

router.get('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const id = userId(req);
    const snapshot = await maxAuthService.personalization(id);
    res.json({
      data: {
        auth: {
          subject: req.auth?.subject,
          tier: req.auth?.tier ?? null,
          claims: req.auth?.claims ?? {}
        },
        personalization: snapshot
      }
    });
  } catch (error) { next(error); }
});

router.get('/context', async (req: AuthenticatedRequest, res, next) => {
  try {
    const id = userId(req);
    const intent = z.string().max(100).default('general').parse(req.query.intent);
    const context = await getPersonalizationContext(id, intent);
    res.json({ data: context });
  } catch (error) { next(error); }
});

router.get('/connected-accounts', async (req: AuthenticatedRequest, res, next) => {
  try { res.json({ data: await maxAuthService.connectedAccounts(userId(req)) }); }
  catch (error) { next(error); }
});

router.get('/devices', async (req: AuthenticatedRequest, res, next) => {
  try { res.json({ data: await maxAuthService.devices(userId(req)) }); }
  catch (error) { next(error); }
});

router.get('/sessions', async (req: AuthenticatedRequest, res, next) => {
  try { res.json({ data: await maxAuthService.sessions(userId(req)) }); }
  catch (error) { next(error); }
});

export const personalizationRouter = router;
