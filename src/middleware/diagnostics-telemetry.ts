import type { RequestHandler } from 'express';
import { recordDiagnosticRequest } from '../services/diagnostics-telemetry.service.js';

export const diagnosticsTelemetryMiddleware: RequestHandler = (req, res, next) => {
  if (req.method === 'OPTIONS') return next();
  const startedAt = res.locals.requestStartedAt;

  res.on('finish', () => {
    const durationMs = typeof startedAt === 'bigint'
      ? Number(process.hrtime.bigint() - startedAt) / 1_000_000
      : 0;
    recordDiagnosticRequest({
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs,
    });
  });

  next();
};
