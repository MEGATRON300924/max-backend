import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/errors.js';
import { maxHomeRequest } from './home.service.js';
import type { GeminiFunctionDeclaration } from './ai.service.js';
import { recordAuditEvent } from './audit.service.js';
import { env } from '../config/env.js';
import { maxAuthGoogleRequest } from './max-auth-google.service.js';

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

const googleIdInput = z.object({ id: z.string().trim().min(1).max(500) });
const googleDriveListInput = z.object({ q: z.string().max(2000).optional(), pageSize: z.number().int().min(1).max(100).optional(), pageToken: z.string().max(2000).optional(), orderBy: z.string().max(500).optional() });
const googleGmailListInput = z.object({ q: z.string().max(2000).optional(), maxResults: z.number().int().min(1).max(100).optional(), pageToken: z.string().max(2000).optional() });
const googleTasksInput = z.object({ taskListId: z.string().max(500).optional() });
const googleYouTubeSearchInput = z.object({ q: z.string().trim().min(1).max(500), type: z.enum(['video','channel','playlist']).optional(), maxResults: z.number().int().min(1).max(50).optional(), pageToken: z.string().max(2000).optional() });
const googleContactsInput = z.object({ pageSize: z.number().int().min(1).max(1000).optional() });
const googleSheetInput = z.object({ spreadsheetId: z.string().trim().min(1).max(500), range: z.string().max(1000).optional() });
const googleWriteInput = z.record(z.unknown());
const googleGmailSendInput = z.object({ raw: z.string().min(1).max(1000000) });
const googleGmailModifyInput = z.object({ messageId: z.string().trim().min(1).max(500), addLabelIds: z.array(z.string().max(100)).max(50).optional(), removeLabelIds: z.array(z.string().max(100)).max(50).optional() });
const googleSheetWriteInput = z.object({ spreadsheetId: z.string().trim().min(1).max(500), range: z.string().trim().min(1).max(1000), values: z.array(z.array(z.unknown())).max(10000), valueInputOption: z.string().max(100).optional() });
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
    name: 'google.drive.list', capability: 'google.drive', description: 'Read files the user has authorized MAX to access in Google Drive.', enabled: true, requiresConfirmation: false,
    declaration: { name: 'google_drive_list', description: 'List the user-authorized Google Drive files. Use q for targeted searches.', parameters: { type: 'object', properties: { q: { type: 'string' }, pageSize: { type: 'number' }, pageToken: { type: 'string' }, orderBy: { type: 'string' } } } }
  },
  {
    name: 'google.drive.get', capability: 'google.drive', description: 'Read a specific Google Drive file.', enabled: true, requiresConfirmation: false,
    declaration: { name: 'google_drive_get', description: 'Get a Google Drive file by file ID.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }
  },
  {
    name: 'google.drive.create', capability: 'google.drive', description: 'Create a Google Drive file.', enabled: true, requiresConfirmation: true,
    declaration: { name: 'google_drive_create', description: 'Create a Google Drive file after confirmation. Pass the Drive file resource fields supported by MAX Auth.', parameters: { type: 'object', properties: { name: { type: 'string' }, mimeType: { type: 'string' }, parents: { type: 'array' }, content: { type: 'string' } }, required: ['name'] } }
  },
  {
    name: 'google.drive.update', capability: 'google.drive', description: 'Update a Google Drive file.', enabled: true, requiresConfirmation: true,
    declaration: { name: 'google_drive_update', description: 'Update a Google Drive file after confirmation.', parameters: { type: 'object', properties: { id: { type: 'string' }, patch: { type: 'object' } }, required: ['id','patch'] } }
  },
  {
    name: 'google.drive.delete', capability: 'google.drive', description: 'Delete a Google Drive file.', enabled: true, requiresConfirmation: true,
    declaration: { name: 'google_drive_delete', description: 'Delete a Google Drive file after confirmation.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }
  },
  {
    name: 'google.docs.get', capability: 'google.docs', description: 'Read a Google Doc.', enabled: true, requiresConfirmation: false,
    declaration: { name: 'google_docs_get', description: 'Get a Google Doc by document ID.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }
  },
  {
    name: 'google.docs.update', capability: 'google.docs', description: 'Update a Google Doc.', enabled: true, requiresConfirmation: true,
    declaration: { name: 'google_docs_update', description: 'Apply Google Docs batch update requests after confirmation.', parameters: { type: 'object', properties: { id: { type: 'string' }, requests: { type: 'array' } }, required: ['id','requests'] } }
  },
  {
    name: 'google.sheets.get', capability: 'google.sheets', description: 'Read a Google Sheet.', enabled: true, requiresConfirmation: false,
    declaration: { name: 'google_sheets_get', description: 'Get Google Sheets spreadsheet data.', parameters: { type: 'object', properties: { spreadsheetId: { type: 'string' }, range: { type: 'string' } }, required: ['spreadsheetId'] } }
  },
  {
    name: 'google.sheets.update', capability: 'google.sheets', description: 'Update a Google Sheet.', enabled: true, requiresConfirmation: true,
    declaration: { name: 'google_sheets_update', description: 'Write values to a Google Sheet after confirmation.', parameters: { type: 'object', properties: { spreadsheetId: { type: 'string' }, range: { type: 'string' }, values: { type: 'array' }, valueInputOption: { type: 'string' } }, required: ['spreadsheetId','range','values'] } }
  },
  {
    name: 'google.slides.get', capability: 'google.slides', description: 'Read a Google Slides presentation.', enabled: true, requiresConfirmation: false,
    declaration: { name: 'google_slides_get', description: 'Get a Google Slides presentation.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }
  },
  {
    name: 'google.slides.update', capability: 'google.slides', description: 'Update a Google Slides presentation.', enabled: true, requiresConfirmation: true,
    declaration: { name: 'google_slides_update', description: 'Apply Google Slides batch update requests after confirmation.', parameters: { type: 'object', properties: { id: { type: 'string' }, requests: { type: 'array' } }, required: ['id','requests'] } }
  },
  {
    name: 'google.gmail.list', capability: 'google.gmail', description: 'Search the user-authorized Gmail mailbox.', enabled: true, requiresConfirmation: false,
    declaration: { name: 'google_gmail_list', description: 'Search Gmail using Gmail search syntax.', parameters: { type: 'object', properties: { q: { type: 'string' }, maxResults: { type: 'number' }, pageToken: { type: 'string' } } } }
  },
  {
    name: 'google.gmail.get', capability: 'google.gmail', description: 'Read a Gmail message.', enabled: true, requiresConfirmation: false,
    declaration: { name: 'google_gmail_get', description: 'Get a Gmail message by ID.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }
  },
  {
    name: 'google.gmail.send', capability: 'google.gmail', description: 'Send an email through Gmail.', enabled: true, requiresConfirmation: true,
    declaration: { name: 'google_gmail_send', description: 'Send a Gmail message after explicit confirmation. raw must be a base64url-encoded RFC 2822 message.', parameters: { type: 'object', properties: { raw: { type: 'string' } }, required: ['raw'] } }
  },
  {
    name: 'google.gmail.modify', capability: 'google.gmail', description: 'Modify Gmail labels.', enabled: true, requiresConfirmation: true,
    declaration: { name: 'google_gmail_modify', description: 'Add or remove Gmail labels after confirmation.', parameters: { type: 'object', properties: { messageId: { type: 'string' }, addLabelIds: { type: 'array' }, removeLabelIds: { type: 'array' } }, required: ['messageId'] } }
  },
  {
    name: 'google.tasks.list', capability: 'google.tasks', description: 'List Google Tasks.', enabled: true, requiresConfirmation: false,
    declaration: { name: 'google_tasks_list', description: 'List tasks from the user task list.', parameters: { type: 'object', properties: { taskListId: { type: 'string' } } } }
  },
  {
    name: 'google.tasks.create', capability: 'google.tasks', description: 'Create a Google Task.', enabled: true, requiresConfirmation: true,
    declaration: { name: 'google_tasks_create', description: 'Create a Google Task after confirmation.', parameters: { type: 'object', properties: { taskListId: { type: 'string' }, title: { type: 'string' }, notes: { type: 'string' }, due: { type: 'string' } }, required: ['title'] } }
  },
  {
    name: 'google.tasks.update', capability: 'google.tasks', description: 'Update a Google Task.', enabled: true, requiresConfirmation: true,
    declaration: { name: 'google_tasks_update', description: 'Update a Google Task after confirmation.', parameters: { type: 'object', properties: { taskId: { type: 'string' }, taskListId: { type: 'string' }, patch: { type: 'object' } }, required: ['taskId','patch'] } }
  },
  {
    name: 'google.tasks.delete', capability: 'google.tasks', description: 'Delete a Google Task.', enabled: true, requiresConfirmation: true,
    declaration: { name: 'google_tasks_delete', description: 'Delete a Google Task after confirmation.', parameters: { type: 'object', properties: { taskId: { type: 'string' }, taskListId: { type: 'string' } }, required: ['taskId'] } }
  },
  {
    name: 'google.contacts.list', capability: 'google.contacts', description: 'Read Google Contacts.', enabled: true, requiresConfirmation: false,
    declaration: { name: 'google_contacts_list', description: 'List the user Google Contacts.', parameters: { type: 'object', properties: { pageSize: { type: 'number' } } } }
  },
  {
    name: 'google.youtube.channels', capability: 'google.youtube', description: 'Read the user YouTube channel.', enabled: true, requiresConfirmation: false,
    declaration: { name: 'google_youtube_channels', description: 'Get the authenticated user YouTube channel.', parameters: { type: 'object', properties: {} } }
  },
  {
    name: 'google.youtube.subscriptions', capability: 'google.youtube', description: 'Read YouTube subscriptions.', enabled: true, requiresConfirmation: false,
    declaration: { name: 'google_youtube_subscriptions', description: 'List the authenticated user YouTube subscriptions.', parameters: { type: 'object', properties: { maxResults: { type: 'number' }, pageToken: { type: 'string' } } } }
  },
  {
    name: 'google.youtube.search', capability: 'google.youtube', description: 'Search YouTube.', enabled: true, requiresConfirmation: false,
    declaration: { name: 'google_youtube_search', description: 'Search YouTube for videos, channels, or playlists.', parameters: { type: 'object', properties: { q: { type: 'string' }, type: { type: 'string', enum: ['video','channel','playlist'] }, maxResults: { type: 'number' }, pageToken: { type: 'string' } }, required: ['q'] } }
  },

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
  if (name === 'google.drive.list') return googleDriveListInput.parse(input);
  if (name === 'google.drive.get' || name === 'google.drive.delete' || name === 'google.docs.get' || name === 'google.slides.get') return googleIdInput.parse(input);
  if (name === 'google.gmail.list') return googleGmailListInput.parse(input);
  if (name === 'google.gmail.get') return googleIdInput.parse(input);
  if (name === 'google.gmail.send') return googleGmailSendInput.parse(input);
  if (name === 'google.gmail.modify') return googleGmailModifyInput.parse(input);
  if (name === 'google.tasks.list') return googleTasksInput.parse(input);
  if (name === 'google.contacts.list') return googleContactsInput.parse(input);
  if (name === 'google.youtube.search') return googleYouTubeSearchInput.parse(input);
  if (name === 'google.sheets.get') return googleSheetInput.parse(input);
  if (name === 'google.sheets.update') return googleSheetWriteInput.parse(input);
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

    if (name === 'google.drive.list') {
      const data = validateToolInput(name, input) as z.infer<typeof googleDriveListInput>;
      result = { success: true, tool: name, ...(await maxAuthGoogleRequest(context.userId, '/drive/files', { query: data })) as object };
    } else if (name === 'google.drive.get') {
      const data = validateToolInput(name, input) as z.infer<typeof googleIdInput>;
      result = { success: true, tool: name, ...(await maxAuthGoogleRequest(context.userId, '/drive/files/' + encodeURIComponent(data.id))) as object };
    } else if (name === 'google.drive.create') {
      result = { success: true, tool: name, ...(await maxAuthGoogleRequest(context.userId, '/drive/files', { method: 'POST', body: input })) as object };
    } else if (name === 'google.drive.update') {
      const data = input as { id: string; patch: unknown };
      result = { success: true, tool: name, ...(await maxAuthGoogleRequest(context.userId, '/drive/files/' + encodeURIComponent(data.id), { method: 'PATCH', body: data.patch })) as object };
    } else if (name === 'google.drive.delete') {
      const data = validateToolInput(name, input) as z.infer<typeof googleIdInput>;
      result = { success: true, tool: name, result: await maxAuthGoogleRequest(context.userId, '/drive/files/' + encodeURIComponent(data.id), { method: 'DELETE' }) };
    } else if (name === 'google.docs.get') {
      const data = validateToolInput(name, input) as z.infer<typeof googleIdInput>;
      result = { success: true, tool: name, ...(await maxAuthGoogleRequest(context.userId, '/docs/' + encodeURIComponent(data.id))) as object };
    } else if (name === 'google.docs.update') {
      const data = input as { id: string; requests: unknown[] };
      result = { success: true, tool: name, ...(await maxAuthGoogleRequest(context.userId, '/docs/' + encodeURIComponent(data.id) + '/batchUpdate', { method: 'POST', body: { requests: data.requests } })) as object };
    } else if (name === 'google.sheets.get') {
      const data = validateToolInput(name, input) as z.infer<typeof googleSheetInput>;
      result = { success: true, tool: name, ...(await maxAuthGoogleRequest(context.userId, '/sheets/' + encodeURIComponent(data.spreadsheetId), { query: { range: data.range } })) as object };
    } else if (name === 'google.sheets.update') {
      const data = googleSheetWriteInput.parse(input) as z.infer<typeof googleSheetWriteInput>;
      result = { success: true, tool: name, result: await maxAuthGoogleRequest(context.userId, '/sheets/' + encodeURIComponent(String(data.spreadsheetId)) + '/values', { method: 'PUT', body: data }) };
    } else if (name === 'google.slides.get') {
      const data = validateToolInput(name, input) as z.infer<typeof googleIdInput>;
      result = { success: true, tool: name, ...(await maxAuthGoogleRequest(context.userId, '/slides/' + encodeURIComponent(data.id))) as object };
    } else if (name === 'google.slides.update') {
      const data = input as { id: string; requests: unknown[] };
      result = { success: true, tool: name, ...(await maxAuthGoogleRequest(context.userId, '/slides/' + encodeURIComponent(data.id) + '/batchUpdate', { method: 'POST', body: { requests: data.requests } })) as object };
    } else if (name === 'google.gmail.list') {
      const data = validateToolInput(name, input) as z.infer<typeof googleGmailListInput>;
      result = { success: true, tool: name, ...(await maxAuthGoogleRequest(context.userId, '/gmail/messages', { query: data })) as object };
    } else if (name === 'google.gmail.get') {
      const data = validateToolInput(name, input) as z.infer<typeof googleIdInput>;
      result = { success: true, tool: name, ...(await maxAuthGoogleRequest(context.userId, '/gmail/messages/' + encodeURIComponent(data.id))) as object };
    } else if (name === 'google.gmail.send') {
      const data = validateToolInput(name, input) as z.infer<typeof googleGmailSendInput>;
      result = { success: true, tool: name, ...(await maxAuthGoogleRequest(context.userId, '/gmail/messages/send', { method: 'POST', body: data })) as object };
    } else if (name === 'google.gmail.modify') {
      const data = validateToolInput(name, input) as z.infer<typeof googleGmailModifyInput>;
      result = { success: true, tool: name, ...(await maxAuthGoogleRequest(context.userId, '/gmail/messages/' + encodeURIComponent(data.messageId) + '/modify', { method: 'POST', body: data })) as object };
    } else if (name === 'google.tasks.list') {
      const data = validateToolInput(name, input) as z.infer<typeof googleTasksInput>;
      result = { success: true, tool: name, ...(await maxAuthGoogleRequest(context.userId, '/tasks', { query: data })) as object };
    } else if (name === 'google.tasks.create') {
      const data = input as Record<string, unknown>;
      const { taskListId, ...task } = data;
      result = { success: true, tool: name, ...(await maxAuthGoogleRequest(context.userId, '/tasks', { method: 'POST', query: { taskListId: String(taskListId ?? '@default') }, body: task })) as object };
    } else if (name === 'google.tasks.update') {
      const data = input as { taskId: string; taskListId?: string; patch: unknown };
      result = { success: true, tool: name, ...(await maxAuthGoogleRequest(context.userId, '/tasks/' + encodeURIComponent(data.taskId), { method: 'PATCH', query: { taskListId: data.taskListId ?? '@default' }, body: data.patch })) as object };
    } else if (name === 'google.tasks.delete') {
      const data = input as { taskId: string; taskListId?: string };
      result = { success: true, tool: name, result: await maxAuthGoogleRequest(context.userId, '/tasks/' + encodeURIComponent(data.taskId), { method: 'DELETE', query: { taskListId: data.taskListId ?? '@default' } }) };
    } else if (name === 'google.contacts.list') {
      const data = validateToolInput(name, input) as z.infer<typeof googleContactsInput>;
      result = { success: true, tool: name, ...(await maxAuthGoogleRequest(context.userId, '/contacts', { query: data })) as object };
    } else if (name === 'google.youtube.channels') {
      result = { success: true, tool: name, ...(await maxAuthGoogleRequest(context.userId, '/youtube/channels')) as object };
    } else if (name === 'google.youtube.subscriptions') {
      result = { success: true, tool: name, ...(await maxAuthGoogleRequest(context.userId, '/youtube/subscriptions', { query: input as Record<string, string> })) as object };
    } else if (name === 'google.youtube.search') {
      const data = validateToolInput(name, input) as z.infer<typeof googleYouTubeSearchInput>;
      result = { success: true, tool: name, ...(await maxAuthGoogleRequest(context.userId, '/youtube/search', { query: data })) as object };
    } else if (name === 'calendar.list') {
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
