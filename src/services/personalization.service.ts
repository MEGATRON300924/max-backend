import { env } from '../config/env.js';
import { ApiError } from '../middleware/errors.js';
import { maxAuthSpotifyRequest } from './max-auth-spotify.service.js';
import { maxAuthGoogleRequest } from './max-auth-google.service.js';

type PersonalizationSnapshot = {
  version?: number;
  user?: {
    displayName?: string | null;
    language?: string | null;
    timezone?: string | null;
    subscriptionTier?: string | null;
  };
  profile?: {
    interests?: Record<string, unknown>;
    preferences?: Record<string, unknown>;
    languages?: unknown[];
    connectedServices?: Record<string, unknown>;
    memoryMetadata?: Record<string, unknown>;
  };
  connectedAccounts?: Array<{ provider: string; connected: boolean; scopes?: string[] }>;
};

async function maxAuthRequest<T = unknown>(userId: string, path: string): Promise<T> {
  if (!env.MAX_AUTH_SERVICE_TOKEN) {
    throw new ApiError(503, 'MAX_AUTH_SERVICE_NOT_CONFIGURED', 'MAX Auth service integration is not configured');
  }

  const url = env.MAX_AUTH_INTERNAL_URL.replace(/\/$/, '') + path;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-MAX-Auth-Service-Token': env.MAX_AUTH_SERVICE_TOKEN,
      'X-MAX-User-Id': userId
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(response.status, body?.error?.code || body?.code || 'MAX_AUTH_PERSONALIZATION_ERROR', body?.error?.message || body?.message || 'MAX Auth personalization request failed');
  }
  return (body?.data ?? body) as T;
}

function connected(snapshot: PersonalizationSnapshot, provider: string) {
  return Boolean(snapshot.connectedAccounts?.some((account) => account.provider.toLowerCase() === provider.toLowerCase() && account.connected));
}

export async function getPersonalizationContext(userId: string, intent: string) {
  const snapshot = await maxAuthRequest<{ snapshot: PersonalizationSnapshot }>(userId, '/users/' + encodeURIComponent(userId) + '/personalization');
  const base = snapshot.snapshot ?? snapshot;

  const context: Record<string, unknown> = {
    profile: base.profile ?? {},
    connectedServices: (base.connectedAccounts ?? []).map((account) => ({
      provider: account.provider,
      connected: account.connected,
      scopes: account.scopes ?? []
    }))
  };

  if ((intent === 'calendar' || intent === 'google') && connected(base, 'GOOGLE')) {
    const now = new Date();
    const timeMax = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    try {
      const calendar = await maxAuthGoogleRequest<any>(userId, '/calendar/events', {
        query: {
          calendarId: 'primary',
          timeMin: now.toISOString(),
          timeMax: timeMax.toISOString(),
          maxResults: 25
        }
      });
      const events = Array.isArray(calendar?.events?.items) ? calendar.events.items : Array.isArray(calendar?.items) ? calendar.items : [];
      context.googleCalendar = {
        events: events.map((event: any) => ({
          id: event.id ?? null,
          summary: event.summary ?? null,
          start: event.start ?? null,
          end: event.end ?? null,
          status: event.status ?? null,
          location: event.location ?? null
        }))
      };
    } catch {
      context.googleCalendar = null;
    }
  }

  if (intent === 'google' && connected(base, 'GOOGLE')) {
    try {
      const subscriptions = await maxAuthGoogleRequest<any>(userId, '/youtube/subscriptions', {
        query: { maxResults: 15 }
      });
      const items = Array.isArray(subscriptions?.subscriptions?.items) ? subscriptions.subscriptions.items : Array.isArray(subscriptions?.items) ? subscriptions.items : [];
      context.youtube = {
        subscriptions: items.map((item: any) => ({
          channelId: item.snippet?.resourceId?.channelId ?? null,
          title: item.snippet?.title ?? null,
          description: item.snippet?.description ?? null
        }))
      };
    } catch {
      context.youtube = null;
    }
  }

  if (intent === 'music' && connected(base, 'SPOTIFY')) {
    const [topArtists, topTracks, recent, player] = await Promise.allSettled([
      maxAuthSpotifyRequest(userId, '/top/artists', { query: { timeRange: 'medium_term', limit: 10, offset: 0 } }),
      maxAuthSpotifyRequest(userId, '/top/tracks', { query: { timeRange: 'medium_term', limit: 10, offset: 0 } }),
      maxAuthSpotifyRequest(userId, '/recently-played', { query: { limit: 10 } }),
      maxAuthSpotifyRequest(userId, '/player')
    ]);
    context.spotify = {
      topArtists: topArtists.status === 'fulfilled' ? topArtists.value : null,
      topTracks: topTracks.status === 'fulfilled' ? topTracks.value : null,
      recentlyPlayed: recent.status === 'fulfilled' ? recent.value : null,
      player: player.status === 'fulfilled' ? player.value : null
    };
  }

  return context;
}
