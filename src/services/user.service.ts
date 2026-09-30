import { prisma } from '../lib/prisma.js';
import type { AuthPrincipal } from '../types/auth.js';

export async function resolveEcosystemUser(principal: AuthPrincipal) {
  const timezone = typeof principal.claims.timezone === 'string' ? principal.claims.timezone : undefined;
  const locale = typeof principal.claims.language === 'string' ? principal.claims.language : undefined;
  return prisma.ecosystemUser.upsert({
    where: { authSubject: principal.subject },
    create: {
      authSubject: principal.subject,
      email: principal.email,
      displayName: principal.name ?? principal.username,
      avatarUrl: principal.picture
    },
    update: {
      email: principal.email,
      displayName: principal.name ?? principal.username,
      avatarUrl: principal.picture
    }
  });
}
