import pino from 'pino';
import { env } from './env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: undefined,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'accessToken',
      'refreshToken',
      'password',
      'token',
      'secret',
      'apiKey'
    ],
    censor: '[REDACTED]'
  }
});
