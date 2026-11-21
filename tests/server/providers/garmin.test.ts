import { describe, expect, it } from 'vitest';
import { ProviderError } from '../../../server/providers/types.js';
import { DEFAULT_SETTINGS } from '../../../shared/contracts.js';
import { createLiveAdapter, GARMIN_KEY_REJECTED, GARMIN_NO_KEY } from '../../../server/providers/garmin/live.js';
import { normalizeGarmin, type GarminRawSnapshot } from '../../../server/providers/garmin/normalize.js';
import { run } from '../../fixtures/garmin/snapshots.js';
import { activityItem, fakeHttp, hrBody, jwt, memoryTokens, sleepRow, stepsRow, type Route } from '../../fixtures/garmin/api.js';

// Sat 2026-11-21 12:00 SGT. Monday = 2026-11-16 00:00 SGT = 2026-11-15T16:00Z.
const NOW = new Date('2026-11-21T04:00:00Z');
const MON = '2026-11-15T16:00:00.000Z';
const fullWindow = { start: '2026-11-01T00:00:00Z', end: '2026-11-21T04:00:00Z' };
const snap = (over: Partial<GarminRawSnapshot>): GarminRawSnapshot => ({ activities: [], activityWindow: fullWindow, daily: [], ...over });

describe('normalizeGarmin', () => {
  it('missing health values stay null, never 0', () => {
    const d = normalizeGarmin(snap({ daily: [{ date: '2026-11-21', steps: null }, { date: '2026-11-20' }] }), NOW);
    expect(d.stepsToday).toEqual({ date: '2026-11-21', value: null });
    expect(d.sleepDurationSec).toBeNull();
    expect(d.restingHeartRate).toBeNull();
    expect(normalizeGarmin(snap({}), NOW).stepsToday).toBeNull();
  });

  it('uses most recent non-null sleep/resting HR with their dates', () => {
    const d = normalizeGarmin(snap({ daily: [
      { date: '2026-11-19', sleepSec: 25000, restingHr: 50 },
      { date: '2026-11-20', sleepSec: 27000, restingHr: null },
      { date: '2026-11-21', steps: 4000, sleepSec: null },
    ] }), NOW);
    expect(d.sleepDurationSec).toEqual({ date: '2026-11-20', value: 27000 });
    expect(d.restingHeartRate).toEqual({ date: '2026-11-19', value: 50 });
    expect(d.stepsToday).toEqual({ date: '2026-11-21', value: 4000 });
  });

  it('counts duplicate ids once; later updatedAt wins', () => {
    const d = normalizeGarmin(snap({ activities: [
      run('a1', '2026-11-17T00:00:00Z', 5000, { updatedAt: '2026-11-17T02:00:00Z' }),
      run('a1', '2026-11-17T00:00:00Z', 5200, { updatedAt: '2026-11-17T03:00:00Z' }),
      run('a1', '2026-11-17T00:00:00Z', 4000, { updatedAt: '2026-11-17T01:00:00Z' }),
    ] }), NOW);
    expect(d.weekRunningDistanceM).toBe(5200);
    expect(d.latestActivity?.distanceM).toBe(5200);
  });

  it('Monday boundary in Singapore time', () => {
    const d = normalizeGarmin(snap({ activities: [
      run('sun', '2026-11-15T15:30:00Z', 10000), // Sun 23:30 SGT: excluded
      run('utcmon', '2026-11-15T15:59:59Z', 3000), // Mon in UTC? no: Sun 23:59:59 SGT, excluded
      run('mon', '2026-11-15T16:10:00Z', 5000), // Mon 00:10 SGT: included
      run('mon0', MON, 1000), // exactly Monday 00:00 SGT: included
      run('walk', '2026-11-17T00:00:00Z', 9000, { type: 'walking' }),
    ] }), NOW);
    expect(d.weekRunningDistanceM).toBe(6000);
    expect(d.weekCoverage).toEqual({ start: MON, end: NOW.toISOString(), complete: true });
  });

  it('UTC-Monday-but-SGT-Sunday edge: now is Sunday SGT', () => {
    const now = new Date('2026-11-22T15:00:00Z'); // Sun 23:00 SGT; UTC is Sun too
    const d = normalizeGarmin(snap({ activityWindow: { start: '2026-11-01T00:00:00Z', end: now.toISOString() }, activities: [run('x', '2026-11-16T00:00:00Z', 4000)] }), now);
    expect(d.weekCoverage?.start).toBe(MON);
    expect(d.weekRunningDistanceM).toBe(4000);
    // 2026-11-23T00:00Z is Monday in UTC but still Monday 08:00 SGT; use Sun-SGT instant that is Mon-UTC? impossible (SGT ahead). Check reverse:
    const sunSgt = new Date('2026-11-22T20:00:00Z'); // Mon 04:00 SGT, UTC Sunday => new SGT week
    const d2 = normalizeGarmin(snap({ activityWindow: { start: '2026-11-01T00:00:00Z', end: sunSgt.toISOString() }, activities: [run('x', '2026-11-16T00:00:00Z', 4000)] }), sunSgt);
    expect(d2.weekCoverage?.start).toBe('2026-11-22T16:00:00.000Z');
    expect(d2.weekRunningDistanceM).toBe(0);
  });

  it('incomplete window => complete=false with partial sum', () => {
    const d = normalizeGarmin(snap({ activityWindow: { start: '2026-11-17T00:00:00Z', end: NOW.toISOString() }, activities: [run('a', '2026-11-18T00:00:00Z', 5000)] }), NOW);
    expect(d.weekRunningDistanceM).toBe(5000);
    expect(d.weekCoverage?.complete).toBe(false);
    const stale = normalizeGarmin(snap({ activityWindow: { start: fullWindow.start, end: '2026-11-20T00:00:00Z' } }), NOW);
    expect(stale.weekCoverage?.complete).toBe(false);
  });

  it('empty complete window is a real 0; null run distance skipped and marks incomplete', () => {
    expect(normalizeGarmin(snap({}), NOW)).toMatchObject({ weekRunningDistanceM: 0, latestActivity: null, weekCoverage: { complete: true } });
    const d = normalizeGarmin(snap({ activities: [run('a', '2026-11-18T00:00:00Z', 5000), run('b', '2026-11-19T00:00:00Z', null)] }), NOW);
    expect(d.weekRunningDistanceM).toBe(5000);
    expect(d.weekCoverage?.complete).toBe(false);
    expect(d.latestActivity?.id).toBe('b');
  });
});

const NOW_SEC = NOW.getTime() / 1000;
const KEY = 'test-key';
const sig = new AbortController().signal;
const T1 = jwt(NOW_SEC + 86400, 't1');
const T2 = jwt(NOW_SEC + 86400, 't2');

interface Opts { tokens?: string[]; acts?: (u: URL) => unknown[]; steps?: unknown; sleep?: unknown; hr?: (date: string) => unknown; override?: Route }
function setup(o: Opts = {}, cached: Record<string, unknown> | null = null) {
  const toks = [...(o.tokens ?? [T1, T2])];
  const route: Route = (url, init) => {
    const o2 = o.override?.(url, init);
    if (o2) return o2;
    const p = url.pathname;
    if (p.endsWith('/personal-api-key/token')) return { body: toks.shift() ?? T2 };
    if (p.endsWith('/activities/search/activities')) return { body: o.acts ? o.acts(url) : [] };
    if (p.includes('/stats/steps/daily/')) return { body: o.steps ?? [stepsRow('2026-11-21', 4321)] };
    if (p.endsWith('/dailySleepSummariesByDate')) return { body: o.sleep ?? [sleepRow('2026-11-21', 27000, Date.parse('2026-11-20T23:00:00Z'))] };
    if (p.endsWith('/dailyHeartRate')) return { body: (o.hr ?? ((d: string) => hrBody(d, 55)))(url.searchParams.get('date')!) };
    return undefined;
  };
  const f = fakeHttp(route);
  const t = memoryTokens(cached);
  const adapter = createLiveAdapter({ env: { GARMIN_PERSONAL_API_KEY: KEY }, now: () => NOW, http: f.http, tokens: t.store });
  return { adapter, ...f, tokens: t, fetch: () => adapter.fetch(DEFAULT_SETTINGS, sig) };
}
const tokenCalls = (calls: { url: URL }[]) => calls.filter((c) => c.url.pathname.endsWith('/personal-api-key/token')).length;

describe('garmin live adapter', () => {
  it('needs_setup without key and makes no calls', async () => {
    const f = fakeHttp(() => undefined);
    const adapter = createLiveAdapter({ env: {}, now: () => NOW, http: f.http, tokens: memoryTokens().store });
    expect(await adapter.setupStatus(DEFAULT_SETTINGS)).toEqual({ connection: 'needs_setup', requirement: GARMIN_NO_KEY });
    expect(GARMIN_NO_KEY).toBe('Set GARMIN_PERSONAL_API_KEY (Garmin Connect → Settings → Personal API token)');
    await expect(adapter.fetch(DEFAULT_SETTINGS, sig)).rejects.toMatchObject({ code: 'needs_setup' });
    expect(f.request).not.toHaveBeenCalled();
  });

  it('connected with key; fetches token with ApiKey header then Bearer on data calls', async () => {
    const s = setup({ acts: () => [activityItem(1, '2026-11-18 00:30:00', { distance: 8000, duration: 2400 })] });
    expect(await s.adapter.setupStatus(DEFAULT_SETTINGS)).toEqual({ connection: 'connected', requirement: null });
    const r = await s.fetch();
    const tokenCall = s.calls[0]!;
    expect(tokenCall.init?.method).toBe('POST');
    expect(tokenCall.init?.headers?.Authorization).toBe(`ApiKey ${KEY}`);
    expect(tokenCall.init?.body).toBeUndefined();
    for (const c of s.calls.slice(1)) expect(c.init?.headers?.Authorization).toBe(`Bearer ${T1}`);
    expect(r.data.latestActivity).toEqual({ id: '1', type: 'running', startTime: '2026-11-18T00:30:00.000Z', durationSec: 2400, distanceM: 8000, sourceUrl: null });
    expect(r.data.weekRunningDistanceM).toBe(8000);
    expect(r.data.stepsToday).toEqual({ date: '2026-11-21', value: 4321 });
    expect(r.data.sleepDurationSec).toEqual({ date: '2026-11-21', value: 27000 });
    expect(r.data.restingHeartRate).toEqual({ date: '2026-11-21', value: 55 });
    expect(r.coverage).toEqual({ start: MON, end: NOW.toISOString(), complete: true });
    expect(r.sourceUpdatedAt).toBe('2026-11-20T23:00:00.000Z'); // newest data time, not fetch time
    expect(r.detailUrl).toBe('https://connect.garmin.com/');
    // activity search uses documented params; Monday SGT date as startDate
    const q = s.calls.find((c) => c.url.pathname.endsWith('/activities/search/activities'))!.url.searchParams;
    expect(Object.fromEntries(q)).toMatchObject({ start: '0', limit: '99', sortOrder: 'desc', startDate: '2026-11-16', endDate: '2026-11-21' });
    expect(JSON.stringify(r)).not.toContain(T1);
  });

  it('caches the token in the token store and reuses it on the next fetch', async () => {
    const s = setup();
    await s.fetch();
    await s.fetch();
    expect(tokenCalls(s.calls)).toBe(1);
    expect(s.tokens.peek()).toMatchObject({ accessToken: T1 });
  });

  it('requests a new token when the cached one has <5 min left', async () => {
    const s = setup({}, { accessToken: 'old'.repeat(10), expiresAt: NOW.getTime() + 4 * 60_000, keyId: 'x' });
    await s.fetch();
    expect(tokenCalls(s.calls)).toBe(1);
    const s2 = setup({}, null);
    await s2.fetch();
    s2.tokens.peek();
    // expiry honoured from the JWT exp claim
    expect((s2.tokens.peek() as { expiresAt: number }).expiresAt).toBe((NOW_SEC + 86400) * 1000);
  });

  it('a token cached for a different API key is not reused', async () => {
    const s = setup({}, { accessToken: 'cached-token-aaaaaaaaaaaa', expiresAt: NOW.getTime() + 3_600_000, keyId: 'someone-else' });
    await s.fetch();
    expect(tokenCalls(s.calls)).toBe(1);
  });

  it('data 401 => one re-token and retry, then succeeds', async () => {
    let first = true;
    const s = setup({
      override: (url, init) => {
        if (url.pathname.endsWith('/activities/search/activities') && init?.headers?.Authorization === `Bearer ${T1}` && first) { first = false; return { status: 401 }; }
        return undefined;
      },
    });
    const r = await s.fetch();
    expect(tokenCalls(s.calls)).toBe(2);
    expect(r.data.stepsToday?.value).toBe(4321);
    expect(s.tokens.peek()).toMatchObject({ accessToken: T2 });
  });

  it('data 401 again after re-token => auth_failed, no loop', async () => {
    const s = setup({ override: (url) => (url.pathname.includes('/activitylist-service') ? { status: 401 } : undefined) });
    await expect(s.fetch()).rejects.toMatchObject({ code: 'auth_failed', safeMessage: GARMIN_KEY_REJECTED });
    expect(tokenCalls(s.calls)).toBe(2);
    expect(s.calls.length).toBeLessThanOrEqual(4);
  });

  it('token endpoint 401/403 => reauth_required with the exact message, no data calls', async () => {
    for (const status of [401, 403]) {
      const s = setup({ override: (url) => (url.pathname.endsWith('/personal-api-key/token') ? { status } : undefined) });
      await expect(s.fetch()).rejects.toMatchObject({ code: 'reauth_required', safeMessage: GARMIN_KEY_REJECTED });
      expect(s.calls).toHaveLength(1);
    }
    expect(GARMIN_KEY_REJECTED).toBe('Garmin personal API key was rejected or expired — create a new key in Garmin Connect and update GARMIN_PERSONAL_API_KEY');
  });

  it('429 propagates as rate_limited with retryAfterMs', async () => {
    const s = setup({ override: (url) => (url.pathname.includes('/stats/steps') ? { throws: new ProviderError('rate_limited', 'slow', { retryAfterMs: 5000 }) } : undefined) });
    await expect(s.fetch()).rejects.toMatchObject({ code: 'rate_limited', opts: { retryAfterMs: 5000 } });
  });

  it('malformed token or data => malformed', async () => {
    const bad = setup({ tokens: ['<html>nope</html>'] });
    await expect(bad.fetch()).rejects.toMatchObject({ code: 'malformed' });
    const bad2 = setup({ override: (url) => (url.pathname.includes('/activitylist-service') ? { body: { not: 'a list' } } : undefined) });
    // per-metric: malformed activities nulls only that metric
    const r = await bad2.fetch();
    expect(r.data.latestActivity).toBeNull();
    expect(r.data.weekCoverage?.complete).toBe(false);
    expect(r.data.weekRunningDistanceM).toBeNull(); // unknown, not 0
    expect(r.data.stepsToday?.value).toBe(4321);
  });

  it('a failing metric leaves only that metric null', async () => {
    const s = setup({ override: (url) => (url.pathname.endsWith('/dailySleepSummariesByDate') ? { status: 500 } : undefined) });
    const r = await s.fetch();
    expect(r.data.sleepDurationSec).toBeNull();
    expect(r.data.stepsToday?.value).toBe(4321);
    expect(r.data.restingHeartRate?.value).toBe(55);
  });

  it('everything failing => throws', async () => {
    const s = setup({ override: (url) => (url.pathname.endsWith('/token') ? undefined : { status: 500 }) });
    await expect(s.fetch()).rejects.toBeInstanceOf(ProviderError);
  });

  it('null/zero health values stay null, never 0; resting HR falls back to yesterday', async () => {
    const s = setup({
      steps: [stepsRow('2026-11-21', null)],
      sleep: [sleepRow('2026-11-21', null), sleepRow('2026-11-20', 0)],
      hr: (d) => hrBody(d, d === '2026-11-21' ? null : 52),
    });
    const r = await s.fetch();
    expect(r.data.stepsToday).toEqual({ date: '2026-11-21', value: null });
    expect(r.data.sleepDurationSec).toBeNull();
    expect(r.data.restingHeartRate).toEqual({ date: '2026-11-20', value: 52 });
    expect(r.sourceUpdatedAt).toBeNull();
  });

  it('no activities this week: falls back to the latest activity ever; week total is a complete 0', async () => {
    const s = setup({ acts: (u) => (u.searchParams.has('startDate') ? [] : [activityItem(9, '2026-11-10 00:00:00')]) });
    const r = await s.fetch();
    expect(r.data.latestActivity?.id).toBe('9');
    expect(r.data.weekRunningDistanceM).toBe(0);
    expect(r.data.weekCoverage?.complete).toBe(true);
  });

  it('pagination: follows pages, bounded at 5, truncation => partial week', async () => {
    let page = 0;
    const s = setup({
      acts: () => {
        const n = page++;
        // 99 per page, strictly older each page, all this week
        return Array.from({ length: 99 }, (_, i) => activityItem(n * 99 + i + 1, new Date(NOW.getTime() - (n * 99 + i + 1) * 60_000).toISOString().slice(0, 19).replace('T', ' ')));
      },
    });
    const r = await s.fetch();
    const actCalls = s.calls.filter((c) => c.url.pathname.endsWith('/activities/search/activities'));
    expect(actCalls).toHaveLength(5);
    expect(actCalls.map((c) => c.url.searchParams.get('start'))).toEqual(['0', '99', '198', '297', '396']);
    expect(r.data.weekCoverage?.complete).toBe(false);
    expect(r.coverage?.complete).toBe(false);
  });

  it('pagination: stops on a short page and stays complete', async () => {
    let page = 0;
    const s = setup({ acts: () => (page++ === 0 ? Array.from({ length: 99 }, (_, i) => activityItem(i + 1, '2026-11-17 01:00:00')) : [activityItem(500, '2026-11-17 02:00:00')]) });
    const r = await s.fetch();
    expect(s.calls.filter((c) => c.url.pathname.endsWith('/activities/search/activities'))).toHaveLength(2);
    expect(r.data.weekCoverage?.complete).toBe(true);
    expect(r.data.weekRunningDistanceM).toBeCloseTo(100 * 5000.5);
  });

  it('duplicate activity ids across pages count once', async () => {
    let page = 0;
    const s = setup({
      acts: () => {
        const p = page++;
        const rows = p === 0 ? Array.from({ length: 98 }, (_, i) => activityItem(1000 + i, '2026-11-17 01:00:00', { activityType: { typeKey: 'cycling' } })) : [];
        return p === 0 ? [activityItem(7, '2026-11-18 00:00:00', { distance: 4000 }), ...rows, activityItem(8, '2026-11-18 03:00:00', { distance: 1000 })] : [activityItem(7, '2026-11-18 00:00:00', { distance: 4000 })];
      },
    });
    const r = await s.fetch();
    expect(r.data.weekRunningDistanceM).toBe(5000);
  });

  it('Monday boundary (Asia/Singapore): week start date and instants', async () => {
    const s = setup({ acts: () => [
      activityItem(1, '2026-11-15 15:59:59', { distance: 9000 }), // Sun 23:59:59 SGT: excluded
      activityItem(2, '2026-11-15 16:00:00', { distance: 1000 }), // Mon 00:00 SGT: included
    ] });
    const r = await s.fetch();
    expect(r.data.weekRunningDistanceM).toBe(1000);
    expect(r.data.weekCoverage?.start).toBe(MON);
  });
});
