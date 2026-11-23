import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './lib/prisma.js';
import { flushDiagnosticsTelemetry } from './services/diagnostics-telemetry.service.js';
import { registerDiscordCommands } from './routes/discord.js';
import { startDiscordGateway, stopDiscordGateway } from './services/discord.gateway.js';

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, environment: env.NODE_ENV }, 'MAX backend started');
  startDiscordGateway();
  void registerDiscordCommands().catch((error) => {
    logger.error({ errorType: error instanceof Error ? error.name : typeof error, errorMessage: error instanceof Error ? error.message.slice(0, 700) : 'Unknown error' }, 'Discord command registration failed');
  });
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
    await stopDiscordGateway();
    await flushDiagnosticsTelemetry();
    await prisma.$disconnect();
    logger.info('MAX backend stopped');
    process.exit(0);
  });
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
