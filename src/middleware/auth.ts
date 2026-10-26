import type { NextFunction, Response } from 'express';
import { env } from '../config/env.js';
import { ApiError } from './errors.js';
import type { AuthenticatedRequest, AuthPrincipal } from '../types/auth.js';

interface IntrospectionResponse {
  active?: boolean;
  client_id?: string;
  user?: {
    id?: string;
    email?: string | null;
    username?: string | null;
    displayName?: string | null;
    avatarUrl?: string | null;
    status?: string;
    verificationStatus?: string;
  };
  scopes?: string[];
  business_id?: string;
  business_name?: string;
  business_role?: string;
  exp?: number;
}

function principalFromIntrospection(result: IntrospectionResponse): AuthPrincipal {
  const user = result.user;

  if (!user || typeof user.id !== 'string' || user.id.length === 0) {
    throw new ApiError(401, 'INVALID_AUTH_TOKEN', 'MAX Auth did not return a valid account for this token');
  }

  return {
    subject: user.id,
    email: typeof user.email === 'string' ? user.email : undefined,
    username: typeof user.username === 'string' ? user.username : undefined,
    name: typeof user.displayName === 'string' ? user.displayName : undefined,
    picture: typeof user.avatarUrl === 'string' ? user.avatarUrl : undefined,
    claims: result as Record<string, unknown>
  };
}

export async function requireAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction) {
  try {
    const authorization = req.header('authorization');
    if (!authorization || !/^Bearer\\s+/i.test(authorization)) {
      throw new ApiError(401, 'AUTH_REQUIRED', 'A MAX Auth access token is required');
    }

    const token = authorization.replace(/^Bearer\\s+/i, '').trim();
    if (!token) {
      throw new ApiError(401, 'AUTH_REQUIRED', 'A MAX Auth access token is required');
    }

    if (!env.MAX_AUTH_SERVICE_TOKEN) {
      throw new ApiError(503, 'AUTH_NOT_CONFIGURED', 'MAX Auth service integration is not configured');
    }

    let response: globalThis.Response;
    try {
      response = await fetch(`${env.MAX_AUTH_API_URL.replace(/\\/$/, '')}/oauth/introspect`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-MAX-Service-Token': env.MAX_AUTH_SERVICE_TOKEN
        },
        body: JSON.stringify({ token }),
        signal: AbortSignal.timeout(8000)
      });
    } catch {
      throw new ApiError(503, 'AUTH_SERVICE_UNAVAILABLE', 'MAX Auth could not be reached');
    }

    if (!response.ok) {
      throw new ApiError(503, 'AUTH_SERVICE_ERROR', 'MAX Auth could not validate this session');
    }

    let result: IntrospectionResponse;
    try {
      result = await response.json() as IntrospectionResponse;
    } catch {
      throw new ApiError(503, 'AUTH_SERVICE_ERROR', 'MAX Auth returned an invalid response');
    }

    if (result.active !== true) {
      throw new ApiError(401, 'INVALID_AUTH_TOKEN', 'Authentication token is invalid, revoked, or expired');
    }

    req.auth = principalFromIntrospection(result);
    next();
  } catch (error) {
    next(error);
  }
}
