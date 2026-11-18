import { Router, type Request, type Response } from 'express';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';

const HEALTH_CHECK_TIMEOUT_MS = 2_500;

export const healthHandlers = {
  liveness(_req: Request, res: Response) {
    return res.status(200).json({
      success: true,
      data: {
        status: 'alive',
        service: 'max-backend',
        timestamp: new Date().toISOString()
      },
      correlationId: res.locals.correlationId
    });
  },

  async readiness(_req: Request, res: Response) {
    let databaseStatus: 'healthy' | 'unavailable' | 'not_configured' = 'not_configured';
    let timeout: ReturnType<typeof setTimeout> | undefined;

    if (env.DATABASE_URL) {
      try {
        await Promise.race([
          prisma.$queryRaw`SELECT 1`,
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => reject(new Error('Health check timed out')), HEALTH_CHECK_TIMEOUT_MS);
          })
        ]);
        databaseStatus = 'healthy';
      } catch {
        // Keep public health responses deliberately free of connection details.
        databaseStatus = 'unavailable';
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }

    const ready = databaseStatus === 'healthy';
    return res.status(ready ? 200 : 503).json({
      success: ready,
      data: {
        status: ready ? 'healthy' : 'not_ready',
        service: 'max-backend',
        checks: {
          api: 'healthy',
          database: databaseStatus,
          queue: 'not_configured',
          cache: 'not_configured',
          integrations: 'not_checked'
        },
        timestamp: new Date().toISOString()
      },
      correlationId: res.locals.correlationId
    });
  }
};

export const healthRouter = Router();

// Keep the legacy root probe, but make it reflect actual readiness instead of
// reporting healthy while the database is unavailable.
healthRouter.get('/', healthHandlers.readiness);
healthRouter.get('/live', healthHandlers.liveness);
healthRouter.get('/ready', healthHandlers.readiness);
