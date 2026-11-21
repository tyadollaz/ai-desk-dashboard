// Garmin live adapter, built only from Garmin's official Connect Personal API Swagger export
// (docs/garmin-personal-api.pdf) plus the observed token response (see notes below).
//
// Token: POST /personalapitoken-service/personal-api/personal-api-key/token with
// `Authorization: ApiKey <key>`, no body. Observed 2026-11-21: HTTP 200, content-type text/plain,
// body is the bare access token (a JWT, ~1.1 KB) -- NOT JSON. Its `exp` claim is ~24 h ahead.
// Data calls use `Authorization: Bearer <token>`. No refresh tokens: request a new one.
//
// Activities are held in memory per fetch (the garmin_activities table is not used): a fetch
// already covers the whole Monday->now window, so de-duplication by activityId is done in
// normalizeGarmin and no cross-fetch state is needed.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AdapterFactory, HttpClient, HttpResponse } from '../types.js';
import { ProviderError } from '../types.js';
import { DAY_MS, sgtDate } from '../../util/time.js';
import { normalizeGarmin, sgtWeekStart, type GarminRawActivity, type GarminRawDaily, type GarminRawSnapshot } from './normalize.js';

export const GARMIN_NO_KEY = 'Set GARMIN_PERSONAL_API_KEY (Garmin Connect → Settings → Personal API token)';
export const GARMIN_KEY_REJECTED =
  'Garmin personal API key was rejected or expired — create a new key in Garmin Connect and update GARMIN_PERSONAL_API_KEY';

const BASE = 'https://personal.connectapi.garmin.com';
const TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';
const DETAIL_URL = 'https://connect.garmin.com/';
const PAGE_LIMIT = 99; // Swagger default for `limit` on the activity search.
const MAX_PAGES = 5;
const TOKEN_MIN_LEFT_MS = 5 * 60_000;
const TOKEN_DEFAULT_TTL_MS = 24 * 3_600_000 - 60_000; // docs/FAQ: valid 24 h.

// Activity search item (SummarizedActivityDTO): distance in metres, duration in seconds,
// startTimeGMT "yyyy-MM-dd HH:mm:ss" in UTC without offset, activityType.typeKey e.g. "running".
const ActivityItem = z.object({
  activityId: z.number(),
  startTimeGMT: z.string(),
  activityType: z.object({ typeKey: z.string().nullish() }).nullish(),
  distance: z.number().nullish(),
  duration: z.number().nullish(),
});
const ActivityList = z.array(z.unknown());
// StepsDailyStatDTO.
const StepsList = z.array(z.object({ calendarDate: z.string(), totalSteps: z.number().nullish() }));
// Daily sleep summary: sleepTimeSeconds = measured sleep excluding naps (seconds);
// sleepEndTimestampGMT is epoch ms (observed number).
const SleepList = z.array(
  z.object({ calendarDate: z.string(), sleepTimeSeconds: z.number().nullish(), sleepEndTimestampGMT: z.number().nullish() }),
);
// DailyHeartRateDTO.
const HeartRate = z.object({ calendarDate: z.string().nullish(), restingHeartRate: z.number().nullish() });

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
  keyId: string; // fingerprint of the API key the token was issued for
}

const fingerprint = (key: string) => createHash('sha256').update(key).digest('hex').slice(0, 16);

function parseOrMalformed<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new ProviderError('malformed', 'Garmin returned data in an unexpected format');
  return r.data;
}

/** "2026-11-14 00:47:49" (UTC, per Swagger) -> ISO instant, or null if unparseable. */
function gmtToIso(s: string): string | null {
  const t = Date.parse(s.replace(' ', 'T') + 'Z');
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function jwtExp(token: string): number | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const exp = (JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { exp?: unknown }).exp;
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

async function requestToken(http: HttpClient, key: string, now: Date, signal: AbortSignal): Promise<CachedToken> {
  const res = await http.request(BASE + TOKEN_PATH, {
    method: 'POST',
    headers: { Authorization: `ApiKey ${key}` },
    acceptStatuses: [401, 403],
    signal,
  });
  if (res.status === 401 || res.status === 403) throw new ProviderError('reauth_required', GARMIN_KEY_REJECTED);
  let token = (await res.text()).trim();
  if (token.startsWith('{')) {
    // Defensive: tolerate a JSON envelope. Observed live response is the bare token.
    try {
      const j = JSON.parse(token) as Record<string, unknown>;
      const v = j.access_token ?? j.accessToken ?? j.token;
      token = typeof v === 'string' ? v : '';
    } catch {
      token = '';
    }
  }
  if (!/^[A-Za-z0-9._~+/=-]{20,}$/.test(token)) throw new ProviderError('malformed', 'Garmin returned an unreadable token response');
  const exp = jwtExp(token);
  const expiresAt = exp && exp > now.getTime() ? exp : now.getTime() + TOKEN_DEFAULT_TTL_MS;
  return { accessToken: token, expiresAt, keyId: fingerprint(key) };
}

export const createLiveAdapter: AdapterFactory<'garmin'> = ({ env, now, http, tokens }) => {
  const apiKey = () => env.GARMIN_PERSONAL_API_KEY;

  async function loadToken(key: string, force: boolean, signal: AbortSignal): Promise<CachedToken> {
    if (!force) {
      const c = (await tokens.get('garmin')) as Partial<CachedToken> | null;
      if (
        c && typeof c.accessToken === 'string' && typeof c.expiresAt === 'number' && c.keyId === fingerprint(key) &&
        c.expiresAt - now().getTime() > TOKEN_MIN_LEFT_MS
      ) {
        return c as CachedToken;
      }
    }
    const t = await requestToken(http, key, now(), signal);
    await tokens.set('garmin', { ...t });
    return t;
  }

  return {
    id: 'garmin',
    mode: 'live',
    async setupStatus() {
      if (!apiKey()) return { connection: 'needs_setup', requirement: GARMIN_NO_KEY };
      return { connection: 'connected', requirement: null };
    },
    configKey: () => 'garmin',
    async fetch(_settings, signal) {
      const key = apiKey();
      if (!key) throw new ProviderError('needs_setup', GARMIN_NO_KEY);
      const at = now();
      let token = await loadToken(key, false, signal);
      let retokened = false;

      /** GET with Bearer; one re-token + retry on 401 across the whole fetch, then auth error. */
      async function getJson(path: string): Promise<unknown> {
        for (;;) {
          const res: HttpResponse = await http.request(BASE + path, {
            headers: { Authorization: `Bearer ${token.accessToken}`, Accept: 'application/json' },
            acceptStatuses: [401, 403],
            signal,
          });
          if (res.status === 401 && !retokened) {
            retokened = true;
            token = await loadToken(key as string, true, signal);
            continue;
          }
          if (res.status === 401) throw new ProviderError('auth_failed', GARMIN_KEY_REJECTED);
          if (res.status === 403) throw new ProviderError('auth_failed', 'Garmin did not authorize this request for the personal API key');
          return res.json();
        }
      }

      const errors: ProviderError[] = [];
      /** Per-metric isolation: other failures null that metric; rate limits and auth problems abort. */
      async function metric<T>(fn: () => Promise<T>): Promise<T | null> {
        try {
          return await fn();
        } catch (e) {
          if (e instanceof ProviderError) {
            if (e.code === 'rate_limited' || e.code === 'auth_failed' || e.code === 'reauth_required' || e.code === 'needs_setup') throw e;
            errors.push(e);
            return null;
          }
          throw e;
        }
      }

      const today = sgtDate(at);
      const yesterday = sgtDate(new Date(at.getTime() - DAY_MS));
      const weekStart = sgtWeekStart(at);
      const weekStartDate = sgtDate(weekStart);

      const activities = await metric(async () => {
        const out: GarminRawActivity[] = [];
        let truncated = false;
        for (let page = 0; page < MAX_PAGES; page++) {
          const q = new URLSearchParams({
            start: String(page * PAGE_LIMIT),
            limit: String(PAGE_LIMIT),
            sortOrder: 'desc',
            startDate: weekStartDate,
            endDate: today,
          });
          const list = parseOrMalformed(ActivityList, await getJson(`/activitylist-service/activities/search/activities?${q}`));
          for (const raw of list) out.push(...toActivity(raw));
          if (list.length < PAGE_LIMIT) break;
          if (page === MAX_PAGES - 1) truncated = true;
        }
        if (out.length === 0) {
          // Nothing this week: find the most recent activity ever (first page, newest first, limit 1).
          const q = new URLSearchParams({ start: '0', limit: '1', sortOrder: 'desc' });
          const list = parseOrMalformed(ActivityList, await getJson(`/activitylist-service/activities/search/activities?${q}`));
          for (const raw of list) out.push(...toActivity(raw));
          return { list: out, windowStart: weekStart.toISOString() };
        }
        let windowStart = weekStart.toISOString();
        if (truncated) {
          // Newest-first pages were cut off: we only know activities back to the oldest one fetched.
          const oldest = Math.min(...out.map((a) => Date.parse(a.startTime)));
          windowStart = new Date(oldest).toISOString();
        }
        return { list: out, windowStart };
      });

      const stepsRows = await metric(async () =>
        parseOrMalformed(StepsList, await getJson(`/usersummary-service/stats/steps/daily/${today}/${today}`)),
      );
      const sleepRows = await metric(async () => {
        const q = new URLSearchParams({ startDate: yesterday, endDate: today });
        return parseOrMalformed(SleepList, await getJson(`/sleep-service/sleep/dailySleepSummariesByDate?${q}`));
      });
      const hrByDate = new Map<string, number | null>();
      let hrOk = false;
      for (const d of [today, yesterday]) {
        const hr = await metric(async () =>
          parseOrMalformed(HeartRate, await getJson(`/wellness-service/wellness/dailyHeartRate?date=${d}`)),
        );
        if (!hr) continue;
        hrOk = true;
        const v = hr.restingHeartRate;
        hrByDate.set(hr.calendarDate ?? d, typeof v === 'number' && v > 0 ? v : null);
        if (typeof v === 'number' && v > 0) break; // today has a value: no need for yesterday
      }

      if (!activities && !stepsRows && !sleepRows && !hrOk) {
        throw errors[0] ?? new ProviderError('upstream', 'Garmin data could not be retrieved');
      }

      const daily = new Map<string, GarminRawDaily>();
      const row = (date: string) => {
        let r = daily.get(date);
        if (!r) daily.set(date, (r = { date }));
        return r;
      };
      const todaySteps = stepsRows?.find((s) => s.calendarDate === today);
      if (todaySteps) row(today).steps = todaySteps.totalSteps ?? null;
      let sleepEnd: number | null = null;
      for (const s of sleepRows ?? []) {
        // Swagger: sleepTimeSeconds is measured sleep in seconds. 0/null means no measured sleep => null.
        const sec = typeof s.sleepTimeSeconds === 'number' && s.sleepTimeSeconds > 0 ? s.sleepTimeSeconds : null;
        row(s.calendarDate).sleepSec = sec;
        if (sec !== null && typeof s.sleepEndTimestampGMT === 'number') sleepEnd = Math.max(sleepEnd ?? 0, s.sleepEndTimestampGMT);
      }
      for (const [date, v] of hrByDate) row(date).restingHr = v;

      const snapshot: GarminRawSnapshot = {
        activities: activities?.list ?? [],
        // A failed/unavailable activity fetch gets an empty, non-covering window => coverage incomplete.
        activityWindow: activities
          ? { start: activities.windowStart, end: at.toISOString() }
          : { start: at.toISOString(), end: at.toISOString() },
        daily: [...daily.values()],
      };
      const data = normalizeGarmin(snapshot, at);
      // Activity fetch failed entirely: the weekly distance is unknown, not 0.
      if (!activities) data.weekRunningDistanceM = null;

      // Source timestamp = newest underlying Garmin data we saw (activity start / sleep end), NOT the
      // time of this successful fetch: a fetch succeeding does not mean the watch synced today.
      const stamps = [data.latestActivity ? Date.parse(data.latestActivity.startTime ?? '') : NaN, sleepEnd ?? NaN].filter((n) => Number.isFinite(n));
      const sourceUpdatedAt = stamps.length ? new Date(Math.max(...stamps)).toISOString() : null;
      return { data, sourceUpdatedAt, validUntil: null, coverage: data.weekCoverage, detailUrl: DETAIL_URL };
    },
  };
};

function toActivity(raw: unknown): GarminRawActivity[] {
  const r = ActivityItem.safeParse(raw);
  if (!r.success) throw new ProviderError('malformed', 'Garmin returned data in an unexpected format');
  const a = r.data;
  const startTime = gmtToIso(a.startTimeGMT);
  if (!startTime) throw new ProviderError('malformed', 'Garmin returned data in an unexpected format');
  return [
    {
      id: String(a.activityId),
      type: a.activityType?.typeKey ?? null,
      startTime,
      durationSec: a.duration ?? null, // seconds per Swagger
      distanceM: a.distance ?? null, // metres per Swagger
      sourceUrl: null, // no activity web URL is documented in the Swagger
    },
  ];
}
