import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../types/auth.js';
import { resolveEcosystemUser } from '../services/user.service.js';

export const profileRouter = Router();

profileRouter.get('/', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await resolveEcosystemUser(req.auth!);
    res.json({
      data: {
        id: user.id,
        authSubject: user.authSubject,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        locale: user.locale,
        timezone: user.timezone,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });
  } catch (error) {
    next(error);
  }
});
