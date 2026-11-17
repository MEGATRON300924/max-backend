import { ApiError } from '../middleware/errors.js';
import { env } from '../config/env.js';

type HotelToolContext = {
  authAccessToken?: string;
};

type HotelWorkspace = {
  id: string;
  businessId: string;
  propertyName: string;
  propertyType: string;
  country: string;
  roomCount: number;
  status: string;
};

type HotelApiPayload = {
  data?: Record<string, any>;
  error?: { code?: string; message?: string };
};

function apiBase() {
  return env.MAX_HOTELS_API_URL.replace(/\/$/, '');
}

async function hotelGet(context: HotelToolContext, path: string) {
  if (!context.authAccessToken) {
    throw new ApiError(401, 'MAX_HOTELS_AUTH_REQUIRED', 'Sign in to MAX Hotels with a connected business before asking MAX about hotel operations.');
  }

  let response: Response;
  try {
    response = await fetch(`${apiBase()}${path}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${context.authAccessToken}`,
        Accept: 'application/json'
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    throw new ApiError(503, 'MAX_HOTELS_UNAVAILABLE', 'The MAX Hotels service could not be reached.');
  }

  const body = await response.json().catch(() => ({})) as HotelApiPayload;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      body.error?.code || 'MAX_HOTELS_REQUEST_FAILED',
      body.error?.message || 'MAX Hotels could not return the requested business data.'
    );
  }
  return body.data ?? {};
}

async function getWorkspaces(context: HotelToolContext): Promise<HotelWorkspace[]> {
  const data = await hotelGet(context, '/business/workspaces');
  return Array.isArray(data.workspaces) ? data.workspaces as HotelWorkspace[] : [];
}

function ensureWorkspace(workspaces: HotelWorkspace[], workspaceId?: string) {
  if (!workspaceId) return workspaces;
  const workspace = workspaces.find((item) => item.id === workspaceId);
  if (!workspace) {
    throw new ApiError(404, 'HOTEL_WORKSPACE_NOT_FOUND', 'That property is not available in the currently connected MAX Auth business.');
  }
  return [workspace];
}

function guestSummary(guest: Record<string, any>) {
  return {
    id: guest.id,
    guestName: guest.guestName,
    roomNumber: guest.roomNumber,
    language: guest.language,
    checkedInAt: guest.checkedInAt,
    expectedCheckoutAt: guest.expectedCheckoutAt,
    personalizationConsent: guest.personalizationConsent === true,
    maxAccountLinked: guest.maxAccountLinked === true
  };
}

export async function getHotelOverview(context: HotelToolContext, workspaceId?: string) {
  const businessData = await hotelGet(context, '/business/context');
  const allWorkspaces = await getWorkspaces(context);
  const workspaces = ensureWorkspace(allWorkspaces, workspaceId);

  const properties = await Promise.all(workspaces.map(async (workspace) => {
    const base = `/business/workspaces/${encodeURIComponent(workspace.id)}`;
    const [roomsData, devicesData, requestsData, guestsData] = await Promise.all([
      hotelGet(context, `${base}/rooms`),
      hotelGet(context, `${base}/devices`),
      hotelGet(context, `${base}/service-requests`),
      hotelGet(context, `${base}/guest-sessions`)
    ]);
    const rooms = Array.isArray(roomsData.rooms) ? roomsData.rooms : [];
    const devices = Array.isArray(devicesData.devices) ? devicesData.devices : [];
    const requests = Array.isArray(requestsData.serviceRequests) ? requestsData.serviceRequests : [];
    const activeRequests = requests.filter((request: Record<string, any>) => !['completed', 'cancelled'].includes(String(request.status)));

    return {
      id: workspace.id,
      name: workspace.propertyName,
      type: workspace.propertyType,
      country: workspace.country,
      configuredRoomCount: rooms.length,
      registeredRoomCount: workspace.roomCount,
      activeDeviceCount: devices.filter((device: Record<string, any>) => device.status === 'active').length,
      currentGuestCount: Number(guestsData.currentGuestCount ?? guestsData.guestSessions?.length ?? 0),
      openRequestCount: Number(requestsData.openCount ?? activeRequests.length),
      totalRequestCount: Number(requestsData.totalCount ?? requests.length)
    };
  }));

  return {
    success: true,
    tool: 'hotels.overview',
    business: businessData.business ?? null,
    propertyCount: properties.length,
    currentGuestCount: properties.reduce((total, item) => total + item.currentGuestCount, 0),
    openRequestCount: properties.reduce((total, item) => total + item.openRequestCount, 0),
    properties,
    dataCoverage: {
      guests: 'Exact active guest-session counts; guest roster endpoint returns up to 300 current records per property',
      requests: 'Exact total and open counts; request detail endpoint returns the latest 200 records per property',
      finances: 'unavailable',
      orders: 'unavailable',
      publicRegistrations: 'unavailable'
    },
    financialDataNote: 'MAX Hotels does not currently expose a payment ledger, order ledger, or revenue records. Do not estimate or invent balances, revenue, expenses, or payments.'
  };
}

export async function listHotelRequests(
  context: HotelToolContext,
  options: { workspaceId?: string; status?: string; limit?: number } = {}
) {
  const allWorkspaces = await getWorkspaces(context);
  const workspaces = ensureWorkspace(allWorkspaces, options.workspaceId);
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);

  const grouped = await Promise.all(workspaces.map(async (workspace) => {
    const base = `/business/workspaces/${encodeURIComponent(workspace.id)}`;
    const [requestsData, roomsData, guestsData] = await Promise.all([
      hotelGet(context, `${base}/service-requests`),
      hotelGet(context, `${base}/rooms`),
      hotelGet(context, `${base}/guest-sessions`)
    ]);
    const requests = Array.isArray(requestsData.serviceRequests) ? requestsData.serviceRequests : [];
    const rooms = Array.isArray(roomsData.rooms) ? roomsData.rooms : [];
    const guests = Array.isArray(guestsData.guestSessions) ? guestsData.guestSessions : [];
    const roomNumbers = new Map(rooms.map((room: Record<string, any>) => [room.id, room.roomNumber]));
    const guestsByRoom = new Map(guests.map((guest: Record<string, any>) => [guest.roomId, guest.guestName]));
    return requests
      .filter((request: Record<string, any>) => !options.status || request.status === options.status)
      .map((request: Record<string, any>) => ({
        id: request.id,
        propertyName: workspace.propertyName,
        roomNumber: roomNumbers.get(request.roomId) ?? null,
        guestName: guestsByRoom.get(request.roomId) ?? null,
        requestType: request.requestType,
        details: request.details,
        status: request.status,
        createdAt: request.createdAt,
        updatedAt: request.updatedAt
      }));
  }));

  const requests = grouped.flat().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, limit);
  return { success: true, tool: 'hotels.requests.list', count: requests.length, requests };
}

export async function listHotelGuests(
  context: HotelToolContext,
  options: { workspaceId?: string; limit?: number } = {}
) {
  const allWorkspaces = await getWorkspaces(context);
  const workspaces = ensureWorkspace(allWorkspaces, options.workspaceId);
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 200);

  const grouped = await Promise.all(workspaces.map(async (workspace) => {
    const data = await hotelGet(context, `/business/workspaces/${encodeURIComponent(workspace.id)}/guest-sessions`);
    const guests = Array.isArray(data.guestSessions) ? data.guestSessions : [];
    return {
      currentGuestCount: Number(data.currentGuestCount ?? guests.length),
      guests: guests.map((guest: Record<string, any>) => ({
        ...guestSummary(guest),
        propertyName: workspace.propertyName
      }))
    };
  }));

  const guests = grouped.flatMap((item) => item.guests)
    .sort((a, b) => Date.parse(b.checkedInAt) - Date.parse(a.checkedInAt))
    .slice(0, limit);
  return {
    success: true,
    tool: 'hotels.guests.list',
    currentGuestCount: grouped.reduce((total, item) => total + item.currentGuestCount, 0),
    guestsReturned: guests.length,
    guests
  };
}
