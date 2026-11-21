import type { CalendarData, CalendarEvent, CalendarSourceStatus, Settings } from '../../../shared/contracts.js';
import { DAY_MS, sgtStartOfDay } from '../../util/time.js';
import { ProviderError, type AdapterFactory, type HttpClient } from '../types.js';
import { normalizeEvent, parseEventsPage, sortEvents } from './normalize.js';
import { googleOAuthEnv, postTokenRequest, REAUTH_MESSAGE, type GoogleTokens } from './token.js';

const ENV_REQUIREMENT = 'Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI in the server environment';
const CONNECT_REQUIREMENT = 'Connect Google Calendar in Settings';
const EXPIRY_SKEW_MS = 60_000;
const MAX_PAGES = 10;
const WINDOW_DAYS = 8; // today plus the next seven days (SGT)

const toSafe = (e: unknown) => (e instanceof ProviderError ? { code: e.code, message: e.safeMessage } : { code: 'internal' as const, message: 'Something went wrong while reading this calendar' });

export const createLiveAdapter: AdapterFactory<'google'> = ({ env, now, http, tokens }) => {
  let refreshing: Promise<string> | null = null;

  async function readTokens(): Promise<GoogleTokens | null> {
    const t = (await tokens.get('google')) as GoogleTokens | null;
    return t && typeof t.refresh_token === 'string' && t.refresh_token ? t : null;
  }

  async function refreshAccessToken(): Promise<string> {
    const oauth = googleOAuthEnv(env);
    if (!oauth) throw new ProviderError('needs_setup', ENV_REQUIREMENT);
    const stored = await readTokens();
    if (!stored?.refresh_token) throw new ProviderError('needs_setup', CONNECT_REQUIREMENT);
    const res = await postTokenRequest(http, {
      grant_type: 'refresh_token',
      refresh_token: stored.refresh_token,
      client_id: oauth.clientId,
      client_secret: oauth.clientSecret,
    });
    await tokens.set('google', {
      ...stored,
      refresh_token: res.refresh_token ?? stored.refresh_token,
      access_token: res.access_token,
      expiry_date: now().getTime() + res.expires_in * 1000,
      ...(res.scope ? { scope: res.scope } : {}),
    });
    return res.access_token;
  }

  /** Single-flight so concurrent callers share one token request. */
  function accessToken(force: boolean): Promise<string> {
    return (async () => {
      if (!force) {
        const t = await readTokens();
        if (t?.access_token && typeof t.expiry_date === 'number' && t.expiry_date - EXPIRY_SKEW_MS > now().getTime()) return t.access_token;
      }
      refreshing ??= refreshAccessToken().finally(() => {
        refreshing = null;
      });
      return refreshing;
    })();
  }

  async function fetchCalendar(
    calendarId: string,
    window: { min: string; max: string },
    ctx: { token: string; refreshed: boolean },
    signal: AbortSignal,
  ): Promise<{ events: CalendarEvent[]; complete: boolean }> {
    const events: CalendarEvent[] = [];
    let pageToken: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const q = new URLSearchParams({
        timeMin: window.min,
        timeMax: window.max,
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '250',
        showDeleted: 'false',
      });
      if (pageToken) q.set('pageToken', pageToken);
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${q.toString()}`;
      const get = (): Promise<Awaited<ReturnType<HttpClient['request']>>> =>
        http.request(url, { headers: { authorization: `Bearer ${ctx.token}` }, acceptStatuses: [400, 401, 403, 404], signal });
      let res = await get();
      if (res.status === 401) {
        if (ctx.refreshed) throw new ProviderError('reauth_required', REAUTH_MESSAGE);
        ctx.refreshed = true;
        ctx.token = await accessToken(true);
        res = await get();
        if (res.status === 401) throw new ProviderError('reauth_required', REAUTH_MESSAGE);
      }
      if (res.status !== 200) {
        let reason: string | undefined;
        try {
          const b = (await res.json()) as { error?: { errors?: { reason?: string }[] } };
          reason = b?.error?.errors?.[0]?.reason;
        } catch {
          /* ignore body */
        }
        if (res.status === 403 && (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded')) {
          throw new ProviderError('rate_limited', 'Google Calendar is rate limiting requests; try again later');
        }
        throw new ProviderError('upstream', `Google Calendar could not read this calendar (HTTP ${res.status}) — check the calendar ID in Settings`);
      }
      const parsed = parseEventsPage(await res.json());
      for (const raw of parsed.items) {
        const ev = normalizeEvent(calendarId, raw);
        if (ev) events.push(ev);
      }
      pageToken = parsed.nextPageToken;
      if (!pageToken) return { events, complete: true };
    }
    return { events, complete: false };
  }

  return {
    id: 'google',
    mode: 'live',
    async setupStatus() {
      if (!googleOAuthEnv(env)) return { connection: 'needs_setup', requirement: ENV_REQUIREMENT };
      if (!(await readTokens())) return { connection: 'needs_setup', requirement: CONNECT_REQUIREMENT };
      return { connection: 'connected', requirement: null };
    },
    configKey: (settings: Settings) => settings.calendar.calendarIds.join(','),
    async fetch(settings, signal) {
      const current = now();
      const start = sgtStartOfDay(current);
      const end = new Date(start.getTime() + WINDOW_DAYS * DAY_MS);
      const window = { min: start.toISOString(), max: end.toISOString() };
      const ctx = { token: await accessToken(false), refreshed: false };

      const events: CalendarEvent[] = [];
      const calendars: CalendarSourceStatus[] = [];
      let complete = true;
      let firstError: unknown = null;
      for (const calendarId of settings.calendar.calendarIds) {
        try {
          const r = await fetchCalendar(calendarId, window, ctx, signal);
          events.push(...r.events);
          if (!r.complete) complete = false;
          calendars.push({ calendarId, ok: true, error: null });
        } catch (e) {
          if (e instanceof ProviderError && (e.code === 'reauth_required' || e.code === 'rate_limited')) throw e;
          firstError ??= e;
          complete = false;
          calendars.push({ calendarId, ok: false, error: toSafe(e) });
        }
      }
      if (calendars.every((c) => !c.ok)) throw firstError;

      const data: CalendarData = { windowStart: window.min, windowEnd: window.max, events: sortEvents(events), calendars };
      return {
        data,
        sourceUpdatedAt: current.toISOString(),
        validUntil: null,
        coverage: { start: window.min, end: window.max, complete },
        detailUrl: 'https://calendar.google.com/',
      };
    },
  };
};
