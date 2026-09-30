import { env } from '../config/env.js';
import { ApiError } from '../middleware/errors.js';

const plans = {
  FREE: { id: 'free', name: 'MAX Free', cloudBytes: 100 * 1024 * 1024, voice: true, browser: true },
  PLUS: { id: 'plus', name: 'MAX Plus', cloudBytes: 5 * 1024 * 1024 * 1024, voice: true, browser: true },
  PRO: { id: 'pro', name: 'MAX Pro', cloudBytes: 50 * 1024 * 1024 * 1024, voice: true, browser: true },
  BUSINESS: { id: 'business', name: 'MAX Business', cloudBytes: 250 * 1024 * 1024 * 1024, voice: true, browser: true },
  ENTERPRISE: { id: 'enterprise', name: 'MAX Enterprise', cloudBytes: 1024 * 1024 * 1024 * 1024, voice: true, browser: true }
} as const;

export function entitlements(tier?: string | null) {
  const key = String(tier || 'FREE').toUpperCase() as keyof typeof plans;
  const plan = plans[key] ?? plans.FREE;
  return { tier: key in plans ? key : 'FREE', plan, checkoutConfigured: Boolean(env.MAX_PAY_CHECKOUT_URL) };
}

export function checkoutUrl() {
  if (!env.MAX_PAY_CHECKOUT_URL) throw new ApiError(503, 'MAX_PAY_NOT_CONFIGURED', 'MAX Pay checkout is not configured');
  return env.MAX_PAY_CHECKOUT_URL;
}
