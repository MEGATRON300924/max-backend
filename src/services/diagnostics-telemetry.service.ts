import { env } from '../config/env.js';
import { sanitizeDiagnosticPath } from '../middleware/diagnostics.js';

type DiagnosticEvent = {
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  occurredAt: string;
};

const MAX_QUEUE_SIZE = 500;
const BATCH_SIZE = 50;
const FLUSH_INTERVAL_MS = 5000;
const RETRY_INTERVAL_MS = 15000;
const DELIVERY_TIMEOUT_MS = 3000;
const pending: DiagnosticEvent[] = [];
let flushTimer: NodeJS.Timeout | undefined;
let activeFlush: Promise<void> | undefined;

function scheduleFlush(delay = FLUSH_INTERVAL_MS): void {
  if (flushTimer || !env.MAX_AUTH_SERVICE_TOKEN || pending.length === 0) return;
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    void flushDiagnosticsTelemetry();
  }, delay);
  flushTimer.unref?.();
}

function endpoint(): string {
  return `${env.MAX_AUTH_INTERNAL_URL.replace(/\/+$/, '')}/diagnostics/events`;
}

async function sendBatch(batch: DiagnosticEvent[]): Promise<boolean> {
  if (!env.MAX_AUTH_SERVICE_TOKEN || batch.length === 0) return false;
  try {
    const response = await fetch(endpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-max-auth-service-token': env.MAX_AUTH_SERVICE_TOKEN,
      },
      body: JSON.stringify({ events: batch }),
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function enqueueDiagnosticEvent(event: DiagnosticEvent): void {
  if (!env.MAX_AUTH_SERVICE_TOKEN) return;
  pending.push(event);
  if (pending.length > MAX_QUEUE_SIZE) {
    pending.splice(0, pending.length - MAX_QUEUE_SIZE);
  }
  if (pending.length >= 25) {
    void flushDiagnosticsTelemetry();
  } else {
    scheduleFlush();
  }
}

export function flushDiagnosticsTelemetry(): Promise<void> {
  if (activeFlush) return activeFlush;
  if (!env.MAX_AUTH_SERVICE_TOKEN || pending.length === 0) return Promise.resolve();
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = undefined;
  }

  activeFlush = (async () => {
    let batchesSent = 0;
    while (pending.length > 0 && batchesSent < 10) {
      const batch = pending.splice(0, BATCH_SIZE);
      const delivered = await sendBatch(batch);
      if (!delivered) {
        pending.unshift(...batch);
        if (pending.length > MAX_QUEUE_SIZE) {
          pending.splice(MAX_QUEUE_SIZE);
        }
        break;
      }
      batchesSent += 1;
    }
  })().finally(() => {
    activeFlush = undefined;
    if (pending.length > 0) scheduleFlush(RETRY_INTERVAL_MS);
  });

  return activeFlush;
}

export function recordDiagnosticRequest(params: {
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
}): void {
  const allowedMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);
  const method = params.method.toUpperCase();
  if (!allowedMethods.has(method) || params.statusCode < 100 || params.statusCode > 599) return;

  enqueueDiagnosticEvent({
    method,
    path: sanitizeDiagnosticPath(params.path) || '/',
    statusCode: params.statusCode,
    durationMs: Math.max(0, Math.min(600000, Math.round(params.durationMs))),
    occurredAt: new Date().toISOString(),
  });
}
