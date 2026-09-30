import { env } from '../config/env.js';
import { ApiError } from '../middleware/errors.js';

async function authUserRequest<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(env.MAX_AUTH_API_URL.replace(/\/$/, '') + path, {
    ...init,
    headers: { Accept: 'application/json', Authorization: token, ...(init.headers ?? {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, body?.error?.code || body?.code || 'MAX_AUTH_CONNECT_ERROR', body?.error?.message || body?.message || 'MAX Auth connector request failed');
  return (body?.data ?? body) as T;
}

const providerPaths: Record<string, string> = {
  spotify: '/connected-accounts/spotify/connect',
  google: '/connected-accounts/google/calendar/connect',
  discord: '/connected-accounts/discord/connect'
};

export async function listConnections(token: string) {
  return authUserRequest<{ accounts: unknown[] }>(token, '/connected-accounts');
}

export async function connectProvider(token: string, provider: string) {
  const path = providerPaths[provider.toLowerCase()];
  if (!path) throw new ApiError(400, 'CONNECTOR_NOT_SUPPORTED', `MAX Connect does not support ${provider}`);
  return authUserRequest(token, path);
}

export async function disconnectProvider(token: string, accountId: string) {
  return authUserRequest(token, '/connected-accounts/' + encodeURIComponent(accountId), { method: 'DELETE' });
}
