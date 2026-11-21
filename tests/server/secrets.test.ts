import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { cleanupTmp, loginCookie, makeApp, MUTATE, ORIGIN } from './helpers.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  cleanupTmp();
});

const SENTINELS = {
  LTA_ACCOUNT_KEY: 'SENTINEL_LTA_KEY_123',
  DATA_GOV_SG_API_KEY: 'SENTINEL_DATAGOV_KEY_456',
  CANVAS_BASE_URL: 'https://canvas.sentinel-host-789.example',
  CANVAS_ACCESS_TOKEN: 'SENTINEL_CANVAS_TOKEN_789',
  GOOGLE_CLIENT_ID: 'SENTINEL_GOOGLE_ID_111',
  GOOGLE_CLIENT_SECRET: 'SENTINEL_GOOGLE_SECRET_222',
  SESSION_SECRET: 'SENTINEL_SESSION_SECRET_333',
  TOKEN_ENCRYPTION_KEY: Buffer.from('SENTINEL_TOKEN_KEY_0123456789abc').toString('base64'),
};

describe('secrets never leak', () => {
  for (const demo of ['false', 'true']) {
    it(`sentinels absent from responses and logs (DEMO_MODE=${demo})`, async () => {
      let logs = '';
      const logStream = new Writable({
        write(chunk, _enc, cb) {
          logs += chunk.toString();
          cb();
        },
      });
      ({ app } = await makeApp({ ...SENTINELS, DEMO_MODE: demo }, { logStream, logLevel: 'info' }));
      const cookie = await loginCookie(app);
      const bodies: string[] = [];
      for (const url of ['/api/dashboard', '/api/settings', '/api/auth/session', '/api/health']) {
        bodies.push((await app.inject({ url, headers: { cookie } })).body);
      }
      const p = await app.inject({ method: 'PATCH', url: '/api/settings', headers: { ...MUTATE, cookie }, payload: { privacy: { enabled: true } } });
      bodies.push(p.body);
      bodies.push((await app.inject({ method: 'POST', url: '/api/providers/lta/refresh', headers: { ...MUTATE, cookie } })).body);
      await app.inject({ url: '/api/google/callback?code=SENTINEL_OAUTH_CODE&state=s', headers: { origin: ORIGIN } });
      const everything = bodies.join('\n');
      const all = Object.values(SENTINELS).concat('SENTINEL_OAUTH_CODE');
      for (const s of all) {
        expect(everything).not.toContain(s);
        expect(logs).not.toContain(s);
      }
      expect(logs).not.toContain(cookie.split('=')[1] as string);
      expect(logs.length).toBeGreaterThan(0);
    });
  }
});
