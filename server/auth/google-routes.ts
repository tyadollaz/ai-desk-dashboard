import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import { createHttpClient } from '../http/client.js';
import { allowedHostsFor } from '../providers/registry.js';
import { CALENDAR_SCOPE, googleOAuthEnv, postTokenRequest, type GoogleTokens } from '../providers/google/token.js';
import { ProviderError } from '../providers/types.js';
import { SESSION_COOKIE } from './sessions.js';

export const GOOGLE_STATE_COOKIE = 'desk_google_state';
const STATE_TTL_MS = 10 * 60_000;
const MAX_PENDING = 50;

export interface GoogleRouteOptions {
  now: () => Date;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

interface Pending {
  sessionHash: string;
  codeVerifier: string;
  expiresAt: number;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Server-side OAuth authorization-code flow with PKCE. Pending states live in process memory (single process):
 * keyed by the SHA-256 of the state, bound to the owner session, 10-minute expiry, single use.
 * Disconnect clears stored tokens only; tokens are not revoked at Google (the owner can revoke at myaccount.google.com).
 */
export async function registerGoogleRoutes(app: FastifyInstance, opts: GoogleRouteOptions): Promise<void> {
  const pending = new Map<string, Pending>();
  const prune = () => {
    const t = opts.now().getTime();
    for (const [k, v] of pending) if (v.expiresAt <= t) pending.delete(k);
  };
  const cookieOpts = () => ({
    path: '/api/google',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: app.desk.config.secureCookies,
  });
  const clearState = (reply: FastifyReply) => reply.clearCookie(GOOGLE_STATE_COOKIE, cookieOpts());
  const settingsRedirect = (reply: FastifyReply, status: string) => {
    clearState(reply);
    return reply.redirect(`/settings?google=${status}`, 302);
  };
  const invalidState = (reply: FastifyReply) => {
    clearState(reply);
    return reply.code(400).type('text/plain; charset=utf-8').send('Invalid OAuth state');
  };

  app.get('/google/connect', async (req, reply) => {
    const oauth = googleOAuthEnv(app.desk.config.providerEnv);
    if (!oauth) return reply.redirect('/settings?google=needs_setup', 302);
    prune();
    if (pending.size >= MAX_PENDING) pending.clear();
    const client = new OAuth2Client({ clientId: oauth.clientId, clientSecret: oauth.clientSecret, redirectUri: oauth.redirectUri });
    const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
    const state = randomBytes(32).toString('base64url');
    pending.set(sha256(state), {
      sessionHash: sha256(req.cookies[SESSION_COOKIE] ?? ''),
      codeVerifier,
      expiresAt: opts.now().getTime() + STATE_TTL_MS,
    });
    const url = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [CALENDAR_SCOPE],
      state,
      include_granted_scopes: false,
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
    });
    reply.setCookie(GOOGLE_STATE_COOKIE, state, { ...cookieOpts(), maxAge: STATE_TTL_MS / 1000 });
    return reply.redirect(url, 302);
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>('/google/callback', async (req, reply) => {
    // Public route per the guard, so the owner session is checked here.
    const sessionId = req.cookies[SESSION_COOKIE];
    if (!app.desk.sessions.validate(sessionId)) {
      return reply.code(401).type('text/plain; charset=utf-8').send('Sign in required');
    }
    const { code, state, error } = req.query;
    const cookieState = req.cookies[GOOGLE_STATE_COOKIE];
    if (typeof state !== 'string' || !state || typeof cookieState !== 'string' || !safeEqual(state, cookieState)) return invalidState(reply);
    prune();
    const key = sha256(state);
    const entry = pending.get(key);
    pending.delete(key); // single use, even if the rest fails
    if (!entry || entry.expiresAt <= opts.now().getTime() || !safeEqual(entry.sessionHash, sha256(sessionId ?? ''))) return invalidState(reply);

    if (typeof error === 'string' && error) return settingsRedirect(reply, 'denied');
    if (typeof code !== 'string' || !code) return invalidState(reply);
    const oauth = googleOAuthEnv(app.desk.config.providerEnv);
    if (!oauth) return settingsRedirect(reply, 'needs_setup');

    const http = createHttpClient({
      allowedHosts: allowedHostsFor('google', app.desk.config.providerEnv),
      fetchImpl: opts.fetchImpl,
      now: opts.now,
      sleep: opts.sleep,
    });
    let res;
    try {
      res = await postTokenRequest(http, {
        grant_type: 'authorization_code',
        code,
        code_verifier: entry.codeVerifier,
        client_id: oauth.clientId,
        client_secret: oauth.clientSecret,
        redirect_uri: oauth.redirectUri,
      });
    } catch (e) {
      // Never log the code or tokens; only the safe error code.
      app.log.warn({ provider: 'google', code: e instanceof ProviderError ? e.code : 'internal' }, 'google token exchange failed');
      return settingsRedirect(reply, 'failed');
    }

    const existing = (await app.desk.tokens.get('google')) as GoogleTokens | null;
    const refreshToken = res.refresh_token ?? (typeof existing?.refresh_token === 'string' ? existing.refresh_token : undefined);
    if (!refreshToken) return settingsRedirect(reply, 'no_refresh_token');
    await app.desk.tokens.set('google', {
      refresh_token: refreshToken,
      access_token: res.access_token,
      expiry_date: opts.now().getTime() + res.expires_in * 1000,
      scope: res.scope ?? CALENDAR_SCOPE,
    });
    // Re-enable (disconnect disables the provider) and clear any auth-failure block.
    const current = app.desk.settings.get();
    app.desk.settings.patch({ providers: { ...current.providers, google: { enabled: true } } });
    app.desk.manager.onSettingsChanged({ tokensChanged: ['google'] });
    void app.desk.manager.refresh('google', { manual: false }).catch(() => undefined);
    return settingsRedirect(reply, 'connected');
  });
}
