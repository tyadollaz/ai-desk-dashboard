// Opt-in live smoke test: LIVE_SMOKE=1 npx vitest run tests/server/live-smoke.test.ts
// Uses real credentials from .env / the environment. Prints only counts and summaries, never secrets.
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createHttpClient } from '../../server/http/client.js';
import { allowedHostsFor } from '../../server/providers/registry.js';
import type { ProviderDeps, TokenStore } from '../../server/providers/types.js';
import { createLiveAdapter as lta } from '../../server/providers/lta/live.js';
import { createLiveAdapter as weather } from '../../server/providers/weather/live.js';
import { createLiveAdapter as canvas } from '../../server/providers/canvas/live.js';
import { createLiveAdapter as garmin } from '../../server/providers/garmin/live.js';
import { DEFAULT_SETTINGS, type ProviderId, type Settings } from '../../shared/contracts.js';

const enabled = process.env.LIVE_SMOKE === '1';
if (enabled && existsSync('.env')) process.loadEnvFile('.env');

function memoryTokens(): TokenStore {
  const m = new Map<string, Record<string, unknown>>();
  return {
    get: async (p) => m.get(p) ?? null,
    set: async (p, v) => void m.set(p, v),
    clear: async (p) => void m.delete(p),
  };
}

function deps(id: ProviderId): ProviderDeps {
  const env = process.env as Record<string, string | undefined>;
  return { env, now: () => new Date(), tokens: memoryTokens(), http: createHttpClient({ allowedHosts: allowedHostsFor(id, env) }) };
}

const has = (...keys: string[]) => keys.every((k) => !!process.env[k]);
const settings = (patch: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...patch });

describe.skipIf(!enabled)('live smoke', () => {
  it.skipIf(!has('LTA_ACCOUNT_KEY'))('lta', async () => {
    const code = process.env.SMOKE_BUS_STOP ?? '44351';
    const r = await lta(deps('lta')).fetch(settings({ bus: { ...DEFAULT_SETTINGS.bus, stops: [{ code, nickname: null, services: [] }] } }), AbortSignal.timeout(30_000));
    expect(Array.isArray(r.data.stops)).toBe(true);
    console.log(`lta: stops=${r.data.stops.length} services=${r.data.stops.reduce((n, s) => n + s.services.length, 0)}`);
  }, 30_000);

  it('weather', async () => {
    const r = await weather(deps('weather')).fetch(settings(), AbortSignal.timeout(30_000));
    expect(r.data).toBeTruthy();
    console.log(`weather: keys=${Object.keys(r.data as object).join(',')}`);
  }, 30_000);

  it.skipIf(!has('CANVAS_BASE_URL', 'CANVAS_ACCESS_TOKEN'))('canvas', async () => {
    const r = await canvas(deps('canvas')).fetch(settings(), AbortSignal.timeout(30_000));
    expect(r.data).toBeTruthy();
    console.log(`canvas: keys=${Object.keys(r.data as object).join(',')}`);
  }, 60_000);

  it.skipIf(!has('GARMIN_PERSONAL_API_KEY'))('garmin', async () => {
    const r = await garmin(deps('garmin')).fetch(settings(), AbortSignal.timeout(30_000));
    expect(r.data).toBeTruthy();
    expect(r.data.weekRunningDistanceM === null || typeof r.data.weekRunningDistanceM === 'number').toBe(true);
    console.log(`garmin: weekRunningDistanceM=${r.data.weekRunningDistanceM === null ? 'null' : 'number'} latestActivity=${r.data.latestActivity ? 'yes' : 'no'}`);
  }, 60_000);
});
