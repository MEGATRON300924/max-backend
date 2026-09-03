import { prisma } from '../lib/prisma.js';
import type { AuthPrincipal } from '../types/auth.js';

export async function resolveEcosystemUser(principal: AuthPrincipal) {
  return prisma.ecosystemUser.upsert({
    where: { authSubject: principal.subject },
    create: {
      authSubject: principal.subject,
      email: principal.email,
      displayName: principal.name,
      avatarUrl: principal.picture
    },
    update: {
      email: principal.email,
      displayName: principal.name,
      avatarUrl: principal.picture
    }
  });
}
