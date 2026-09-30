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
import { memoriesRouter } from './routes/memories.js';
import { homeRouter } from './routes/home.js';
import { ecosystemRouter } from './routes/ecosystem.js';
import { confirmationsRouter } from './routes/confirmations.js';
import { voiceRouter } from './routes/voice.js';
import { cloudRouter } from './routes/cloud.js';
import { browserRouter } from './routes/browser.js';
import { connectRouter } from './routes/connect.js';
import { securityRouter } from './routes/security.js';
import { payRouter } from './routes/pay.js';
import { storeRouter } from './routes/store.js';
import { studioRouter } from './routes/studio.js';
import { osRouter } from './routes/os.js';

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
app.use(`${env.API_PREFIX}/memories`, memoriesRouter);
app.use(`${env.API_PREFIX}/home`, homeRouter);
app.use(`${env.API_PREFIX}/ecosystem`, ecosystemRouter);
app.use(`${env.API_PREFIX}/confirmations`, confirmationsRouter);
app.use(`${env.API_PREFIX}/voice`, voiceRouter);
app.use(`${env.API_PREFIX}/cloud`, cloudRouter);
app.use(`${env.API_PREFIX}/browser`, browserRouter);
app.use(`${env.API_PREFIX}/connect`, connectRouter);
app.use(`${env.API_PREFIX}/security`, securityRouter);
app.use(`${env.API_PREFIX}/pay`, payRouter);
app.use(`${env.API_PREFIX}/store`, storeRouter);
app.use(`${env.API_PREFIX}/studio`, studioRouter);
app.use(`${env.API_PREFIX}/os`, osRouter);

app.use(notFoundHandler);
app.use(errorHandler);
