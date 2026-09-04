import type { NextFunction, Response } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { env } from '../config/env.js';
import { ApiError } from './errors.js';
import type { AuthenticatedRequest, AuthPrincipal } from '../types/auth.js';

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function getJwks() {
  if (!env.MAX_AUTH_JWKS_URL) {
    throw new ApiError(503, 'AUTH_NOT_CONFIGURED', 'MAX Auth is not configured');
  }

  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(env.MAX_AUTH_JWKS_URL));
  }

  return jwks;
}

function principalFromPayload(payload: JWTPayload): AuthPrincipal {
  if (!payload.sub) {
    throw new ApiError(401, 'INVALID_AUTH_TOKEN', 'Authentication token has no subject');
  }

  return {
    subject: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    picture: typeof payload.picture === 'string' ? payload.picture : undefined,
    claims: payload as Record<string, unknown>
  };
}

export async function requireAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction) {
  try {
    const authorization = req.header('authorization');
    if (!authorization || !/^Bearer\s+/i.test(authorization)) {
      throw new ApiError(401, 'AUTH_REQUIRED', 'A MAX Auth access token is required');
    }

    const token = authorization.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      throw new ApiError(401, 'AUTH_REQUIRED', 'A MAX Auth access token is required');
    }

    const options: Parameters<typeof jwtVerify>[2] = {
      requiredClaims: ['sub', 'exp']
    };

    if (env.MAX_AUTH_ISSUER) options.issuer = env.MAX_AUTH_ISSUER;
    if (env.MAX_AUTH_AUDIENCE) options.audience = env.MAX_AUTH_AUDIENCE;

    const { payload } = await jwtVerify(token, getJwks(), options);
    req.auth = principalFromPayload(payload);
    next();
  } catch (error) {
    if (error instanceof ApiError) {
      next(error);
      return;
    }

    next(new ApiError(401, 'INVALID_AUTH_TOKEN', 'Authentication token is invalid or expired'));
  }
}
