import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  env: { DATABASE_URL: 'postgresql://health-check-test' as string | undefined }
}));

vi.mock('../src/lib/prisma.js', () => ({
  prisma: { $queryRaw: mocks.queryRaw }
}));

vi.mock('../src/config/env.js', () => ({
  env: mocks.env
}));

import { healthHandlers } from '../src/routes/health.js';

function createResponse() {
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
    locals: { correlationId: 'health-test-correlation' }
  };
  return response as unknown as Response & { statusCode: number; body: any };
}

describe('MAX Backend health probes', () => {
  beforeEach(() => {
    mocks.queryRaw.mockReset();
    mocks.env.DATABASE_URL = 'postgresql://health-check-test';
  });

  it('reports liveness without querying dependencies', () => {
    const response = createResponse();

    healthHandlers.liveness({} as Request, response);

    expect(response.statusCode).toBe(200);
    expect(response.body.data.status).toBe('alive');
    expect(response.body.correlationId).toBe('health-test-correlation');
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it('reports readiness when the database responds', async () => {
    mocks.queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    const response = createResponse();

    await healthHandlers.readiness({} as Request, response);

    expect(response.statusCode).toBe(200);
    expect(response.body.data.status).toBe('healthy');
    expect(response.body.data.checks.database).toBe('healthy');
  });

  it('returns 503 with a sanitised response when the database fails', async () => {
    mocks.queryRaw.mockRejectedValue(new Error('secret database host and credentials'));
    const response = createResponse();

    await healthHandlers.readiness({} as Request, response);

    expect(response.statusCode).toBe(503);
    expect(response.body.success).toBe(false);
    expect(response.body.data.checks.database).toBe('unavailable');
    expect(JSON.stringify(response.body)).not.toContain('secret database host');
  });

  it('returns 503 when no database URL is configured', async () => {
    mocks.env.DATABASE_URL = undefined;
    const response = createResponse();

    await healthHandlers.readiness({} as Request, response);

    expect(response.statusCode).toBe(503);
    expect(response.body.data.checks.database).toBe('not_configured');
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });
});
