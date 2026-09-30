import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { homeStatus } from '../services/home.service.js';
import { listTools } from '../services/tools.service.js';
import { voiceStatus } from '../services/voice.service.js';
import { env } from '../config/env.js';
import type { AuthenticatedRequest } from '../types/auth.js';

export const ecosystemRouter = Router();

ecosystemRouter.get('/capabilities', (_req, res) => {
  res.json({
    data: {
      ai: { available: true, provider: 'gemini' },
      auth: { available: true, authority: 'max-auth' },
      memory: { available: true, persistent: true },
      home: homeStatus(),
      music: { available: true, status: 'spotify_via_max_auth' },
      cloud: { available: true, status: 'local_storage', quotas: { free: '100MB', plus: '5GB', pro: '50GB', business: '250GB', enterprise: '1TB' } },
      browser: { available: true, status: 'gemini_google_search_and_url_context' },
      voice: voiceStatus(),
      connect: { available: true, status: 'max_auth' },
      store: { available: Boolean(env.MAX_STORE_API_URL), status: env.MAX_STORE_API_URL ? 'ttfl_store' : 'not_configured' },
      studio: { available: true, status: 'gemini_generation' },
      security: { available: true, status: 'max_auth' },
      pay: { available: true, status: 'max_auth_entitlements' },
      tv: { available: true, status: 'assistant_and_search' },
      os: { available: true, status: 'ecosystem_api' }
    }
  });
});

ecosystemRouter.get('/tools', requireAuth, (_req, res) => {
  res.json({ data: listTools() });
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
