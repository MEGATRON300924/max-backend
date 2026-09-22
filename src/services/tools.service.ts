import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/errors.js';
import { maxHomeRequest } from './home.service.js';
import type { GeminiFunctionDeclaration } from './ai.service.js';
import { recordAuditEvent } from './audit.service.js';
import { env } from '../config/env.js';

type ToolContext = {
  userId: string;
  authSubject?: string;
  confirmed?: boolean;
  authAccessToken?: string;
  timezone?: string | null;
};

export type MaxTool = {
  name: string;
  capability: string;
  description: string;
  enabled: boolean;
  requiresConfirmation: boolean;
  declaration: GeminiFunctionDeclaration;
};

const memoryInput = z.object({
  type: z.enum(['PREFERENCE', 'FACT', 'INTEREST', 'ROUTINE', 'INSTRUCTION']),
  key: z.string().trim().min(1).max(120),
  value: z.string().trim().min(1).max(4000),
  confidence: z.number().min(0).max(1).optional()
});

const homeInput = z.object({
  action: z.string().trim().min(1).max(100),
  targetId: z.string().trim().min(1).max(200).optional(),
  parameters: z.record(z.unknown()).optional()
});


const calendarInput = z.object({
  calendarId: z.string().trim().min(1).max(500).optional(),
  timeMin: z.string().trim().max(100).optional(),
  timeMax: z.string().trim().max(100).optional(),
  range: z.enum(['today', 'tomorrow', 'yesterday', 'this_week', 'next_week']).optional(),
  maxResults: z.number().int().min(1).max(250).optional(),
  pageToken: z.string().trim().max(2000).optional()
}).refine((data) => !data.timeMin || !data.timeMax || data.timeMin <= data.timeMax, {
  message: 'timeMin must be earlier than or equal to timeMax'
}).refine((data) => !data.range || (!data.timeMin && !data.timeMax), {
  message: 'Use range instead of timeMin/timeMax'
});

const calendarDateTime = z.object({
  dateTime: z.string().trim().min(1).max(100),
  timeZone: z.string().trim().min(1).max(100).optional()
}).superRefine((value, ctx) => {
  const iso = /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d{1,3})?)?(?:Z|[+-]\\d{2}:?\\d{2})?$/;
  if (!iso.test(value.dateTime)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'dateTime must be an ISO-8601 date/time' });
  }
  if (!/[zZ]|[+-]\\d{2}:?\\d{2}$/.test(value.dateTime) && !value.timeZone) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A local dateTime must include an IANA timeZone' });
  }
});

const calendarAttendee = z.object({
  email: z.string().trim().email().max(320),
  displayName: z.string().trim().max(200).optional(),
  optional: z.boolean().optional()
});

const calendarEventResource = z.object({
  summary: z.string().trim().min(1).max(500),
  description: z.string().trim().max(10000).optional(),
  location: z.string().trim().max(1000).optional(),
  start: calendarDateTime,
  end: calendarDateTime,
  attendees: z.array(calendarAttendee).max(100).optional(),
  recurrence: z.array(z.string().trim().min(1).max(1000)).max(20).optional(),
  reminders: z.object({
    useDefault: z.boolean().optional(),
    overrides: z.array(z.object({
      method: z.enum(['email', 'popup']),
      minutes: z.number().int().min(0).max(40320)
    })).max(10).optional()
  }).optional(),
  colorId: z.string().trim().max(50).optional(),
  visibility: z.enum(['default', 'public', 'private', 'confidential']).optional(),
  status: z.enum(['confirmed', 'tentative']).optional()
});

const calendarCreateInput = z.object({
  calendarId: z.string().trim().min(1).max(500).optional(),
  event: calendarEventResource
}).superRefine((value, ctx) => {
  const start = parseCalendarDateTime(value.event.start);
  const end = parseCalendarDateTime(value.event.end);
  if (start !== null && end !== null && end <= start) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['event', 'end', 'dateTime'], message: 'Event end must be after event start' });
  }
});

const calendarUpdateInput = z.object({
  calendarId: z.string().trim().min(1).max(500).optional(),
  eventId: z.string().trim().min(1).max(500),
  event: calendarEventResource.partial().refine((event) => Object.keys(event).length > 0, {
    message: 'At least one event field must be supplied'
  })
});

const calendarDeleteInput = z.object({
  calendarId: z.string().trim().min(1).max(500).optional(),
  eventId: z.string().trim().min(1).max(500)
});

function getTimezoneParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}

function timezoneOffsetMs(date: Date, timeZone: string) {
  const parts = getTimezoneParts(date, timeZone);
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return asUtc - date.getTime();
}

function parseCalendarDateTime(value: { dateTime: string; timeZone?: string }) {
  if (/[zZ]|[+-]\\d{2}:?\\d{2}$/.test(value.dateTime)) {
    const timestamp = Date.parse(value.dateTime);
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  if (!value.timeZone) return null;
  const match = value.dateTime.match(/^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2})(?::(\\d{2})(?:\\.(\\d{1,3}))?)?$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second = '00', fraction = '0'] = match;
  const localAsUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), Number(fraction.padEnd(3, '0')));
  const firstGuess = new Date(localAsUtc);
  const offset = timezoneOffsetMs(firstGuess, value.timeZone);
  const adjusted = new Date(localAsUtc - offset);
  const secondOffset = timezoneOffsetMs(adjusted, value.timeZone);
  return localAsUtc - secondOffset;
}

function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

function normalizeCalendarEvent(event: Record<string, any>, timezone?: string | null) {
  const fallback = timezone || 'UTC';
  if (!isValidTimeZone(fallback)) throw new ApiError(400, 'INVALID_TIMEZONE', 'The user timezone is invalid');
  const normalized = { ...event };
  for (const key of ['start', 'end']) {
    if (normalized[key] && typeof normalized[key] === 'object') {
      normalized[key] = {
        ...normalized[key],
        ...(normalized[key].timeZone ? {} : { timeZone: fallback })
      };
    }
  }
  const start = normalized.start;
  const end = normalized.end;
  const startMs = start ? parseCalendarDateTime(start) : null;
  const endMs = end ? parseCalendarDateTime(end) : null;
  if (startMs !== null && endMs !== null && endMs <= startMs) {
    throw new ApiError(400, 'CALENDAR_TIME_ORDER_INVALID', 'Event end must be after event start');
  }
  return normalized;
}

function getLocalDateParts(timeZone: string, date = new Date()) {
  const parts = getTimezoneParts(date, timeZone);
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

function shiftDate(date: { year: number; month: number; day: number }, days: number) {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

function localBoundaryIso(date: { year: number; month: number; day: number }, timeZone: string, endOfDay = false) {
  const local = `${date.year.toString().padStart(4, '0')}-${date.month.toString().padStart(2, '0')}-${date.day.toString().padStart(2, '0')}T${endOfDay ? '23:59:59' : '00:00:00'}`;
  const timestamp = parseCalendarDateTime({ dateTime: local, timeZone });
  if (timestamp === null) throw new ApiError(400, 'INVALID_TIMEZONE', 'Unable to resolve the calendar timezone');
  return new Date(timestamp).toISOString();
}

function resolveCalendarRange(range: z.infer<typeof calendarInput>['range'], timezone?: string | null) {
  if (!range) return null;
  const timeZone = timezone || 'UTC';
  if (!isValidTimeZone(timeZone)) throw new ApiError(400, 'INVALID_TIMEZONE', 'The user timezone is invalid');
  const today = getLocalDateParts(timeZone);
  const startOffset = range === 'tomorrow' ? 1 : range === 'yesterday' ? -1 : range === 'next_week' ? 7 - ((new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay() + 6) % 7) : range === 'this_week' ? -((new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay() + 6) % 7) : 0;
  const start = shiftDate(today, startOffset);
  const days = range === 'next_week' || range === 'this_week' ? 6 : 0;
  const end = shiftDate(start, days);
  return { timeMin: localBoundaryIso(start, timeZone), timeMax: localBoundaryIso(end, timeZone, true) };
}

async function maxAuthCalendarRequest(path: string, context: ToolContext, init: RequestInit = {}) {
  if (!context.authAccessToken) throw new ApiError(401, 'AUTH_TOKEN_REQUIRED', 'A MAX Auth access token is required for Google Calendar');
  const response = await fetch(env.MAX_AUTH_API_URL + '/connected-accounts/google/calendar' + path, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: 'Bearer ' + context.authAccessToken, Accept: 'application/json' }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, body?.error?.code || body?.code || 'GOOGLE_CALENDAR_ERROR', body?.error?.message || body?.message || 'Google Calendar request failed');
  return body?.data ?? body;
}

export async function getGoogleCalendarEventForConfirmation(context: ToolContext, eventId: string, calendarId?: string) {
  return maxAuthCalendarRequest('/events/' + encodeURIComponent(eventId) + (calendarId ? '?calendarId=' + encodeURIComponent(calendarId) : ''), context);
}

const tools: MaxTool[] = [
  {
    name: 'calendar.list', capability: 'calendar', description: 'Read the authenticated user\'s Google calendars.', enabled: true, requiresConfirmation: false,
    declaration: { name: 'calendar_list', description: 'List the user\'s connected Google calendars.', parameters: { type: 'object', properties: {} } }
  },
  {
    name: 'calendar.events', capability: 'calendar', description: 'Read events from the authenticated user\'s Google Calendar.', enabled: true, requiresConfirmation: false,
    declaration: { name: 'calendar_events', description: 'List Google Calendar events. For today, tomorrow, yesterday, this week, or next week, use range so MAX resolves the exact boundaries in the user timezone. Use explicit timeMin/timeMax for custom ranges. Use calendarId only when the user names a specific calendar.', parameters: { type: 'object', properties: { calendarId: { type: 'string' }, timeMin: { type: 'string' }, timeMax: { type: 'string' }, range: { type: 'string', enum: ['today', 'tomorrow', 'yesterday', 'this_week', 'next_week'] }, maxResults: { type: 'number' }, pageToken: { type: 'string' } } } }
  },
  {
    name: 'calendar.create', capability: 'calendar', description: 'Create a Google Calendar event.', enabled: true, requiresConfirmation: true,
    declaration: { name: 'calendar_create', description: 'Create a Google Calendar event after explicit user confirmation. Always provide summary, start.dateTime, and end.dateTime. Use an IANA time zone such as Africa/Lagos when the user gives local times. Do not invent missing times; ask the user when a required detail is missing.', parameters: { type: 'object', properties: { calendarId: { type: 'string' }, event: { type: 'object', description: 'Event resource. Required fields: summary, start {dateTime,timeZone}, end {dateTime,timeZone}. Optional: description, location, attendees [{email,displayName,optional}], recurrence, reminders, colorId, visibility, status.' } }, required: ['event'] } }
  },
  {
    name: 'calendar.update', capability: 'calendar', description: 'Update a Google Calendar event.', enabled: true, requiresConfirmation: true,
    declaration: { name: 'calendar_update', description: 'Update an existing Google Calendar event after explicit user confirmation. eventId is required and event must contain only the fields being changed. Preserve existing fields by sending partial changes. Never invent an eventId; get it from calendar_events.', parameters: { type: 'object', properties: { calendarId: { type: 'string' }, eventId: { type: 'string' }, event: { type: 'object' } }, required: ['eventId', 'event'] } }
  },
  {
    name: 'calendar.delete', capability: 'calendar', description: 'Delete a Google Calendar event.', enabled: true, requiresConfirmation: true,
    declaration: { name: 'calendar_delete', description: 'Delete an existing Google Calendar event after explicit user confirmation. eventId is required and must come from a calendar_events result. Never guess an eventId.', parameters: { type: 'object', properties: { calendarId: { type: 'string' }, eventId: { type: 'string' } }, required: ['eventId'] } }
  },

  {
    name: 'memory.save',
    capability: 'memory',
    description: 'Save a durable user memory belonging to the authenticated user.',
    enabled: true,
    requiresConfirmation: false,
    declaration: {
      name: 'memory_save',
      description: 'Save a durable memory when the user explicitly asks MAX to remember a preference, fact, interest, routine, or instruction.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['PREFERENCE', 'FACT', 'INTEREST', 'ROUTINE', 'INSTRUCTION'] },
          key: { type: 'string', description: 'Short memory key.' },
          value: { type: 'string', description: 'The information to remember.' },
          confidence: { type: 'number', minimum: 0, maximum: 1 }
        },
        required: ['type', 'key', 'value']
      }
    }
  },
  {
    name: 'memory.delete',
    capability: 'memory',
    description: 'Delete a durable user memory belonging to the authenticated user.',
    enabled: true,
    requiresConfirmation: true,
    declaration: {
      name: 'memory_delete',
      description: 'Delete a user memory only after explicit confirmation from the user.',
      parameters: {
        type: 'object',
        properties: { memoryId: { type: 'string', description: 'The memory identifier to delete.' } },
        required: ['memoryId']
      }
    }
  },
  {
    name: 'home.execute',
    capability: 'home',
    description: 'Execute an authorized MAX Home action.',
    enabled: Boolean(process.env.MAX_HOME_API_URL),
    requiresConfirmation: true,
    declaration: {
      name: 'home_execute',
      description: 'Execute an authorized smart-home action through MAX Home after explicit confirmation.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'The requested MAX Home action.' },
          targetId: { type: 'string', description: 'The authorized device, room, scene, or other target identifier.' },
          parameters: { type: 'object', description: 'Action-specific parameters.' }
        },
        required: ['action']
      }
    }
  }
];

export function listTools() {
  return tools.map(({ declaration, ...tool }) => ({ ...tool }));
}

export function getGeminiTools() {
  return tools.filter((tool) => tool.enabled).map((tool) => tool.declaration);
}

export function resolveGeminiTool(name: string) {
  return tools.find((tool) => tool.enabled && tool.declaration.name === name);
}

export function validateToolInput(name: string, input: unknown) {
  if (name === 'calendar.events') return calendarInput.parse(input);
  if (name === 'calendar.create') return calendarCreateInput.parse(input);
  if (name === 'calendar.update') return calendarUpdateInput.parse(input);
  if (name === 'calendar.delete') return calendarDeleteInput.parse(input);
  return input;
}

export async function executeTool(name: string, context: ToolContext, input: unknown) {
  const startedAt = Date.now();
  const tool = tools.find((candidate) => candidate.name === name);

  if (!tool || !tool.enabled) {
    await recordAuditEvent({ userId: context.userId, eventType: 'tool_execution', action: 'rejected', status: 'UNAVAILABLE', metadata: { toolName: name } });
    throw new ApiError(503, 'TOOL_NOT_AVAILABLE', `MAX tool ${name} is not available`);
  }

  if (tool.requiresConfirmation && !context.confirmed) {
    await recordAuditEvent({ userId: context.userId, eventType: 'tool_execution', action: 'rejected', status: 'CONFIRMATION_REQUIRED', metadata: { toolName: name } });
    throw new ApiError(409, 'TOOL_CONFIRMATION_REQUIRED', `MAX tool ${name} requires confirmation`);
  }

  try {
    let result: unknown;

    if (name === 'calendar.list') {
      result = { success: true, tool: name, calendars: await maxAuthCalendarRequest('', context) };
    } else if (name === 'calendar.events') {
      const data = validateToolInput(name, input) as z.infer<typeof calendarInput>;
      const params = new URLSearchParams();
      const resolvedRange = resolveCalendarRange(data.range, context.timezone);
      const eventQuery = resolvedRange ? { ...data, ...resolvedRange } : data;
      for (const [key, value] of Object.entries(eventQuery)) if (value !== undefined && key !== 'calendarId' && key !== 'range') params.set(key, String(value));
      result = { success: true, tool: name, events: await maxAuthCalendarRequest('/events?' + params.toString() + (data.calendarId ? '&calendarId=' + encodeURIComponent(data.calendarId) : ''), context) };
    } else if (name === 'calendar.create') {
      const data = validateToolInput(name, input) as z.infer<typeof calendarCreateInput>;
      result = { success: true, tool: name, event: await maxAuthCalendarRequest('/events' + (data.calendarId ? '?calendarId=' + encodeURIComponent(data.calendarId) : ''), context, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(normalizeCalendarEvent(data.event as Record<string, any>, context.timezone)) }) };
    } else if (name === 'calendar.update') {
      const data = validateToolInput(name, input) as z.infer<typeof calendarUpdateInput>;
      result = { success: true, tool: name, event: await maxAuthCalendarRequest('/events/' + encodeURIComponent(data.eventId) + (data.calendarId ? '?calendarId=' + encodeURIComponent(data.calendarId) : ''), context, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(normalizeCalendarEvent(data.event as Record<string, any>, context.timezone)) }) };
    } else if (name === 'calendar.delete') {
      const data = validateToolInput(name, input) as z.infer<typeof calendarDeleteInput>;
      result = { success: true, tool: name, result: await maxAuthCalendarRequest('/events/' + encodeURIComponent(data.eventId) + (data.calendarId ? '?calendarId=' + encodeURIComponent(data.calendarId) : ''), context, { method: 'DELETE' }) };
    } else if (name === 'memory.save') {
      const data = memoryInput.parse(input);
      const memory = await prisma.memory.upsert({
        where: { userId_type_key: { userId: context.userId, type: data.type, key: data.key } },
        create: { userId: context.userId, ...data, source: 'max-ai' },
        update: { value: data.value, confidence: data.confidence, source: 'max-ai' }
      });
      result = { success: true, tool: name, memoryId: memory.id };
    } else if (name === 'memory.delete') {
      const data = z.object({ memoryId: z.string().min(1).max(200) }).parse(input);
      const deleted = await prisma.memory.deleteMany({ where: { id: data.memoryId, userId: context.userId } });
      if (deleted.count !== 1) throw new ApiError(404, 'MEMORY_NOT_FOUND', 'The requested memory was not found');
      result = { success: true, tool: name, memoryId: data.memoryId };
    } else if (name === 'home.execute') {
      if (!context.authSubject) throw new ApiError(401, 'AUTH_SUBJECT_REQUIRED', 'MAX Home requires an authenticated MAX identity');
      const data = homeInput.parse(input);
      const homeResult = await maxHomeRequest({
        path: `/api/v1/users/${encodeURIComponent(context.authSubject)}/actions`,
        method: 'POST',
        body: data
      });
      result = { success: true, tool: name, result: homeResult };
    } else {
      throw new ApiError(501, 'TOOL_NOT_IMPLEMENTED', `MAX tool ${name} is registered but not implemented`);
    }

    await recordAuditEvent({
      userId: context.userId,
      eventType: 'tool_execution',
      action: 'completed',
      status: 'COMPLETED',
      metadata: { toolName: name, confirmed: Boolean(context.confirmed), durationMs: Date.now() - startedAt }
    });

    return result;
  } catch (error) {
    await recordAuditEvent({
      userId: context.userId,
      eventType: 'tool_execution',
      action: 'failed',
      status: 'FAILED',
      metadata: {
        toolName: name,
        confirmed: Boolean(context.confirmed),
        durationMs: Date.now() - startedAt,
        errorType: error instanceof Error ? error.name : 'unknown'
      }
    });
    throw error;
  }
}
