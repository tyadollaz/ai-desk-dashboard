import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, PROVIDER_IDS, type Settings } from '../../../shared/contracts.js';
import { createHttpClient } from '../../../server/http/client.js';
import { createLiveAdapter } from '../../../server/providers/google/live.js';
import { ProviderManager } from '../../../server/providers/manager.js';
import type { AdapterMap } from '../../../server/providers/registry.js';
import { ProviderError } from '../../../server/providers/types.js';
import { openDb, type Db } from '../../../server/storage/db.js';
import { runMigrations } from '../../../server/storage/migrations.js';
import { createSettingsStore } from '../../../server/storage/settings.js';
import { createSnapshotStore } from '../../../server/storage/snapshots.js';
import { createSyncMetaStore } from '../../../server/storage/sync-meta.js';
import { createTokenStore } from '../../../server/storage/tokens.js';
import { Clock } from '../helpers.js';

const fx = (n: string): unknown => JSON.parse(readFileSync(new URL(`../../fixtures/google/${n}.json`, import.meta.url), 'utf8'));
const ENV = { GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'csecret', GOOGLE_REDIRECT_URI: 'https://x.test/api/google/callback' };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const dbs: Db[] = [];
afterEach(() => dbs.splice(0).forEach((d) => d.close()));

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

function setup(handler: Handler, tokensInit: Record<string, unknown> | null = {}, env: Record<string, string | undefined> = ENV) {
  const clock = new Clock();
  const db = openDb(':memory:');
  runMigrations(db);
  dbs.push(db);
  const tokens = createTokenStore(db, randomBytes(32), clock.now);
  const calls: { url: URL; init: RequestInit }[] = [];
  const fetchImpl = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  const http = createHttpClient({ allowedHosts: ['oauth2.googleapis.com', 'www.googleapis.com'], fetchImpl, now: clock.now, sleep: async () => undefined });
  const adapter = createLiveAdapter({ env, now: clock.now, http, tokens });
  const ready = async () => {
    if (tokensInit) await tokens.set('google', { refresh_token: 'rt-1', access_token: 'at-valid', expiry_date: clock.t + 3_600_000, ...tokensInit });
  };
  return { clock, db, tokens, adapter, calls, ready };
}

const tokenCalls = <T extends { url: URL }>(calls: T[]) => calls.filter((c) => c.url.hostname === 'oauth2.googleapis.com');
const eventCalls = <T extends { url: URL }>(calls: T[]) => calls.filter((c) => c.url.hostname === 'www.googleapis.com');
const run = (s: ReturnType<typeof setup>, settings: Settings = DEFAULT_SETTINGS) => s.adapter.fetch(settings, new AbortController().signal);

describe('google live adapter', () => {
  it('reports setup status', async () => {
    const noEnv = setup(() => json({}), null, {});
    expect(await noEnv.adapter.setupStatus(DEFAULT_SETTINGS)).toEqual({
      connection: 'needs_setup',
      requirement: 'Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI in the server environment',
    });
    const noTokens = setup(() => json({}), null);
    expect(await noTokens.adapter.setupStatus(DEFAULT_SETTINGS)).toEqual({ connection: 'needs_setup', requirement: 'Connect Google Calendar in Settings' });
    const ok = setup(() => json({}));
    await ok.ready();
    expect((await ok.adapter.setupStatus(DEFAULT_SETTINGS)).connection).toBe('connected');
  });

  it('paginates, normalizes and excludes declined/cancelled events', async () => {
    const s = setup((url) => json(fx(url.searchParams.get('pageToken') === 'page2token' ? 'events-page2' : 'events-page1')));
    await s.ready();
    const r = await run(s);
    const ev = r.data.events;
    expect(ev.map((e) => e.id).sort()).toEqual(
      ['primary:dupA', 'primary:dupB', 'primary:rec_20261121', 'primary:late', 'primary:holiday', 'primary:rec_20261124', 'primary:untitled'].sort(),
    );
    expect(ev.some((e) => e.id.includes('declined') || e.id.includes('cancelled'))).toBe(false);
    // Recurring instances stay distinct but share recurringEventId.
    const rec = ev.filter((e) => e.recurringEventId === 'rec');
    expect(rec).toHaveLength(2);
    expect(new Set(rec.map((e) => e.id)).size).toBe(2);
    // Cross-midnight timed event keeps its instants in UTC.
    const late = ev.find((e) => e.id === 'primary:late')!;
    expect(late.start.dateTime).toBe('2026-11-21T15:00:00.000Z');
    expect(late.end.dateTime).toBe('2026-11-21T17:00:00.000Z');
    expect(late.htmlLink).toBeNull(); // non-https link dropped
    // All-day event: date kept, exclusive end not adjusted.
    const holiday = ev.find((e) => e.id === 'primary:holiday')!;
    expect(holiday).toMatchObject({ allDay: true, start: { dateTime: null, date: '2026-11-23' }, end: { dateTime: null, date: '2026-11-24' } });
    // Same-named events remain distinct; untitled -> null title.
    expect(ev.filter((e) => e.title === 'Lunch')).toHaveLength(2);
    expect(ev.find((e) => e.id === 'primary:untitled')!.title).toBeNull();
    expect(ev.find((e) => e.id === 'primary:rec_20261121')!.htmlLink).toMatch(/^https:/);
    expect(JSON.stringify(ev)).not.toMatch(/secret|Room 1|attendees|me@example/);
    // Sorted by start.
    const starts = ev.map((e) => Date.parse(e.start.dateTime ?? `${e.start.date}T00:00:00+08:00`));
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    // Request shape and coverage.
    const first = eventCalls(s.calls)[0]!;
    expect(first.url.pathname).toBe('/calendar/v3/calendars/primary/events');
    expect(first.url.searchParams.get('singleEvents')).toBe('true');
    expect(first.url.searchParams.get('orderBy')).toBe('startTime');
    expect(first.url.searchParams.get('timeMin')).toBe('2026-11-20T16:00:00.000Z');
    expect((first.init.headers as Record<string, string>).authorization).toBe('Bearer at-valid');
    expect(eventCalls(s.calls)).toHaveLength(2);
    expect(r.coverage).toEqual({ start: '2026-11-20T16:00:00.000Z', end: '2026-11-28T16:00:00.000Z', complete: true });
    expect(r.detailUrl).toBe('https://calendar.google.com/');
  });

  it('marks coverage partial past 10 pages', async () => {
    const s = setup(() => json({ items: [], nextPageToken: 'more' }));
    await s.ready();
    const r = await run(s);
    expect(eventCalls(s.calls)).toHaveLength(10);
    expect(r.coverage?.complete).toBe(false);
  });

  it('returns valid empty data for an empty calendar', async () => {
    const s = setup(() => json(fx('events-empty')));
    await s.ready();
    const r = await run(s);
    expect(r.data.events).toEqual([]);
    expect(r.data.calendars).toEqual([{ calendarId: 'primary', ok: true, error: null }]);
    expect(r.coverage?.complete).toBe(true);
  });

  it('refreshes an expired access token and persists it encrypted', async () => {
    const s = setup((url) => (url.hostname === 'oauth2.googleapis.com' ? json(fx('token-ok')) : json(fx('events-empty'))));
    await s.tokens.set('google', { refresh_token: 'rt-1', access_token: 'old', expiry_date: s.clock.t + 30_000 }); // within 60s skew
    const r = await run(s);
    expect(r.data.events).toEqual([]);
    expect(tokenCalls(s.calls)).toHaveLength(1);
    const body = new URLSearchParams(String(tokenCalls(s.calls)[0]!.init.body));
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('rt-1');
    expect((eventCalls(s.calls)[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer new-access-token');
    const stored = await s.tokens.get('google');
    expect(stored).toMatchObject({ refresh_token: 'rt-1', access_token: 'new-access-token', expiry_date: s.clock.t + 3599_000 });
    const raw = s.db.prepare('SELECT ciphertext FROM provider_tokens').get() as { ciphertext: Buffer };
    expect(raw.ciphertext.toString('utf8')).not.toContain('new-access-token');
  });

  it('refreshes once on a 401 from events then succeeds; reauth_required if still 401', async () => {
    let eventHits = 0;
    const s = setup((url) => {
      if (url.hostname === 'oauth2.googleapis.com') return json(fx('token-ok'));
      return ++eventHits === 1 ? json({ error: { code: 401 } }, 401) : json(fx('events-empty'));
    });
    await s.ready();
    await run(s);
    expect(tokenCalls(s.calls)).toHaveLength(1);
    expect(eventHits).toBe(2);

    const s2 = setup((url) => (url.hostname === 'oauth2.googleapis.com' ? json(fx('token-ok')) : json({ error: {} }, 401)));
    await s2.ready();
    await expect(run(s2)).rejects.toMatchObject({ code: 'reauth_required' });
    expect(tokenCalls(s2.calls)).toHaveLength(1);
    expect(eventCalls(s2.calls)).toHaveLength(2);
  });

  it('invalid_grant -> reauth_required with exactly one token call and no retry', async () => {
    const s = setup((url) => (url.hostname === 'oauth2.googleapis.com' ? json(fx('token-invalid-grant'), 400) : json(fx('events-empty'))));
    await s.tokens.set('google', { refresh_token: 'rt-1', access_token: 'old', expiry_date: 1 });
    const err = await run(s).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ code: 'reauth_required' });
    expect(tokenCalls(s.calls)).toHaveLength(1);
    expect(eventCalls(s.calls)).toHaveLength(0);
  });

  it('maps 429 to rate_limited and bad JSON shape to malformed', async () => {
    const rl = setup(() => json({}, 429, { 'retry-after': '120' }));
    await rl.ready();
    await expect(run(rl)).rejects.toMatchObject({ code: 'rate_limited', opts: { retryAfterMs: 120_000 } });
    const bad = setup(() => json(fx('events-malformed')));
    await bad.ready();
    await expect(run(bad)).rejects.toMatchObject({ code: 'malformed' });
  });

  it('reports a per-calendar failure while others succeed; all failing throws', async () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, calendar: { calendarIds: ['primary', 'bad id@group'] } };
    const s = setup((url) => (url.pathname.includes('/calendars/primary/') ? json(fx('events-page2')) : json({ error: { code: 404 } }, 404)));
    await s.ready();
    const r = await run(s, settings);
    expect(r.data.calendars[0]).toMatchObject({ calendarId: 'primary', ok: true });
    expect(r.data.calendars[1]).toMatchObject({ calendarId: 'bad id@group', ok: false, error: { code: 'upstream' } });
    expect(r.data.events.length).toBe(4);
    expect(r.coverage?.complete).toBe(false);
    expect(eventCalls(s.calls).some((c) => c.url.pathname.includes('bad%20id%40group'))).toBe(true);

    const allBad = setup(() => json({}, 404));
    await allBad.ready();
    await expect(run(allBad, settings)).rejects.toMatchObject({ code: 'upstream' });
  });

  it('configKey joins calendar ids', () => {
    const s = setup(() => json({}));
    expect(s.adapter.configKey?.({ ...DEFAULT_SETTINGS, calendar: { calendarIds: ['a', 'b'] } })).toBe('a,b');
  });
});

describe('google via ProviderManager', () => {
  it('shows reauth_required after invalid_grant and does not hammer the token endpoint', async () => {
    const s = setup((url) => (url.hostname === 'oauth2.googleapis.com' ? json(fx('token-invalid-grant'), 400) : json(fx('events-empty'))));
    await s.tokens.set('google', { refresh_token: 'rt-1', access_token: 'old', expiry_date: 1 });
    const settings = createSettingsStore(s.db, s.clock.now);
    const idle = (id: string) => ({
      id,
      mode: 'live',
      setupStatus: async () => ({ connection: 'needs_setup', requirement: 'x' }),
      fetch: async () => {
        throw new Error('unused');
      },
    });
    const adapters = Object.fromEntries(PROVIDER_IDS.map((id) => [id, id === 'google' ? s.adapter : idle(id)])) as unknown as AdapterMap;
    const manager = new ProviderManager({
      adapters,
      mode: 'live',
      settings,
      snapshots: createSnapshotStore(s.db),
      syncMeta: createSyncMetaStore(s.db),
      tokens: s.tokens,
      now: s.clock.now,
      log: { warn: () => undefined },
    });
    await manager.getEnvelopes();
    await manager.whenIdle();
    expect(tokenCalls(s.calls)).toHaveLength(1);
    const env = await manager.getEnvelope('google');
    expect(env.connection).toBe('reauth_required');
    expect(env.error?.code).toBe('reauth_required');
    for (let i = 0; i < 3; i++) {
      s.clock.advance(10 * 60_000);
      await manager.getEnvelopes();
      await manager.whenIdle();
    }
    expect(tokenCalls(s.calls)).toHaveLength(1);
  });
});
