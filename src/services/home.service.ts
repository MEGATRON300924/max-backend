import { env } from '../config/env.js';
import { ApiError } from '../middleware/errors.js';

type HomeRequest = {
  path: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
};

export async function maxHomeRequest<T>({ path, method = 'GET', body }: HomeRequest): Promise<T> {
  if (!env.MAX_HOME_API_URL) {
    throw new ApiError(503, 'HOME_NOT_CONFIGURED', 'MAX Home is not configured');
  }

  const response = await fetch(`${env.MAX_HOME_API_URL.replace(/\/$/, '')}${path}`, {
    method,
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  if (!response.ok) {
    throw new ApiError(502, 'HOME_PROVIDER_ERROR', 'MAX Home could not complete the request');
  }

  return (await response.json()) as T;
}

export function homeStatus() {
  return {
    configured: Boolean(env.MAX_HOME_API_URL),
    status: env.MAX_HOME_API_URL ? 'connected' : 'not_configured'
  } as const;
}
