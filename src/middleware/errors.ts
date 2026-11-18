import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from '../config/logger.js';

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

function getDurationMs(res: Response): number | undefined {
  const startedAt = res.locals.requestStartedAt;
  if (typeof startedAt !== 'bigint') return undefined;
  return Math.round(Number(process.hrtime.bigint() - startedAt) / 1_000_000);
}

function safeErrorCode(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Z0-9_]{1,64}$/.test(value)
    ? value
    : undefined;
}

export const notFoundHandler: RequestHandler = (req, res) => {
  const correlationId = res.locals.correlationId;

  logger.warn({
    event: 'http.request.not_found',
    correlationId,
    method: req.method,
    path: req.path,
    statusCode: 404,
    code: 'NOT_FOUND',
    durationMs: getDurationMs(res)
  }, 'Route not found');

  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Route not found' },
    correlationId
  });
};

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const correlationId = res.locals.correlationId;
  const requestContext = {
    event: 'http.request.failed',
    correlationId,
    method: req.method,
    path: req.path,
    durationMs: getDurationMs(res)
  };

  if (res.headersSent) {
    logger.error({
      ...requestContext,
      errorType: error instanceof Error ? error.name : typeof error
    }, 'Request failed after response headers were sent');
    return;
  }

  if (error instanceof ZodError) {
    logger.warn({
      ...requestContext,
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      issues: error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path
      }))
    }, 'Request validation failed');

    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: error.flatten() },
      correlationId
    });
    return;
  }

  if (error instanceof ApiError) {
    const log = error.status >= 500 ? logger.error.bind(logger) : logger.warn.bind(logger);
    log({
      ...requestContext,
      statusCode: error.status,
      code: safeErrorCode(error.code),
      errorType: error.name
    }, 'API request failed');

    res.status(error.status).json({
      success: false,
      error: { code: error.code, message: error.message },
      correlationId
    });
    return;
  }

  const candidate = error as { status?: unknown; statusCode?: unknown; code?: unknown };
  const statusCandidate = candidate?.statusCode ?? candidate?.status;
  const status = typeof statusCandidate === 'number' && statusCandidate >= 400 && statusCandidate <= 599
    ? statusCandidate
    : 500;
  const isClientError = status < 500;

  const log = isClientError ? logger.warn.bind(logger) : logger.error.bind(logger);
  log({
    ...requestContext,
    statusCode: status,
    errorType: error instanceof Error ? error.name : typeof error,
    code: safeErrorCode(candidate?.code)
  }, isClientError ? 'Request rejected' : 'Unhandled request error');

  res.status(status).json({
    success: false,
    error: {
      code: status === 400 ? 'BAD_REQUEST' : status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INTERNAL_ERROR',
      message: isClientError && status === 400
        ? 'Invalid request'
        : isClientError && status === 413
          ? 'Request payload too large'
          : 'An unexpected error occurred'
    },
    correlationId
  });
};
