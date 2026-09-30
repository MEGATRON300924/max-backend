import { env } from '../config/env.js';
import { ApiError } from '../middleware/errors.js';

async function request<T>(token: string, path: string, init: RequestInit = {}) {
  const response = await fetch(env.MAX_AUTH_API_URL.replace(/\/$/, '') + path, {
    ...init,
    headers: { Accept: 'application/json', Authorization: token, ...(init.headers ?? {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, body?.error?.code || body?.code || 'MAX_AUTH_SECURITY_ERROR', body?.error?.message || body?.message || 'MAX Auth security request failed');
  return (body?.data ?? body) as T;
}

export const securityService = {
  auditLogs(token: string) { return request(token, '/security/audit-logs'); },
  usage(token: string) { return request(token, '/security/usage'); },
  devices(token: string) { return request(token, '/devices'); },
  sessions(token: string) { return request(token, '/devices/sessions/all'); }
};
