import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../types/auth.js';
import { securityService } from '../services/security.service.js';

const router = Router();
router.use(requireAuth);

function token(req: AuthenticatedRequest) {
  const value = req.header('authorization');
  if (!value) throw new Error('Missing authorization header');
  return value;
}

router.get('/audit-logs', async (req: AuthenticatedRequest, res, next) => {
  try { res.json({ data: await securityService.auditLogs(token(req)) }); } catch (error) { next(error); }
});
router.get('/usage', async (req: AuthenticatedRequest, res, next) => {
  try { res.json({ data: await securityService.usage(token(req)) }); } catch (error) { next(error); }
});
router.get('/devices', async (req: AuthenticatedRequest, res, next) => {
  try { res.json({ data: await securityService.devices(token(req)) }); } catch (error) { next(error); }
});
router.get('/sessions', async (req: AuthenticatedRequest, res, next) => {
  try { res.json({ data: await securityService.sessions(token(req)) }); } catch (error) { next(error); }
});

export const securityRouter = router;
