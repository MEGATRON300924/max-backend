import { afterEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();

vi.mock('../src/config/env.js', () => ({
  env: {
    MAX_AUTH_SERVICE_TOKEN: 'test-service-token',
    MAX_AUTH_INTERNAL_URL: 'https://auth.example.test/api/v1/internal',
  },
}));

import {
  flushDiagnosticsTelemetry,
  recordDiagnosticRequest,
} from '../src/services/diagnostics-telemetry.service.js';

describe('MAX diagnostics telemetry delivery', () => {
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('sends only sanitised request metadata to the trusted MAX Auth endpoint', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    recordDiagnosticRequest({
      method: 'GET',
      path: '/users/123?access_token=must-not-be-sent',
      statusCode: 200,
      durationMs: 42,
    });
    await flushDiagnosticsTelemetry();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://auth.example.test/api/v1/internal/diagnostics/events');
    expect(options.headers['x-max-auth-service-token']).toBe('test-service-token');
    const payload = JSON.parse(options.body);
    expect(payload.events).toHaveLength(1);
    expect(payload.events[0]).toMatchObject({
      method: 'GET',
      path: '/users/:id',
      statusCode: 200,
      durationMs: 42,
    });
    expect(JSON.stringify(payload)).not.toContain('must-not-be-sent');
  });

  it('does not send unsupported methods or invalid status codes', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    recordDiagnosticRequest({ method: 'TRACE', path: '/trace', statusCode: 200, durationMs: 1 });
    recordDiagnosticRequest({ method: 'GET', path: '/invalid', statusCode: 700, durationMs: 1 });
    await flushDiagnosticsTelemetry();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
