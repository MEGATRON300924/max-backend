import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { homeStatus } from '../services/home.service.js';
import type { AuthenticatedRequest } from '../types/auth.js';

export const ecosystemRouter = Router();

ecosystemRouter.get('/capabilities', (_req, res) => {
  res.json({
    data: {
      ai: { available: true, provider: 'gemini' },
      auth: { available: true, authority: 'max-auth' },
      memory: { available: true, persistent: true },
      home: homeStatus(),
      music: { available: false, status: 'not_configured' },
      cloud: { available: false, status: 'not_configured' },
      browser: { available: false, status: 'not_configured' },
      voice: { available: false, status: 'not_configured' },
      connect: { available: false, status: 'not_configured' },
      store: { available: false, status: 'not_configured' },
      studio: { available: false, status: 'not_configured' },
      security: { available: false, status: 'not_configured' },
      pay: { available: false, status: 'not_configured' },
      os: { available: false, status: 'not_configured' }
    }
  });
});

ecosystemRouter.get('/me', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({
    data: {
      authSubject: req.auth!.subject,
      email: req.auth!.email ?? null,
      name: req.auth!.name ?? null,
      picture: req.auth!.picture ?? null
    }
  });
});
