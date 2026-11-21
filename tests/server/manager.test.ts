import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROVIDER_IDS, REFRESH_POLICY, type ProviderId, type Settings } from '../../shared/contracts.js';
import { ProviderManager } from '../../server/providers/manager.js';
import type { AdapterMap } from '../../server/providers/registry.js';
import { ProviderError, type ProviderAdapter } from '../../server/providers/types.js';
import { openDb, type Db } from '../../server/storage/db.js';
import { runMigrations } from '../../server/storage/migrations.js';
import { createSettingsStore } from '../../server/storage/settings.js';
import { createSnapshotStore } from '../../server/storage/snapshots.js';
import { createSyncMetaStore } from '../../server/storage/sync-meta.js';
import { createTokenStore } from '../../server/storage/tokens.js';
import { Clock } from './helpers.js';
import { randomBytes } from 'node:crypto';

const dbs: Db[] = [];
afterEach(() => dbs.splice(0).forEach((d) => d.close()));

function fakeAdapter(id: ProviderId, fetchFn: () => Promise<unknown>, extra: Partial<ProviderAdapter> = {}): ProviderAdapter {
  return {
    id,
    mode: 'live',
    setupStatus: async () => ({ connection: 'connected', requirement: null }),
    fetch: async () => ({ data: await fetchFn(), sourceUpdatedAt: null, validUntil: null, coverage: null }),
    ...extra,
  } as ProviderAdapter;
}

function setup(adapterOverrides: Partial<Record<ProviderId, ProviderAdapter>> = {}, clock = new Clock(), db?: Db) {
  const database = db ?? openDb(':memory:');
  if (!db) {
    runMigrations(database);
    dbs.push(database);
  }
  const adapters = Object.fromEntries(PROVIDER_IDS.map((id) => [id, adapterOverrides[id] ?? fakeAdapter(id, async () => ({ id }))])) as unknown as AdapterMap;
  const settings = createSettingsStore(database, clock.now);
  const tokens = createTokenStore(database, randomBytes(32), clock.now);
  const snapshots = createSnapshotStore(database);
  const manager = new ProviderManager({
    adapters,
    mode: 'live',
    settings,
    snapshots,
    syncMeta: createSyncMetaStore(database),
    tokens,
    now: clock.now,
    log: { warn: () => undefined },
  });
  return { manager, clock, settings, tokens, snapshots, db: database };
}

describe('ProviderManager', () => {
  it('coalesces concurrent refreshes into one upstream fetch', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchFn = vi.fn(async () => {
      await gate;
      return { ok: 1 };
    });
    const { manager } = setup({ lta: fakeAdapter('lta', fetchFn) });
    const results = await Promise.all([manager.refresh('lta', { manual: true }), manager.refresh('lta', { manual: true }), manager.refresh('lta', { manual: false })]);
    expect(results.sort()).toEqual(['accepted', 'in_flight', 'in_flight']);
    expect((await manager.getEnvelope('lta')).fetchState).toBe('fetching');
    release();
    await manager.whenIdle();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const env = await manager.getEnvelope('lta');
    expect(env).toMatchObject({ fetchState: 'ok', freshness: 'fresh', data: { ok: 1 }, connection: 'connected' });
  });

  it('manual refresh spacing 10s; rate-limit cooldown cannot be bypassed manually', async () => {
    let n = 0;
    const fetchFn = vi.fn(async () => {
      n++;
      if (n === 2) throw new ProviderError('rate_limited', 'slow down', { retryAfterMs: 120_000 });
      return { n };
    });
    const { manager, clock } = setup({ lta: fakeAdapter('lta', fetchFn) });
    expect(await manager.refresh('lta', { manual: true })).toBe('accepted');
    await manager.whenIdle();
    expect(await manager.refresh('lta', { manual: true })).toBe('cooldown'); // <10s spacing
    clock.advance(11_000);
    expect(await manager.refresh('lta', { manual: true })).toBe('accepted');
    await manager.whenIdle();
    const env = await manager.getEnvelope('lta');
    expect(env.error?.code).toBe('rate_limited');
    expect(env.data).toEqual({ n: 1 }); // previous data retained
    expect(env.nextAllowedRefreshAt).toBe(new Date(clock.t + 120_000 - 0).toISOString());
    clock.advance(30_000);
    expect(await manager.refresh('lta', { manual: true })).toBe('cooldown');
    expect(fetchFn).toHaveBeenCalledTimes(2);
    clock.advance(100_000);
    expect(await manager.refresh('lta', { manual: true })).toBe('accepted');
    await manager.whenIdle();
    expect((await manager.getEnvelope('lta')).error).toBeNull();
  });

  it('a failing provider keeps previous data and does not affect the others', async () => {
    let fail = false;
    const { manager, clock } = setup({
      canvas: fakeAdapter('canvas', async () => {
        if (fail) throw new Error('boom: secret-token-xyz');
        return { items: [1] };
      }),
    });
    await manager.prime();
    fail = true;
    clock.advance(11_000);
    await manager.refresh('canvas', { manual: true });
    await manager.whenIdle();
    const envs = await manager.getEnvelopes();
    expect(envs.canvas.data).toEqual({ items: [1] });
    expect(envs.canvas.error).toEqual({ code: 'internal', message: expect.not.stringContaining('secret') });
    expect(envs.canvas.fetchState).toBe('error');
    for (const id of ['lta', 'weather', 'google', 'garmin'] as const) expect(envs[id].data).toEqual({ id });
  });

  it('auth_failed -> reauth_required, no automatic retry; manual refresh allowed', async () => {
    let n = 0;
    const fetchFn = vi.fn(async () => {
      n++;
      if (n === 1) throw new ProviderError('auth_failed', 'bad token');
      return { ok: true };
    });
    const { manager, clock } = setup({ weather: fakeAdapter('weather', fetchFn) });
    await manager.getEnvelopes();
    await manager.whenIdle();
    expect((await manager.getEnvelope('weather')).connection).toBe('reauth_required');
    clock.advance(REFRESH_POLICY.weather.intervalMs * 3);
    await manager.getEnvelopes();
    await manager.whenIdle();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(await manager.refresh('weather', { manual: true })).toBe('accepted');
    await manager.whenIdle();
    expect(await manager.getEnvelope('weather')).toMatchObject({ connection: 'connected', data: { ok: true } });
  });

  it('getEnvelopes returns cache immediately and refreshes due providers in the background', async () => {
    const fetchFn = vi.fn(async () => ({ v: 1 }));
    const { manager, clock } = setup({ lta: fakeAdapter('lta', fetchFn) });
    const first = await manager.getEnvelopes();
    expect(first.lta.data).toBeNull();
    expect(first.lta.fetchState).toBe('fetching');
    await manager.whenIdle();
    await manager.getEnvelopes();
    expect(fetchFn).toHaveBeenCalledTimes(1); // not due again
    clock.advance(REFRESH_POLICY.lta.intervalMs);
    await manager.getEnvelopes();
    await manager.whenIdle();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('freshness: fresh -> stale -> expired via adapter.isExpired; unknown without success', async () => {
    let expired = false;
    const { manager, clock } = setup({ weather: fakeAdapter('weather', async () => ({ w: 1 }), { isExpired: () => expired }) });
    expect((await manager.getEnvelope('weather')).freshness).toBe('unknown');
    await manager.refresh('weather', { manual: false });
    await manager.whenIdle();
    expect((await manager.getEnvelope('weather')).freshness).toBe('fresh');
    clock.advance(REFRESH_POLICY.weather.staleAfterMs + 1000);
    expect((await manager.getEnvelope('weather')).freshness).toBe('stale');
    expired = true;
    expect((await manager.getEnvelope('weather')).freshness).toBe('expired');
  });

  it('changing configKey discards the old snapshot', async () => {
    const adapter = fakeAdapter('weather', async () => ({ w: 1 }), { configKey: (s: Settings) => s.weather.area ?? '' });
    const { manager, settings, db } = setup({ weather: adapter });
    await manager.refresh('weather', { manual: false });
    await manager.whenIdle();
    expect((await manager.getEnvelope('weather')).data).toEqual({ w: 1 });
    settings.patch({ weather: { area: 'Bedok' } });
    manager.onSettingsChanged();
    expect((await manager.getEnvelope('weather')).data).toBeNull();
    expect((db.prepare('SELECT COUNT(*) n FROM snapshots WHERE provider = ?').get('weather') as { n: number }).n).toBe(0);
  });

  it('disconnect disables, clears snapshot, tokens and sync_meta', async () => {
    const { manager, tokens, db, settings } = setup();
    await tokens.set('google', { refresh_token: 'r' });
    await manager.refresh('google', { manual: false });
    await manager.whenIdle();
    const count = (t: string) => (db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE provider = 'google'`).get() as { n: number }).n;
    expect([count('snapshots'), count('sync_meta'), count('provider_tokens')]).toEqual([1, 1, 1]);
    await manager.disconnect('google');
    expect([count('snapshots'), count('sync_meta'), count('provider_tokens')]).toEqual([0, 0, 0]);
    expect(await tokens.get('google')).toBeNull();
    expect(settings.get().providers.google.enabled).toBe(false);
    const env = await manager.getEnvelope('google');
    expect(env).toMatchObject({ connection: 'disabled', data: null });
    expect(await manager.refresh('google', { manual: true })).toBe('disabled');
  });

  it('snapshots survive a restart; mode mismatch is purged', async () => {
    const first = setup();
    await first.manager.refresh('lta', { manual: false });
    await first.manager.whenIdle();
    const second = setup({}, first.clock, first.db);
    expect((await second.manager.getEnvelope('lta')).data).toEqual({ id: 'lta' });
    const demoMgr = new ProviderManager({
      adapters: Object.fromEntries(PROVIDER_IDS.map((id) => [id, fakeAdapter(id, async () => ({}), { mode: 'demo' })])) as unknown as AdapterMap,
      mode: 'demo',
      settings: second.settings,
      snapshots: second.snapshots,
      syncMeta: createSyncMetaStore(first.db),
      tokens: second.tokens,
      now: first.clock.now,
      log: { warn: () => undefined },
    });
    expect((await demoMgr.getEnvelope('lta')).data).toBeNull();
  });
});
