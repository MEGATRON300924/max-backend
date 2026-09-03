import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { corsOrigins, env } from './config/env.js';
import { logger } from './config/logger.js';
import { correlationMiddleware } from './middleware/correlation.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { healthRouter } from './routes/health.js';
import { profileRouter } from './routes/profile.js';
import { conversationsRouter } from './routes/conversations.js';

export const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));
app.use(correlationMiddleware);
app.use(pinoHttp({ logger }));

app.get('/', (_req, res) => {
  res.json({
    success: true,
    data: {
      name: 'MAX AI Ecosystem Backend',
      version: '1.0.0',
      api: env.API_PREFIX,
      status: 'operational'
    },
    correlationId: res.locals.correlationId
  });
});

app.use('/health', healthRouter);
app.use(`${env.API_PREFIX}/health`, healthRouter);
app.use(`${env.API_PREFIX}/profile`, profileRouter);
app.use(`${env.API_PREFIX}/conversations`, conversationsRouter);

app.use(notFoundHandler);
app.use(errorHandler);
