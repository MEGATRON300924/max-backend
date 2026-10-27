import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from '../config/logger.js';

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export const notFoundHandler: RequestHandler = (req, res) => {
  const correlationId = res.locals.correlationId;

  logger.warn({
    correlationId,
    method: req.method,
    path: req.path,
    statusCode: 404,
    code: 'NOT_FOUND'
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
    correlationId,
    method: req.method,
    path: req.path
  };

  if (res.headersSent) {
    logger.error({ ...requestContext, err: error }, 'Request failed after response headers were sent');
    return;
  }

  if (error instanceof ZodError) {
    logger.warn({
      ...requestContext,
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      issues: error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path,
        message: issue.message
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
      code: error.code,
      err: error
    }, 'API request failed');

    res.status(error.status).json({
      success: false,
      error: { code: error.code, message: error.message },
      correlationId
    });
    return;
  }

  const candidate = error as { status?: unknown; statusCode?: unknown; type?: unknown };
  const statusCandidate = candidate?.statusCode ?? candidate?.status;
  const status = typeof statusCandidate === 'number' && statusCandidate >= 400 && statusCandidate <= 599
    ? statusCandidate
    : 500;
  const isClientError = status < 500;
  const message = error instanceof Error ? error.message : String(error);

  const log = isClientError ? logger.warn.bind(logger) : logger.error.bind(logger);
  log({
    ...requestContext,
    statusCode: status,
    errorType: error instanceof Error ? error.name : typeof error,
    err: error
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
