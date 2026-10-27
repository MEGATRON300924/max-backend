import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './lib/prisma.js';

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, environment: env.NODE_ENV }, 'MAX backend started');
});

// Log fatal process-level failures so they are visible in Render Live Tail.
// uncaughtExceptionMonitor preserves Node's default crash behavior.
process.on('uncaughtExceptionMonitor', (error, origin) => {
  logger.fatal({ err: error, origin }, 'Uncaught exception; process will terminate');
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection; terminating process');
  // A process with an unhandled rejection is not considered safe to keep serving.
  setImmediate(() => process.exit(1));
});

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutdown requested');
  server.close(async () => {
    await prisma.$disconnect();
    logger.info('MAX backend stopped');
    process.exit(0);
  });
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
