import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { cleanupTmp, login, loginCookie, makeApp, MUTATE } from './helpers.js';

const verifySpy = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../../server/auth/password.js', async (orig) => {
  const mod = await orig<typeof import('../../server/auth/password.js')>();
  return {
    ...mod,
    checkOwnerPassword: async (...args: Parameters<typeof mod.checkOwnerPassword>) => {
      verifySpy.calls++;
      return mod.checkOwnerPassword(...args);
    },
  };
});

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
  cleanupTmp();
});

const GET_PATHS = [
  '/%61pi/dashboard',
  '/%61pi/settings',
  '/%41PI/dashboard',
  '/%41pi/settings',
  '/api/%64ashboard',
  '/api/%73ettings',
  '//api/dashboard',
  '/api//dashboard',
  '/api/./dashboard',
  '/api/../api/dashboard',
  '/API/dashboard',
  '/api/dashboard/',
  '/%61pi/google/connect',
];

describe('guard bypass attempts', () => {
  it('never serves private GET routes without a session', async () => {
    ({ app } = await makeApp({ DEMO_MODE: 'true' }));
    for (const url of GET_PATHS) {
      const res = await app.inject({ method: 'GET', url });
      expect([200, 204], `${url} -> ${res.statusCode}`).not.toContain(res.statusCode);
      expect(res.body).not.toContain('envelopes');
    }
  });

  it('never accepts mutations without session or CSRF headers', async () => {
    ({ app } = await makeApp({ DEMO_MODE: 'true' }));
    for (const url of ['/%61pi/providers/lta/disconnect', '/%41PI/providers/lta/disconnect', '/api/providers/%6cta/disconnect', '//api/providers/lta/disconnect']) {
      for (const headers of [{}, MUTATE]) {
        const res = await app.inject({ method: 'POST', url, headers });
        expect([200, 202, 204], `${url} -> ${res.statusCode}`).not.toContain(res.statusCode);
      }
    }
    const patch = await app.inject({ method: 'PATCH', url: '/%61pi/settings', headers: MUTATE, payload: {} });
    expect([200, 204]).not.toContain(patch.statusCode);
  });

  it('authenticated private responses carry no-store; encoded paths do not weaken that', async () => {
    ({ app } = await makeApp({ DEMO_MODE: 'true' }));
    const cookie = await loginCookie(app);
    for (const url of ['/api/dashboard', '/api/settings', '/api/dashboard-missing', '/%61pi/dashboard', '/%41PI/nothing']) {
      const res = await app.inject({ url, headers: { cookie } });
      expect(res.headers['cache-control'], url).toBe('no-store');
    }
    const anon = await app.inject('/api/dashboard');
    expect(anon.statusCode).toBe(401);
    expect(anon.headers['cache-control']).toBe('no-store');
  });
});

describe('login rate limit under concurrency', () => {
  it('20 parallel wrong-password logins: at most 5 reach the password check, the rest get 429', async () => {
    ({ app } = await makeApp());
    verifySpy.calls = 0;
    const results = await Promise.all(Array.from({ length: 20 }, () => login(app!, 'wrong')));
    expect(verifySpy.calls).toBeLessThanOrEqual(5);
    expect(results.filter((r) => r.statusCode === 401)).toHaveLength(5);
    expect(results.filter((r) => r.statusCode === 429)).toHaveLength(15);
  });
});
