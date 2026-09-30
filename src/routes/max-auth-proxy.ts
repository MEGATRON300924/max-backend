import { Router, type Request } from 'express';
import { env } from '../config/env.js';
import { ApiError } from '../middleware/errors.js';

const router = Router();

const passthroughGroups = new Set([
  'profile',
  'devices',
  'security',
  'mfa',
  'connected-accounts',
  'oauth',
  'webhooks',
  'admin',
  'health'
]);

function remotePath(req: Request) {
  const path = req.path.replace(/^\\/+/, '');
  const [group] = path.split('/');

  if (group === 'internal') {
    return '/api/v1/internal' + path.slice('internal'.length);
  }

  if (passthroughGroups.has(group)) {
    return '/api/v1/' + path;
  }

  return '/api/v1/auth/' + path;
}

function forwardedHeaders(req: Request, internal: boolean) {
  const headers: Record<string, string> = {
    Accept: req.header('accept') ?? 'application/json',
    'Content-Type': req.header('content-type') ?? 'application/json',
    'User-Agent': req.header('user-agent') ?? 'MAX Backend',
    'X-Forwarded-For': req.ip,
    'X-Forwarded-Proto': req.protocol
  };

  for (const name of ['authorization', 'cookie', 'x-csrf-token', 'x-client-id', 'x-request-id']) {
    const value = req.header(name);
    if (value) headers[name] = value;
  }

  if (internal) {
    if (!env.MAX_AUTH_SERVICE_TOKEN) {
      throw new ApiError(503, 'MAX_AUTH_SERVICE_NOT_CONFIGURED', 'MAX Auth service integration is not configured');
    }
    headers['X-MAX-Auth-Service-Token'] = env.MAX_AUTH_SERVICE_TOKEN;
  }

  return headers;
}

router.use(async (req, res, next) => {
  try {
    const internal = req.path.replace(/^\\/+/, '').split('/')[0] === 'internal';

    if (internal && req.header('X-MAX-Auth-Service-Token') !== env.MAX_AUTH_SERVICE_TOKEN) {
      throw new ApiError(401, 'AUTH_INTERNAL_REQUIRED', 'MAX Auth internal access is required');
    }

    const base = env.MAX_AUTH_API_URL.replace(/\\/$/, '');
    const target = new URL(base + remotePath(req));

    for (const [key, value] of Object.entries(req.query)) {
      if (Array.isArray(value)) {
        value.forEach((item) => target.searchParams.append(key, String(item)));
      } else if (value !== undefined) {
        target.searchParams.set(key, String(value));
      }
    }

    const hasBody = !['GET', 'HEAD'].includes(req.method);
    const response = await fetch(target, {
      method: req.method,
      headers: forwardedHeaders(req, internal),
      body: hasBody ? JSON.stringify(req.body ?? {}) : undefined,
      redirect: 'manual'
    });

    res.status(response.status);

    const contentType = response.headers.get('content-type');
    if (contentType) res.setHeader('content-type', contentType);

    const cacheControl = response.headers.get('cache-control');
    if (cacheControl) res.setHeader('cache-control', cacheControl);

    const location = response.headers.get('location');
    if (location) res.setHeader('location', location);

    const setCookies = response.headers.getSetCookie?.() ?? [];
    if (setCookies.length) res.setHeader('set-cookie', setCookies);

    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  } catch (error) {
    next(error);
  }
});

export const maxAuthProxyRouter = router;
