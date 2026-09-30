import { env } from '../config/env.js';
import { ApiError } from '../middleware/errors.js';

export type MaxAuthRequestOptions = {
  method?: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
};

function buildQuery(query?: MaxAuthRequestOptions['query']) {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const value = params.toString();
  return value ? '?' + value : '';
}

async function request<T>(
  userId: string,
  path: string,
  options: MaxAuthRequestOptions = {}
): Promise<T> {
  if (!env.MAX_AUTH_SERVICE_TOKEN) {
    throw new ApiError(503, 'MAX_AUTH_SERVICE_NOT_CONFIGURED', 'MAX Auth service integration is not configured');
  }

  const url = env.MAX_AUTH_INTERNAL_URL.replace(/\/$/, '') +
    '/users/' + encodeURIComponent(userId) + path + buildQuery(options.query);

  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/json',
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
      body?.error?.code || body?.code || 'MAX_AUTH_ERROR',
      body?.error?.message || body?.message || 'MAX Auth request failed'
    );
  }

  return (body?.data ?? body) as T;
}

export const maxAuthService = {
  request,

  personalization<T = unknown>(userId: string) {
    return request<T>(userId, '/personalization');
  },

  profile<T = unknown>(userId: string) {
    return request<T>(userId, '/profile');
  },

  connectedAccounts<T = unknown>(userId: string) {
    return request<T>(userId, '/connected-accounts');
  },

  devices<T = unknown>(userId: string) {
    return request<T>(userId, '/devices');
  },

  sessions<T = unknown>(userId: string) {
    return request<T>(userId, '/devices/sessions/all');
  },

  securityAudit<T = unknown>(userId: string) {
    return request<T>(userId, '/security/audit-logs');
  },

  securityUsage<T = unknown>(userId: string) {
    return request<T>(userId, '/security/usage');
  },

  provider<T = unknown>(userId: string, provider: 'google' | 'spotify' | 'discord', path: string, options?: MaxAuthRequestOptions) {
    return request<T>(userId, '/' + provider + path, options);
  },

  personalizationService<T = unknown>(userId: string, provider: string) {
    return request<T>(userId, '/personalization/services/' + encodeURIComponent(provider));
  }
};
