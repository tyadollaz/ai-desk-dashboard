// Synthetic, shaped per Garmin Connect Personal API Swagger (docs/garmin-personal-api.pdf) and observed response structure 2026-11-21.
// Token endpoint returns the bare access token as text/plain (a JWT). Activity search items use
// startTimeGMT "yyyy-MM-dd HH:mm:ss" (UTC), distance in metres, duration in seconds.
import { vi } from 'vitest';
import { ProviderError, type HttpClient, type HttpResponse, type TokenStore } from '../../../server/providers/types.js';

export const jwt = (expSec: number, tag = 'a') =>
  `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ exp: expSec, jti: tag })).toString('base64url')}.sig_${tag}_xxxxxxxxxxxx`;

export const activityItem = (id: number, gmt: string, over: Record<string, unknown> = {}) => ({
  activityId: id,
  activityName: 'Synthetic run',
  startTimeLocal: gmt,
  startTimeGMT: gmt,
  activityType: { typeId: 1, typeKey: 'running', parentTypeId: 17 },
  distance: 5000.5,
  duration: 1800.25,
  elapsedDuration: 1805,
  movingDuration: 1799,
  ...over,
});

export const stepsRow = (date: string, totalSteps: number | null) => ({ calendarDate: date, totalSteps, totalDistance: 1000, stepGoal: 10000 });
export const sleepRow = (date: string, sleepTimeSeconds: number | null, end: number | null = null) => ({
  id: 1, userProfilePK: 1, calendarDate: date, sleepTimeSeconds, napTimeSeconds: 0, sleepEndTimestampGMT: end,
});
export const hrBody = (date: string, restingHeartRate: number | null) => ({ userProfilePK: 1, calendarDate: date, restingHeartRate, heartRateValues: null });

export type Route = (url: URL, init: Parameters<HttpClient['request']>[1]) => { status?: number; body?: unknown; throws?: ProviderError } | undefined;

export function res(status: number, body: unknown, text?: string): HttpResponse {
  return { status, headers: new Headers(), json: async () => body, text: async () => text ?? (typeof body === 'string' ? body : JSON.stringify(body)) };
}

/** Fake HttpClient mirroring the core client: only statuses in acceptStatuses (or 2xx) are returned. */
export function fakeHttp(route: Route) {
  const calls: { url: URL; init: Parameters<HttpClient['request']>[1] }[] = [];
  const request = vi.fn(async (raw: string, init: Parameters<HttpClient['request']>[1]) => {
    const url = new URL(raw);
    calls.push({ url, init });
    const r = route(url, init);
    if (!r) throw new ProviderError('upstream', 'unrouted ' + url.pathname);
    if (r.throws) throw r.throws;
    const status = r.status ?? 200;
    if (status >= 300 && !init?.acceptStatuses?.includes(status)) throw new ProviderError(status === 401 || status === 403 ? 'auth_failed' : 'upstream', 'x');
    return res(status, r.body);
  });
  return { http: { request } as unknown as HttpClient, request, calls };
}

export function memoryTokens(initial: Record<string, unknown> | null = null) {
  let blob = initial;
  const store: TokenStore = {
    get: async () => blob,
    set: async (_p, v) => { blob = v; },
    clear: async () => { blob = null; },
  };
  return { store, peek: () => blob };
}
