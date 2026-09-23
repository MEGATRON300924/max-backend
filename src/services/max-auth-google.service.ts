import { env } from '../config/env.js';
import { ApiError } from '../middleware/errors.js';

type RequestOptions = {
  method?: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
};

function queryString(query?: RequestOptions['query']) {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const value = params.toString();
  return value ? '?' + value : '';
}

export async function maxAuthGoogleRequest<T = unknown>(userId: string, path: string, options: RequestOptions = {}): Promise<T> {
  if (!env.MAX_AUTH_SERVICE_TOKEN) {
    throw new ApiError(503, 'MAX_AUTH_SERVICE_NOT_CONFIGURED', 'MAX Auth service integration is not configured');
  }

  const url = env.MAX_AUTH_INTERNAL_URL.replace(/\/$/, '') + '/users/' + encodeURIComponent(userId) + '/google' + path + queryString(options.query);
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-MAX-Auth-Service-Token': env.MAX_AUTH_SERVICE_TOKEN,
      'X-MAX-User-Id': userId
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(
      response.status,
      body?.error?.code || body?.code || 'MAX_AUTH_GOOGLE_ERROR',
      body?.error?.message || body?.message || 'MAX Auth Google request failed'
    );
  }
  return (body?.data ?? body) as T;
}
