import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const mocks = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn()
}));

vi.mock('../src/config/logger.js', () => ({
  logger: {
    error: mocks.error,
    warn: mocks.warn
  }
}));

import { ApiError, errorHandler, notFoundHandler } from '../src/middleware/errors.js';
import { sanitizeDiagnosticPath } from '../src/middleware/diagnostics.js';

function createRequest(path = '/api/v1/example?access_token=private-query-secret') {
  return {
    method: 'POST',
    path,
    headersSent: false
  } as unknown as Request;
}

function createResponse(headersSent = false) {
  const response = {
    headersSent,
    statusCode: 200,
    body: undefined as unknown,
    locals: {
      correlationId: 'diagnostic-correlation-id',
      requestStartedAt: process.hrtime.bigint() - 12_000_000n
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    }
  };
  return response as unknown as Response & { statusCode: number; body: any };
}

describe('MAX diagnostic path sanitisation', () => {
  it('removes query strings and masks identifiers, emails and opaque tokens', () => {
    expect(sanitizeDiagnosticPath('/users/123/profile')).toBe('/users/:id/profile');
    expect(sanitizeDiagnosticPath('/users/ab12cd34-1234-1234-1234-123456789abc')).toBe('/users/:id');
    expect(sanitizeDiagnosticPath('/lookup/person%40example.com')).toBe('/lookup/:id');
    expect(sanitizeDiagnosticPath('/access/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH')).toBe('/access/:id');
    expect(sanitizeDiagnosticPath('/search?q=private')).toBe('/search');
  });
});

describe('MAX diagnostic error logging', () => {
  beforeEach(() => {
    mocks.error.mockReset();
    mocks.warn.mockReset();
  });

  it('logs a correlated, timed API error without the raw exception message', () => {
    const req = createRequest();
    const res = createResponse();

    errorHandler(new ApiError(502, 'UPSTREAM_FAILURE', 'provider response included private-query-secret'), req, res, vi.fn());

    expect(res.statusCode).toBe(502);
    expect(mocks.error).toHaveBeenCalledOnce();
    const logged = JSON.stringify(mocks.error.mock.calls[0]);
    expect(logged).toContain('diagnostic-correlation-id');
    expect(logged).toContain('UPSTREAM_FAILURE');
    expect(logged).toContain('durationMs');
    expect(logged).not.toContain('private-query-secret');
  });

  it('does not serialize raw unhandled exception messages or stacks', () => {
    const req = createRequest();
    const res = createResponse();

    errorHandler(new Error('secret-provider-payload-and-token'), req, res, vi.fn());

    expect(res.statusCode).toBe(500);
    const logged = JSON.stringify(mocks.error.mock.calls[0]);
    expect(logged).toContain('Error');
    expect(logged).not.toContain('secret-provider-payload-and-token');
  });

  it('does not serialize raw errors after response headers have been sent', () => {
    const req = createRequest();
    const res = createResponse(true);

    errorHandler(new Error('stream-secret-provider-payload'), req, res, vi.fn());

    const logged = JSON.stringify(mocks.error.mock.calls[0]);
    expect(logged).toContain('diagnostic-correlation-id');
    expect(logged).not.toContain('stream-secret-provider-payload');
  });

  it('logs not-found events with correlation and duration metadata', () => {
    const req = createRequest('/missing');
    const res = createResponse();

    notFoundHandler(req, res, vi.fn());

    expect(res.statusCode).toBe(404);
    const logged = JSON.stringify(mocks.warn.mock.calls[0]);
    expect(logged).toContain('http.request.not_found');
    expect(logged).toContain('diagnostic-correlation-id');
    expect(logged).toContain('durationMs');
  });
});
