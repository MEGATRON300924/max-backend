import { env } from '../config/env.js';
import { ApiError } from '../middleware/errors.js';

async function request(path: string, query: Record<string, string | number | undefined>) {
  if (!env.MAX_STORE_API_URL) throw new ApiError(503, 'MAX_STORE_NOT_CONFIGURED', 'MAX Store integration is not configured');
  const url = new URL(env.MAX_STORE_API_URL.replace(/\/$/, '') + path);
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  const response = await fetch(url);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, 'MAX_STORE_ERROR', body?.message || body?.error || 'MAX Store request failed');
  return body;
}

export const storeService = {
  search(query: Record<string, string | number | undefined>) { return request('/api/v1/products', query); },
  product(slug: string) { return request('/api/v1/products/' + encodeURIComponent(slug), {}); }
};
