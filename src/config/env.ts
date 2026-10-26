import 'dotenv/config';
import { z } from 'zod';

// Optional service URLs may be left blank in deployment environments until the
// corresponding MAX ecosystem service is implemented. Treat blank values as unset.
const optionalUrl = z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().url().optional()
);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  API_PREFIX: z.string().startsWith('/').default('/api/v1'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().optional(),
  REDIS_URL: optionalUrl,
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3.7-flash'),
  MAX_HOME_API_URL: optionalUrl,
  MAX_AUTH_API_URL: z.string().url().default('https://auth.max-ai.name.ng/api/v1'),
  MAX_AUTH_INTERNAL_URL: z.string().url().default('https://auth.max-ai.name.ng/api/v1/internal'),
  MAX_AUTH_SERVICE_TOKEN: z.string().optional(),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().optional(),
  ELEVENLABS_TTS_MODEL: z.string().default('eleven_multilingual_v2'),
  ELEVENLABS_TTS_OUTPUT_FORMAT: z.string().default('mp3_44100_128'),
  ELEVENLABS_STT_MODEL: z.string().default('scribe_v2'),
  ELEVENLABS_STT_LANGUAGE: z.string().optional(),
  ELEVENLABS_MAX_AUDIO_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
  MAX_CLOUD_PROVIDER: z.enum(['local', 'mediafire']).default('mediafire'),
  MAX_CLOUD_STORAGE_PATH: z.string().default('./storage/max-cloud'),
  MAX_CLOUD_FILE_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
  MEDIAFIRE_API_URL: z.string().url().default('https://www.mediafire.com/api/1.5'),
  MEDIAFIRE_SESSION_TOKEN: z.string().optional(),
  MEDIAFIRE_ROOT_FOLDER_KEY: z.string().optional(),
  MAX_STORE_API_URL: optionalUrl,
  MAX_PAY_CHECKOUT_URL: optionalUrl,
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_APP_INSTALLATION_ID: z.string().optional(),
  GITHUB_ALLOWED_OWNERS: z.string().default(''),
  GITHUB_ALLOWED_AUTH_SUBJECTS: z.string().default('')
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const config = parsed.data;

if (config.NODE_ENV === 'production' && !config.MAX_AUTH_SERVICE_TOKEN) {
  console.error('Invalid production authentication configuration', { missing: ['MAX_AUTH_SERVICE_TOKEN'] });
  process.exit(1);
}

export const env = config;
export const corsOrigins = env.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean);
