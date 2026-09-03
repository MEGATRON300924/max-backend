import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({
    success: true,
    data: {
      status: 'healthy',
      service: 'max-backend',
      checks: {
        api: 'healthy',
        database: 'not_configured',
        queue: 'not_configured',
        cache: 'not_configured',
        integrations: 'not_configured'
      },
      timestamp: new Date().toISOString()
    },
    correlationId: res.locals.correlationId
  });
});
