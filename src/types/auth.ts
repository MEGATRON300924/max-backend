import type { Request } from 'express';

export interface AuthPrincipal {
  subject: string;
  email?: string;
  name?: string;
  picture?: string;
  claims: Record<string, unknown>;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthPrincipal;
}
