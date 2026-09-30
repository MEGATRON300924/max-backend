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
  MAX_HOME_API_URL: z.string().url().optional(),
  MAX_AUTH_API_URL: z.string().url().default('https://auth.max-ai.name.ng/api/v1'),
  MAX_AUTH_INTERNAL_URL: z.string().url().default('https://auth.max-ai.name.ng/api/v1/internal'),
  MAX_AUTH_SERVICE_TOKEN: z.string().optional(),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().optional(),
  ELEVENLABS_TTS_MODEL: z.string().default('eleven_multilingual_v2'),
  ELEVENLABS_TTS_OUTPUT_FORMAT: z.string().default('mp3_44100_128'),
  ELEVENLABS_STT_MODEL: z.string().default('scribe_v2'),
  ELEVENLABS_STT_LANGUAGE: z.string().optional(),
  ELEVENLABS_MAX_AUDIO_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024)
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
    ['MAX_AUTH_AUDIENCE', config.MAX_AUTH_AUDIENCE],
    ['MAX_AUTH_SERVICE_TOKEN', config.MAX_AUTH_SERVICE_TOKEN]
  ].filter(([, value]) => !value).map(([name]) => name);

  if (missing.length > 0) {
    console.error('Invalid production authentication configuration', { missing });
    process.exit(1);
  }
}

export const env = config;
export const corsOrigins = env.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean);
