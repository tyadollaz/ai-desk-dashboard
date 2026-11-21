import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupTmp, loginCookie, makeApp } from './helpers.js';

const ENV = { GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'csecret', GOOGLE_REDIRECT_URI: 'http://localhost:3000/api/google/callback' };
const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
  cleanupTmp();
});

interface Call {
  url: string;
  body: URLSearchParams;
}
const okToken = () => new Response(JSON.stringify({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: 'x' }), { status: 200 });

async function boot(tokenResponse: () => Response = okToken, env: Record<string, string | undefined> = ENV) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL, init: RequestInit = {}) => {
    if (new URL(String(input)).hostname === 'oauth2.googleapis.com') calls.push({ url: String(input), body: new URLSearchParams(String(init.body ?? '')) });
    return tokenResponse();
  }) as typeof fetch;
  // Only the OAuth code exchange counts; the post-connect refresh may also hit the calendar API.
  const { app } = await makeApp(env, { fetchImpl });
  apps.push(app);
  const cookie = await loginCookie(app);
  return { app, cookie, calls };
}

async function startFlow(app: FastifyInstance, cookie: string) {
  const res = await app.inject({ method: 'GET', url: '/api/google/connect', headers: { cookie } });
  const loc = new URL(res.headers.location as string);
  const stateCookie = res.cookies.find((c) => c.name === 'desk_google_state');
  return { res, loc, state: loc.searchParams.get('state')!, stateCookie: `desk_google_state=${stateCookie?.value}` };
}

describe('google oauth routes', () => {
  it('connect requires a session', async () => {
    const { app } = await boot();
    const res = await app.inject({ method: 'GET', url: '/api/google/connect' });
    expect(res.statusCode).toBe(401);
  });

  it('connect redirects to settings when env is missing', async () => {
    const { app, cookie } = await boot(okToken, {});
    const res = await app.inject({ method: 'GET', url: '/api/google/connect', headers: { cookie } });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/settings?google=needs_setup');
  });

  it('connect redirects to Google with state, scope, offline access and PKCE', async () => {
    const { app, cookie } = await boot();
    const { res, loc, state } = await startFlow(app, cookie);
    expect(res.statusCode).toBe(302);
    expect(loc.origin).toBe('https://accounts.google.com');
    expect(loc.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/calendar.events.readonly');
    expect(loc.searchParams.get('access_type')).toBe('offline');
    expect(loc.searchParams.get('prompt')).toBe('consent');
    expect(loc.searchParams.get('client_id')).toBe('cid');
    expect(loc.searchParams.get('code_challenge_method')).toBe('S256');
    expect(loc.searchParams.get('code_challenge')).toBeTruthy();
    expect(state.length).toBeGreaterThanOrEqual(40);
    const sc = res.cookies.find((c) => c.name === 'desk_google_state')!;
    expect(sc.value).toBe(state);
    expect(sc.httpOnly).toBe(true);
    expect(String(sc.sameSite).toLowerCase()).toBe('lax');
  });

  it('callback rejects missing, wrong and mismatched state without a token exchange', async () => {
    const { app, cookie, calls } = await boot();
    const f = await startFlow(app, cookie);
    const hit = (qs: string, c: string) => app.inject({ method: 'GET', url: `/api/google/callback?${qs}`, headers: { cookie: c } });
    expect((await hit('code=abc', `${cookie}; ${f.stateCookie}`)).statusCode).toBe(400);
    expect((await hit('code=abc&state=wrong', `${cookie}; ${f.stateCookie}`)).statusCode).toBe(400);
    expect((await hit(`code=abc&state=${f.state}`, cookie)).statusCode).toBe(400); // no state cookie
    const r = await hit('code=abc&state=nope', `${cookie}; desk_google_state=nope`); // cookie matches but never issued
    expect(r.statusCode).toBe(400);
    expect(r.body).toBe('Invalid OAuth state');
    expect(calls).toHaveLength(0);
  });

  it('callback requires the owner session', async () => {
    const { app, cookie, calls } = await boot();
    const f = await startFlow(app, cookie);
    const res = await app.inject({ method: 'GET', url: `/api/google/callback?code=abc&state=${f.state}`, headers: { cookie: f.stateCookie } });
    expect(res.statusCode).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('valid callback stores tokens, redirects, and the state is single-use', async () => {
    const { app, cookie, calls } = await boot();
    const f = await startFlow(app, cookie);
    const headers = { cookie: `${cookie}; ${f.stateCookie}` };
    const res = await app.inject({ method: 'GET', url: `/api/google/callback?code=the-code&state=${f.state}`, headers });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/settings?google=connected');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://oauth2.googleapis.com/token');
    expect(calls[0]!.body.get('code')).toBe('the-code');
    expect(calls[0]!.body.get('code_verifier')).toBeTruthy();
    expect(calls[0]!.body.get('grant_type')).toBe('authorization_code');
    expect(await app.desk.tokens.get('google')).toMatchObject({ refresh_token: 'RT', access_token: 'AT' });
    expect(res.body).not.toContain('RT');
    const again = await app.inject({ method: 'GET', url: `/api/google/callback?code=the-code&state=${f.state}`, headers });
    expect(again.statusCode).toBe(400);
    expect(calls).toHaveLength(1);
  });

  it('callback with error=access_denied redirects to denied without exchanging', async () => {
    const { app, cookie, calls } = await boot();
    const f = await startFlow(app, cookie);
    const res = await app.inject({
      method: 'GET',
      url: `/api/google/callback?error=access_denied&state=${f.state}`,
      headers: { cookie: `${cookie}; ${f.stateCookie}` },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/settings?google=denied');
    expect(calls).toHaveLength(0);
  });

  it('missing refresh token: keeps existing, else no_refresh_token', async () => {
    const noRt = () => new Response(JSON.stringify({ access_token: 'AT2', expires_in: 3600 }), { status: 200 });
    const { app, cookie } = await boot(noRt);
    let f = await startFlow(app, cookie);
    let res = await app.inject({ method: 'GET', url: `/api/google/callback?code=c&state=${f.state}`, headers: { cookie: `${cookie}; ${f.stateCookie}` } });
    expect(res.headers.location).toBe('/settings?google=no_refresh_token');
    expect(await app.desk.tokens.get('google')).toBeNull();
    await app.desk.tokens.set('google', { refresh_token: 'OLD' });
    f = await startFlow(app, cookie);
    res = await app.inject({ method: 'GET', url: `/api/google/callback?code=c&state=${f.state}`, headers: { cookie: `${cookie}; ${f.stateCookie}` } });
    expect(res.headers.location).toBe('/settings?google=connected');
    expect(await app.desk.tokens.get('google')).toMatchObject({ refresh_token: 'OLD', access_token: 'AT2' });
  });
});
