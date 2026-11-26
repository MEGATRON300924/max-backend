import { env } from '../config/env.js';
import { ApiError } from '../middleware/errors.js';

type HomeRequest = {
  accessToken?: string;
  path: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
};

type HomeRecord = { id: string; name: string; linked?: boolean; [key: string]: unknown };
type DeviceRecord = { id: string; name: string; device_type?: string; status?: string; capabilities?: string[]; [key: string]: unknown };

async function requestHome<T>({ accessToken, path, method = 'GET', body }: HomeRequest): Promise<T> {
  if (!env.MAX_HOME_API_URL) throw new ApiError(503, 'HOME_NOT_CONFIGURED', 'MAX Home is not configured');
  if (!accessToken) throw new ApiError(401, 'MAX_AUTH_REQUIRED', 'Sign in with your MAX Auth account to access MAX Home.');
  if (!path.startsWith('/') || path.includes('..') || path.includes('://')) {
    throw new ApiError(400, 'HOME_INVALID_PATH', 'The requested MAX Home operation is invalid.');
  }

  const response = await fetch(env.MAX_HOME_API_URL.replace(/\/$/, '') + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + accessToken,
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(15000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = payload?.error?.code || 'HOME_PROVIDER_ERROR';
    const message = payload?.error?.message || 'MAX Home could not complete the request.';
    throw new ApiError(response.status, code, message);
  }
  return (payload?.data ?? payload) as T;
}

function extractHomes(value: any): HomeRecord[] {
  const homes = Array.isArray(value?.homes) ? value.homes : Array.isArray(value) ? value : [];
  return homes.filter((home: any) => home && typeof home.id === 'string');
}

async function listLinkedHomes(accessToken: string | undefined): Promise<HomeRecord[]> {
  // MAX Auth Connected Apps controls which household data MAX Chat may access.
  // Never fall back to the general membership list: that would expose homes
  // the user deliberately left unlinked in MAX Auth.
  const payload = await requestHome<any>({ accessToken, path: '/account-links' });
  return extractHomes(payload).filter((home) => home.linked === true);
}

async function resolveHome(accessToken: string | undefined, options: { homeId?: string; homeName?: string } = {}) {
  const homes = await listLinkedHomes(accessToken);
  if (!homes.length) throw new ApiError(403, 'HOME_NOT_LINKED', 'No MAX Home is linked to MAX Chat yet. Open MAX Auth → Connected Apps → MAX Home and link the home you want MAX Chat to access.');
  if (options.homeId) {
    const match = homes.find((home) => home.id === options.homeId);
    if (!match) throw new ApiError(404, 'HOME_NOT_FOUND', 'That MAX Home was not found on your account.');
    return match;
  }
  if (options.homeName) {
    const match = homes.find((home) => home.name.toLowerCase() === options.homeName!.toLowerCase());
    if (!match) throw new ApiError(404, 'HOME_NOT_FOUND', 'I could not find a home with that name on your account.');
    return match;
  }
  if (homes.length > 1) {
    throw new ApiError(409, 'HOME_SELECTION_REQUIRED', 'More than one MAX Home is connected: ' + homes.map((home) => home.name).join(', ') + '. Ask which home the user means before acting.');
  }
  return homes[0]!;
}

export async function listHomes(accessToken: string | undefined) {
  return { homes: await listLinkedHomes(accessToken) };
}

export async function listHomeDevices(accessToken: string | undefined, options: { homeId?: string; homeName?: string } = {}) {
  const home = await resolveHome(accessToken, options);
  const payload = await requestHome<any>({
    accessToken,
    path: '/homes/' + encodeURIComponent(home.id) + '/devices'
  });
  const devices = Array.isArray(payload?.devices) ? payload.devices : [];
  return {
    home: { id: home.id, name: home.name },
    devices: devices.map((device: DeviceRecord) => ({
      id: device.id,
      name: device.name,
      type: device.device_type ?? device.deviceType ?? 'device',
      status: device.status ?? 'unknown',
      connectionState: device.connection_state ?? device.connectionState ?? 'unknown',
      capabilities: Array.isArray(device.capabilities) ? device.capabilities : []
    }))
  };
}

export async function executeHomeAction(
  accessToken: string | undefined,
  input: { action: string; targetId?: string; parameters?: Record<string, unknown> }
) {
  const parameters = input.parameters ?? {};
  const home = await resolveHome(accessToken, {
    homeId: typeof parameters.homeId === 'string' ? parameters.homeId : undefined,
    homeName: typeof parameters.homeName === 'string' ? parameters.homeName : undefined
  });
  const action = input.action.toLowerCase().replace(/[\s.-]+/g, '_');
  const rename = /rename|set_device_name|change_device_name/.test(action);
  const powerOff = /power_off|turn_off|switch_off|device_off/.test(action);
  const powerOn = /power_on|turn_on|switch_on|device_on/.test(action);
  if (!rename && !powerOff && !powerOn) {
    throw new ApiError(400, 'HOME_ACTION_UNSUPPORTED', 'That MAX Home action is not supported yet.');
  }

  const payload = await requestHome<any>({
    accessToken,
    path: '/homes/' + encodeURIComponent(home.id) + '/devices'
  });
  const devices: DeviceRecord[] = Array.isArray(payload?.devices) ? payload.devices : [];
  const targetId = input.targetId || (typeof parameters.deviceId === 'string' ? parameters.deviceId : '');
  const targetName = String(parameters.deviceName || parameters.currentName || parameters.targetName || '');
  const device = devices.find((item) =>
    (targetId && item.id === targetId) ||
    (!targetId && targetName && item.name.toLowerCase() === targetName.toLowerCase())
  );
  if (!device) {
    throw new ApiError(404, 'HOME_DEVICE_NOT_FOUND', targetName
      ? 'I could not find a device named "' + targetName + '" in ' + home.name + '.'
      : 'I need to identify which MAX Home device you mean before I can act.');
  }

  if (rename) {
    const newName = String(parameters.newName || parameters.new_name || parameters.nameToSet || '').trim();
    if (!newName) throw new ApiError(400, 'HOME_DEVICE_NAME_REQUIRED', 'Ask what new name the user wants before renaming the device.');
    const updated = await requestHome<any>({
      accessToken,
      path: '/homes/' + encodeURIComponent(home.id) + '/devices/' + encodeURIComponent(device.id),
      method: 'PATCH',
      body: { name: newName }
    });
    return { success: true, action: 'renamed', home: home.name, device: updated?.device ?? updated };
  }

  const commandType = powerOff ? 'power.off' : 'power.on';
  const queued = await requestHome<any>({
    accessToken,
    path: '/homes/' + encodeURIComponent(home.id) + '/devices/' + encodeURIComponent(device.id) + '/commands',
    method: 'POST',
    body: { commandType }
  });
  return {
    success: true,
    action: commandType,
    home: home.name,
    device: { id: device.id, name: device.name },
    delivery: queued?.delivery ?? 'queued',
    command: queued?.command ?? null,
    note: 'The command is queued. The compatible device agent must execute and acknowledge it before MAX can say the device changed state.'
  };
}

export async function listFamilyMembers(accessToken: string | undefined, options: { homeId?: string; homeName?: string } = {}) {
  const home = await resolveHome(accessToken, options);
  const payload = await requestHome<any>({
    accessToken,
    path: '/family/homes/' + encodeURIComponent(home.id)
  });
  const members = Array.isArray(payload?.members) ? payload.members : [];
  return {
    home: { id: home.id, name: home.name },
    members: members.map((member: any) => ({
      userId: typeof member.user_id === 'string' ? member.user_id : '',
      displayName: typeof member.displayName === 'string' && member.displayName.trim()
        ? member.displayName.trim()
        : typeof member.username === 'string' && member.username.trim() ? member.username.trim() : 'Family member',
      username: typeof member.username === 'string' ? member.username : null,
      role: typeof member.role === 'string' ? member.role : 'member',
      familyRelationship: typeof member.family_relationship === 'string' ? member.family_relationship : 'other'
    })).filter((member: { userId: string }) => member.userId)
  };
}

export async function sendFamilyMessage(
  accessToken: string | undefined,
  input: { recipientUserId: string; message: string; title?: string; homeId?: string; homeName?: string; source?: 'max_chat' | 'max_voice' }
) {
  const roster = await listFamilyMembers(accessToken, { homeId: input.homeId, homeName: input.homeName });
  const recipient = roster.members.find((member) => member.userId === input.recipientUserId);
  if (!recipient) {
    throw new ApiError(404, 'FAMILY_RECIPIENT_NOT_FOUND', 'That recipient is not a member of the selected linked MAX Home.');
  }
  const payload = await requestHome<any>({
    accessToken,
    path: '/homes/' + encodeURIComponent(roster.home.id) + '/family-notifications',
    method: 'POST',
    body: {
      recipientUserId: recipient.userId,
      title: input.title?.trim() || 'Family message',
      message: input.message,
      source: input.source || 'max_chat'
    }
  });
  return {
    success: true,
    home: roster.home.name,
    recipient: { userId: recipient.userId, displayName: recipient.displayName },
    notification: payload?.notification ?? payload
  };
}

export function homeStatus() {
  return {
    configured: Boolean(env.MAX_HOME_API_URL),
    status: env.MAX_HOME_API_URL ? 'connected' : 'not_configured'
  } as const;
}
