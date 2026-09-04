import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  API_PREFIX: z.string().startsWith('/').default('/api/v1'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  MAX_AUTH_ISSUER: z.string().optional(),
  MAX_AUTH_JWKS_URL: z.string().url().optional(),
  MAX_AUTH_AUDIENCE: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().url().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3.7-flash'),
  MAX_HOME_API_URL: z.string().url().optional()
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const config = parsed.data;

if (config.NODE_ENV === 'production') {
  const missing = [
    ['MAX_AUTH_JWKS_URL', config.MAX_AUTH_JWKS_URL],
    ['MAX_AUTH_ISSUER', config.MAX_AUTH_ISSUER],
    ['MAX_AUTH_AUDIENCE', config.MAX_AUTH_AUDIENCE]
  ].filter(([, value]) => !value).map(([name]) => name);

  if (missing.length > 0) {
    console.error('Invalid production authentication configuration', { missing });
    process.exit(1);
  }
}

export const env = config;
export const corsOrigins = env.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean);
