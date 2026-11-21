import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../../../shared/contracts.js';
import { createLiveAdapter } from '../../../server/providers/lta/live.js';
import { ProviderError, type HttpClient } from '../../../server/providers/types.js';
import { busArrivalBody } from '../../fixtures/lta/busArrival.js';
import { Clock } from '../helpers.js';

const KEY = 'SECRET-LTA-KEY';
const settings = (stops: Settings['bus']['stops']): Settings => ({ ...DEFAULT_SETTINGS, bus: { stops } });
const stop = (code: string, services: string[] = []) => ({ code, nickname: null, services });
const ok = (body: unknown) => ({ status: 200, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body) });

function make(handler: (url: string) => unknown, env: Record<string, string | undefined> = { LTA_ACCOUNT_KEY: KEY }) {
  const request = vi.fn(async (url: string) => {
    const r = handler(url);
    if (r instanceof Error) throw r;
    return ok(r);
  });
  const clock = new Clock();
  const adapter = createLiveAdapter({ env, now: clock.now, http: { request } as unknown as HttpClient, tokens: {} as never });
  return { adapter, request };
}
const signal = new AbortController().signal;

describe('lta live adapter', () => {
  it('reports setup requirements', async () => {
    expect(await make(() => ({}), {}).adapter.setupStatus(settings([stop('83139')]))).toEqual({ connection: 'needs_setup', requirement: 'Set LTA_ACCOUNT_KEY in the server environment' });
    expect(await make(() => ({})).adapter.setupStatus(settings([]))).toEqual({ connection: 'needs_setup', requirement: 'Add a bus stop in Settings' });
    expect((await make(() => ({})).adapter.setupStatus(settings([stop('83139')]))).connection).toBe('connected');
  });

  it('normalizes a valid response, sends key header only, keeps leading zeroes', async () => {
    const { adapter, request } = make((u) => busArrivalBody(new URL(u).searchParams.get('BusStopCode')!));
    const r = await adapter.fetch(settings([stop('01012')]), signal);
    const [url, init] = request.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(url).toBe('https://datamall2.mytransport.sg/ltaodataservice/v3/BusArrival?BusStopCode=01012');
    expect(url).not.toContain(KEY);
    expect(init.headers.AccountKey).toBe(KEY);
    const svc = r.data.stops[0]!.services;
    expect(r.data.stops[0]!.code).toBe('01012');
    expect(svc.map((s) => s.serviceNo)).toEqual(['15', '36', '36A']);
    expect(svc[0]!.arrivals).toEqual([
      { estimatedArrival: '2026-11-21T04:01:30.000Z', load: 'SEA', monitored: true },
      { estimatedArrival: '2026-11-21T04:09:00.000Z', load: 'SDA', monitored: false },
      { estimatedArrival: null, load: null, monitored: null },
    ]);
    expect(r.validUntil).toBeNull();
    expect(r.sourceUpdatedAt).toBe('2026-11-21T04:00:00.000Z');
  });

  it('filters by service (string compare, suffixes distinct)', async () => {
    const { adapter } = make(() => busArrivalBody());
    const r36 = await adapter.fetch(settings([stop('83139', ['36'])]), signal);
    expect(r36.data.stops[0]!.services.map((s) => s.serviceNo)).toEqual(['36']);
    const r36a = await adapter.fetch(settings([stop('83139', ['36A'])]), signal);
    expect(r36a.data.stops[0]!.services.map((s) => s.serviceNo)).toEqual(['36A']);
  });

  it('empty Services is a valid empty result', async () => {
    const { adapter } = make(() => busArrivalBody('83139', []));
    const r = await adapter.fetch(settings([stop('83139')]), signal);
    expect(r.data.stops[0]).toMatchObject({ services: [], error: null });
  });

  it('propagates auth_failed and rate_limited when all stops fail', async () => {
    const auth = make(() => new ProviderError('auth_failed', 'The service rejected the credentials'));
    await expect(auth.adapter.fetch(settings([stop('83139'), stop('01012')]), signal)).rejects.toMatchObject({ code: 'auth_failed' });
    const rl = make(() => new ProviderError('rate_limited', 'slow down', { retryAfterMs: 5000 }));
    await expect(rl.adapter.fetch(settings([stop('83139')]), signal)).rejects.toMatchObject({ code: 'rate_limited', opts: { retryAfterMs: 5000 } });
  });

  it('malformed shape yields malformed', async () => {
    const { adapter } = make(() => ({ nope: true }));
    await expect(adapter.fetch(settings([stop('83139')]), signal)).rejects.toMatchObject({ code: 'malformed' });
  });

  it('per-stop failure becomes BusStop.error while others return', async () => {
    const { adapter } = make((u) => (u.includes('01012') ? new ProviderError('timeout', 'The service did not respond in time') : busArrivalBody('83139')));
    const r = await adapter.fetch(settings([stop('83139'), stop('01012')]), signal);
    expect(r.data.stops[0]!.error).toBeNull();
    expect(r.data.stops[1]).toMatchObject({ services: [], error: { code: 'timeout' } });
  });

  it('configKey changes with stops', () => {
    const { adapter } = make(() => ({}));
    expect(adapter.configKey!(settings([stop('83139')]))).not.toBe(adapter.configKey!(settings([stop('01012')])));
  });

  it('carries a failed stop forward from the previous snapshot, keeping its error', async () => {
    let failB = false;
    const { adapter, request } = make((u) => {
      const code = new URL(u).searchParams.get('BusStopCode')!;
      return failB && code === '22222' ? new ProviderError('upstream', 'down') : busArrivalBody(code);
    });
    const first = await adapter.fetch(settings([stop('11111'), stop('22222')]), signal);
    expect(first.data.stops.every((s) => s.error === null && s.services.length > 0)).toBe(true);
    failB = true;
    const second = await adapter.fetch(settings([stop('11111'), stop('22222')]), signal, first.data);
    expect(second.data.stops[0]!.error).toBeNull();
    expect(second.data.stops[1]!.error).toMatchObject({ code: 'upstream' });
    expect(second.data.stops[1]!.services).toEqual(first.data.stops[1]!.services);
    // no previous data: empty services, as before
    const cold = await adapter.fetch(settings([stop('11111'), stop('22222')]), signal);
    expect(cold.data.stops[1]!.services).toEqual([]);
    // the abort signal is forwarded to http
    expect((request.mock.calls[0] as unknown as [string, { signal: AbortSignal }])[1].signal).toBe(signal);
  });
});
