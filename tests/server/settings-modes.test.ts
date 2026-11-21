import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PROVIDER_IDS } from '../../shared/contracts.js';
import { cleanupTmp, loginCookie, makeApp, makeConfig, MUTATE } from './helpers.js';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
  cleanupTmp();
});

const patch = (app: FastifyInstance, cookie: string, payload: unknown) =>
  app.inject({ method: 'PATCH', url: '/api/settings', headers: { ...MUTATE, cookie }, payload: payload as object });

describe('settings', () => {
  it('persists across restart, preserves leading zeroes, rejects bad stop codes', async () => {
    const config = await makeConfig();
    const first = (await makeApp({}, {}, config)).app;
    const cookie = await loginCookie(first);
    const bad = await patch(first, cookie, { bus: { stops: [{ code: '1234', nickname: null, services: [] }] } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.issues.length).toBeGreaterThan(0);
    const ok = await patch(first, cookie, { bus: { stops: [{ code: '01012', nickname: 'Home', services: ['36A'] }] }, privacy: { enabled: true } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().settings.bus.stops[0].code).toBe('01012');
    await first.close();

    const { app: second } = await makeApp({}, {}, config);
    apps.push(second);
    const cookie2 = await loginCookie(second);
    const res = await second.inject({ url: '/api/settings', headers: { cookie: cookie2 } });
    const body = res.json();
    expect(body.settings.bus.stops).toEqual([{ code: '01012', nickname: 'Home', services: ['36A'] }]);
    expect(body.settings.privacy.enabled).toBe(true);
    expect(body.settings.weather.area).toBeNull(); // defaults merged
    expect(body.aiDisclosure).toMatch(/off/);
    expect(Object.keys(body.providerSetup).sort()).toEqual([...PROVIDER_IDS].sort());
  });
});

describe('demo and live modes', () => {
  it('demo: five demo envelopes with data and zero network calls', async () => {
    const fetchImpl = vi.fn();
    const { app } = await makeApp({ DEMO_MODE: 'true' }, { fetchImpl: fetchImpl as never });
    apps.push(app);
    const cookie = await loginCookie(app);
    const body = (await app.inject({ url: '/api/dashboard', headers: { cookie } })).json();
    expect(body.mode).toBe('demo');
    for (const id of PROVIDER_IDS) {
      expect(body.envelopes[id].mode).toBe('demo');
      expect(body.envelopes[id].data).not.toBeNull();
      expect(body.envelopes[id].connection).toBe('connected');
    }
    expect(body.overview.kind).toBe('overview');
    expect(body.overview.bullets.length).toBeLessThanOrEqual(3);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('live with no provider env: needs_setup with null data; DB switched from demo never leaks demo data', async () => {
    const base = await makeConfig();
    const demoCfg = { ...base, demoMode: true };
    const demo = (await makeApp({}, {}, demoCfg)).app;
    const dc = await loginCookie(demo);
    const demoBody = (await demo.inject({ url: '/api/dashboard', headers: { cookie: dc } })).json();
    expect(demoBody.envelopes.lta.data).not.toBeNull();
    await demo.close();

    const { app: live } = await makeApp({}, {}, { ...base, demoMode: false });
    apps.push(live);
    const lc = await loginCookie(live);
    const res = await live.inject({ url: '/api/dashboard', headers: { cookie: lc } });
    expect(res.json().mode).toBe('live');
    for (const id of PROVIDER_IDS) {
      const e = res.json().envelopes[id];
      expect(e.mode).toBe('live');
      if (id === 'weather') {
        // data.gov.sg works keyless: ready to fetch, but nothing has been fetched yet (no demo data).
        expect(e.connection).toBe('connected');
      } else {
        expect(e.connection).toBe('needs_setup');
      }
      expect(e.data).toBeNull();
    }
    expect(res.body).not.toMatch(/\[Demo\]|Demo stop/);
    const snaps = live.desk.db.prepare('SELECT COUNT(*) AS n FROM snapshots').get() as { n: number };
    expect(snaps.n).toBe(0);
    const setup = (await live.inject({ url: '/api/settings', headers: { cookie: lc } })).json().providerSetup;
    expect(setup.lta.configured).toBe(false);
    expect(setup.lta.requirement).toMatch(/LTA_ACCOUNT_KEY/);
  });

  it('refresh/disconnect routes: unknown provider 404, disconnect disables, google connect redirects to needs_setup, callback rejects bad state', async () => {
    const { app } = await makeApp({ DEMO_MODE: 'true' });
    apps.push(app);
    const cookie = await loginCookie(app);
    const h = { ...MUTATE, cookie };
    expect((await app.inject({ method: 'POST', url: '/api/providers/nope/refresh', headers: h })).statusCode).toBe(404);
    const r = await app.inject({ method: 'POST', url: '/api/providers/weather/refresh', headers: h });
    expect([200, 202]).toContain(r.statusCode);
    expect(r.json().status).toBe('cooldown'); // just primed, within 10s spacing
    expect((await app.inject({ method: 'POST', url: '/api/providers/weather/disconnect', headers: h })).statusCode).toBe(204);
    const d = (await app.inject({ url: '/api/dashboard', headers: { cookie } })).json();
    expect(d.envelopes.weather.connection).toBe('disabled');
    expect(d.envelopes.weather.data).toBeNull();
    const gc = await app.inject({ url: '/api/google/connect', headers: { cookie } });
    expect(gc.statusCode).toBe(302);
    expect(gc.headers.location).toBe('/settings?google=needs_setup');
    expect((await app.inject({ url: '/api/google/callback', headers: { cookie } })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/google/callback?code=x&state=bad', headers: { cookie } })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/nope', headers: { cookie } })).json().error.code).toBe('not_found');
    expect((await app.inject({ method: 'POST', url: '/api/briefing', headers: h })).statusCode).toBe(503);
  });
});
