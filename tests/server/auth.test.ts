import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { cleanupTmp, Clock, login, loginCookie, makeApp, MUTATE, ORIGIN } from './helpers.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
  cleanupTmp();
});

describe('authentication', () => {
  it('denies anonymous private requests; health and session are public', async () => {
    ({ app } = await makeApp({ DEMO_MODE: 'true' }));
    expect((await app.inject('/api/dashboard')).statusCode).toBe(401);
    expect((await app.inject('/api/settings')).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/providers/lta/refresh', headers: MUTATE })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/providers/lta/disconnect', headers: MUTATE })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/providers/lta/refresh' })).statusCode).toBe(401);
    const health = await app.inject('/api/health');
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: 'ok' });
    const session = await app.inject('/api/auth/session');
    expect(session.statusCode).toBe(200);
    expect(session.json()).toEqual({ authenticated: false, mode: 'demo' });
    expect(health.headers['cache-control']).toBe('no-store');
  });

  it('wrong password -> 401, 6th failed attempt -> 429 with Retry-After', async () => {
    const clock = new Clock();
    ({ app } = await makeApp({}, { now: clock.now }));
    for (let i = 0; i < 5; i++) expect((await login(app, 'nope')).statusCode).toBe(401);
    const blocked = await login(app, 'nope');
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    // even the right password is refused while blocked
    expect((await login(app)).statusCode).toBe(429);
    clock.advance(16 * 60_000);
    expect((await login(app)).statusCode).toBe(204);
  });

  it('correct login sets a hardened cookie that works; logout invalidates it', async () => {
    ({ app } = await makeApp());
    const res = await login(app);
    expect(res.statusCode).toBe(204);
    const cookie = res.cookies.find((c) => c.name === 'desk_session');
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(cookie?.secure).toBeFalsy();
    const headers = { cookie: `desk_session=${cookie?.value}` };
    expect((await app.inject({ url: '/api/settings', headers })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/auth/session', headers })).json().authenticated).toBe(true);
    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { ...MUTATE, ...headers } });
    expect(out.statusCode).toBe(204);
    expect((await app.inject({ url: '/api/settings', headers })).statusCode).toBe(401);
  });

  it('cookie is Secure when APP_ORIGIN is https', async () => {
    ({ app } = await makeApp({ APP_ORIGIN: 'https://desk.example.com' }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { ...MUTATE, origin: 'https://desk.example.com' },
      payload: { password: 'correct horse battery' },
    });
    expect(res.statusCode).toBe(204);
    expect(res.cookies.find((c) => c.name === 'desk_session')?.secure).toBe(true);
  });

  it('sessions expire after 7 idle days and 30 absolute days', async () => {
    const clock = new Clock();
    ({ app } = await makeApp({}, { now: clock.now }));
    const cookie = await loginCookie(app);
    clock.advance(6 * 86_400_000);
    expect((await app.inject({ url: '/api/settings', headers: { cookie } })).statusCode).toBe(200);
    clock.advance(8 * 86_400_000);
    expect((await app.inject({ url: '/api/settings', headers: { cookie } })).statusCode).toBe(401);
    const cookie2 = await loginCookie(app);
    for (let i = 0; i < 4; i++) {
      clock.advance(6 * 86_400_000);
      expect((await app.inject({ url: '/api/settings', headers: { cookie: cookie2 } })).statusCode).toBe(200);
    }
    clock.advance(6 * 86_400_000);
    expect((await app.inject({ url: '/api/settings', headers: { cookie: cookie2 } })).statusCode).toBe(401);
  });
});

describe('CSRF', () => {
  it('rejects mutations without X-Desk-Request or with a foreign Origin', async () => {
    ({ app } = await makeApp());
    const cookie = await loginCookie(app);
    const patch = (headers: Record<string, string>) =>
      app!.inject({ method: 'PATCH', url: '/api/settings', headers: { cookie, 'content-type': 'application/json', ...headers }, payload: { privacy: { enabled: true } } });
    expect((await patch({ origin: ORIGIN })).statusCode).toBe(403);
    expect((await patch({ 'x-desk-request': '1', origin: 'https://evil.example' })).statusCode).toBe(403);
    expect((await patch({ 'x-desk-request': '1' })).statusCode).toBe(403);
    expect((await patch({ 'x-desk-request': '1', referer: `${ORIGIN}/settings` })).statusCode).toBe(200);
    expect((await patch({ 'x-desk-request': '1', origin: ORIGIN })).statusCode).toBe(200);
    // login too
    const bad = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/json', origin: ORIGIN }, payload: { password: 'x' } });
    expect(bad.statusCode).toBe(403);
  });
});

describe('config', () => {
  const PROD = {
    NODE_ENV: 'production',
    APP_ORIGIN: 'https://desk.example.com',
    SESSION_SECRET: 's'.repeat(40),
    OWNER_PASSWORD_HASH: '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNo',
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  };

  it('production startup fails listing missing secrets and invalid key length', async () => {
    const { loadConfig } = await import('../../server/config.js');
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/SESSION_SECRET, TOKEN_ENCRYPTION_KEY, OWNER_PASSWORD_HASH/);
    expect(() => loadConfig({ ...PROD, TOKEN_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') })).toThrow(/32 bytes/);
    expect(loadConfig(PROD).warnings).toEqual([]);
  });

  it('production requires an explicit APP_ORIGIN, https unless localhost', async () => {
    const { loadConfig } = await import('../../server/config.js');
    expect(() => loadConfig({ ...PROD, APP_ORIGIN: undefined })).toThrow(/APP_ORIGIN must be set/);
    expect(() => loadConfig({ ...PROD, APP_ORIGIN: 'http://desk.example.com' })).toThrow(/https/);
    expect(() => loadConfig({ ...PROD, APP_ORIGIN: 'http://192.168.1.5:3000' })).toThrow(/https/);
    for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000', 'https://desk.example.com']) {
      expect(loadConfig({ ...PROD, APP_ORIGIN: origin }).appOrigin).toBe(origin);
    }
  });

  it('validates the password hash format and session secret strength', async () => {
    const { loadConfig } = await import('../../server/config.js');
    expect(() => loadConfig({ ...PROD, OWNER_PASSWORD_HASH: 'plaintext' })).toThrow(/argon2/);
    expect(() => loadConfig({ ...PROD, OWNER_PASSWORD_HASH: '$2b$10$abcdefghijklmnopqrstuv' })).toThrow(/argon2/);
    expect(() => loadConfig({ ...PROD, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
    expect(() => loadConfig({ ...PROD, SESSION_SECRET: 'replace-me' })).toThrow(/SESSION_SECRET/);
  });

  it('non-production: demo password only for DEMO_MODE without a hash; live without hash refuses login', async () => {
    const { loadConfig } = await import('../../server/config.js');
    const demo = loadConfig({ DEMO_MODE: 'true' });
    expect(demo.demoPasswordEnabled).toBe(true);
    expect(demo.warnings.join(' ')).toMatch(/"demo"/);
    const live = loadConfig({});
    expect(live.demoPasswordEnabled).toBe(false);
    expect(live.warnings.join(' ')).toMatch(/hash-password/);
    ({ app } = await makeApp({ OWNER_PASSWORD_HASH: undefined, DATABASE_PATH: undefined } as never, {}, { ...live, databasePath: (await makeApp()).config.databasePath }));
    const res = await login(app, 'demo');
    expect(res.statusCode).toBe(503);
  });
});
