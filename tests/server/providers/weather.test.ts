import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../../../shared/contracts.js';
import { createLiveAdapter } from '../../../server/providers/weather/live.js';
import { ProviderError, type HttpClient } from '../../../server/providers/types.js';
import { forecastBody } from '../../fixtures/weather/twoHrForecast.js';
import { Clock } from '../helpers.js';

const settings = (area: string | null): Settings => ({ ...DEFAULT_SETTINGS, weather: { area } });
const ok = (body: unknown) => ({ status: 200, headers: new Headers(), json: async () => body, text: async () => '' });
const signal = new AbortController().signal;

function make(handler: () => unknown, env: Record<string, string | undefined> = {}, clock = new Clock()) {
  const request = vi.fn(async (_url: string, _init?: unknown) => {
    const r = handler();
    if (r instanceof Error) throw r;
    return ok(r);
  });
  const adapter = createLiveAdapter({ env, now: clock.now, http: { request } as unknown as HttpClient, tokens: {} as never });
  return { adapter, request, clock };
}

describe('weather live adapter', () => {
  it('uses latest item and normalizes to UTC', async () => {
    const { adapter, request } = make(() => forecastBody());
    const r = await adapter.fetch(settings('Ang Mo Kio'), signal);
    expect(request.mock.calls[0]![0]).toBe('https://api-open.data.gov.sg/v2/real-time/api/two-hr-forecast');
    expect(r.data).toEqual({
      area: 'Ang Mo Kio',
      forecast: 'Cloudy',
      validFrom: '2026-11-21T07:00:00.000Z',
      validUntil: '2026-11-21T09:00:00.000Z',
      issuedAt: '2026-11-21T07:06:51.000Z',
      availableAreas: ['Ang Mo Kio', 'Bedok', 'Yishun'],
    });
    expect(r.validUntil).toBe('2026-11-21T09:00:00.000Z');
    expect(r.sourceUpdatedAt).toBe('2026-11-21T07:06:51.000Z');
    expect(r.detailUrl).toBe('https://www.nea.gov.sg/weather');
  });

  it('is connected without an area and returns availableAreas', async () => {
    const { adapter } = make(() => forecastBody());
    expect(await adapter.setupStatus(settings(null))).toEqual({ connection: 'connected', requirement: null });
    const r = await adapter.fetch(settings(null), signal);
    expect(r.data.area).toBeNull();
    expect(r.data.forecast).toBeNull();
    expect(r.data.availableAreas).toEqual(['Ang Mo Kio', 'Bedok', 'Yishun']);
  });

  it('unknown area throws needs_setup', async () => {
    const { adapter } = make(() => forecastBody());
    await expect(adapter.fetch(settings('Atlantis'), signal)).rejects.toMatchObject({ code: 'needs_setup' });
  });

  it('no items returns null forecast with areas', async () => {
    const { adapter } = make(() => forecastBody({ items: [] }));
    const r = await adapter.fetch(settings('Bedok'), signal);
    expect(r.data.forecast).toBeNull();
    expect(r.validUntil).toBeNull();
    expect(r.data.availableAreas).toHaveLength(3);
  });

  it('old forecast is expired right after a successful fetch', async () => {
    const clock = new Clock(Date.parse('2026-11-21T10:00:00Z'));
    const { adapter } = make(() => forecastBody(), {}, clock);
    const r = await adapter.fetch(settings('Bedok'), signal);
    expect(adapter.isExpired!(r, clock.now())).toBe(true);
    expect(adapter.isExpired!(r, new Date('2026-11-21T08:59:59Z'))).toBe(false);
  });

  it('sends x-api-key only when configured, and never leaks it', async () => {
    const none = make(() => forecastBody());
    await none.adapter.fetch(settings('Bedok'), signal);
    expect((none.request.mock.calls[0]![1] as { headers: Record<string, string> }).headers['x-api-key']).toBeUndefined();

    const withKey = make(() => forecastBody({ code: 1, errorMsg: 'bad' }), { DATA_GOV_SG_API_KEY: 'SECRET-DGS' });
    const err = await withKey.adapter.fetch(settings('Bedok'), signal).then(() => { throw new Error('expected failure'); }, (e: unknown) => e as ProviderError);
    expect((withKey.request.mock.calls[0]![1] as { headers: Record<string, string> }).headers['x-api-key']).toBe('SECRET-DGS');
    expect(err).toMatchObject({ code: 'upstream' });
    expect(String(err.message) + err.safeMessage).not.toContain('SECRET-DGS');
  });

  it('propagates auth_failed and rate_limited', async () => {
    await expect(make(() => new ProviderError('auth_failed', 'x')).adapter.fetch(settings('Bedok'), signal)).rejects.toMatchObject({ code: 'auth_failed' });
    await expect(make(() => new ProviderError('rate_limited', 'x', { retryAfterMs: 10_000 })).adapter.fetch(settings('Bedok'), signal)).rejects.toMatchObject({ code: 'rate_limited', opts: { retryAfterMs: 10_000 } });
  });

  it('malformed shape yields malformed', async () => {
    await expect(make(() => ({ code: 0, data: {} })).adapter.fetch(settings('Bedok'), signal)).rejects.toMatchObject({ code: 'malformed' });
  });

  it.skipIf(!process.env.LIVE_SMOKE)('live smoke: public endpoint (no key)', async () => {
    const res = await fetch('https://api-open.data.gov.sg/v2/real-time/api/two-hr-forecast');
    const body = await res.json();
    const { normalizeWeather } = await import('../../../server/providers/weather/normalize.js');
    const n = normalizeWeather(body, null);
    console.log(`SMOKE areas=${n.data.availableAreas.length} validFrom=${n.data.validFrom} validUntil=${n.data.validUntil} issuedAt=${n.data.issuedAt}`);
    expect(n.data.availableAreas.length).toBeGreaterThan(0);
  });
});
