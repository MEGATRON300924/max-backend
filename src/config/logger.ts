import pino from 'pino';
import { env } from './env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: undefined,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers.set-cookie',
      'req.headers.x-api-key',
      'authorization',
      'cookie',
      'set-cookie',
      'accessToken',
      'refreshToken',
      'password',
      'token',
      'secret',
      'apiKey',
      'api_key',
      'clientSecret',
      'client_secret'
    ],
    censor: '[REDACTED]'
  }
});
