import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

export const correlationMiddleware: RequestHandler = (req, res, next) => {
  const incoming = req.header('x-correlation-id');
  const correlationId = incoming && incoming.length <= 128 ? incoming : randomUUID();
  res.setHeader('x-correlation-id', correlationId);
  res.locals.correlationId = correlationId;
  next();
};
