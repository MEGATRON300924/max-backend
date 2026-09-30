import type { Request } from 'express';

export interface AuthPrincipal {
  subject: string;
  email?: string;
  username?: string;
  tier?: string;
  name?: string;
  picture?: string;
  claims: Record<string, unknown>;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthPrincipal;
}
