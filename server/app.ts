import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Writable } from 'node:stream';
import { z } from 'zod';
import {
  PROVIDER_IDS,
  settingsPatchSchema,
  type DashboardResponse,
  type ProviderId,
  type RefreshResponse,
  type SessionResponse,
  type Settings,
  type SettingsResponse,
} from '../shared/contracts.js';
import { checkOwnerPassword } from './auth/password.js';
import { createLoginLimiter } from './auth/rate-limit.js';
import { createSessionStore, SESSION_ABSOLUTE_MS, SESSION_COOKIE, type SessionStore } from './auth/sessions.js';
import { apiError, createApiGuard, isApiPath } from './auth/guards.js';
import { registerGoogleRoutes } from './auth/google-routes.js';
import { createAnthropicModel } from './briefing/anthropic.js';
import { createBriefingService, describeAiDisclosure as buildAiDisclosure, NOT_CONFIGURED_REASON, type BriefingModel } from './briefing/ai.js';
import { buildOverview } from './briefing/overview.js';
import type { Config } from './config.js';
import { ProviderManager } from './providers/manager.js';
import { createAdapters, type AdapterMap } from './providers/registry.js';
import type { TokenStore } from './providers/types.js';
import { openDb, type Db } from './storage/db.js';
import { runMigrations } from './storage/migrations.js';
import { startRetention } from './storage/retention.js';
import { createSettingsStore, type SettingsStore } from './storage/settings.js';
import { createSnapshotStore } from './storage/snapshots.js';
import { createSyncMetaStore } from './storage/sync-meta.js';
import { createTokenStore } from './storage/tokens.js';

export interface DeskContext {
  config: Config;
  db: Db;
  settings: SettingsStore;
  tokens: TokenStore;
  sessions: SessionStore;
  manager: ProviderManager;
}

declare module 'fastify' {
  interface FastifyInstance {
    desk: DeskContext;
  }
}

export interface AppOverrides {
  now?: () => Date;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  adapters?: Partial<AdapterMap>;
  /** Capture log output (tests). */
  logStream?: Writable;
  logLevel?: string;
  /** Inject a fake AI model (tests). */
  briefingModel?: BriefingModel;
}

const loginBody = z.object({ password: z.string().min(1).max(1024) });

export async function buildApp(config: Config, overrides: AppOverrides = {}): Promise<FastifyInstance> {
  const now = overrides.now ?? (() => new Date());
  const app = Fastify({
    trustProxy: config.trustProxy,
    logger: {
      level: overrides.logLevel ?? config.logLevel,
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]', 'headers.authorization', 'headers.cookie', 'set-cookie'],
      serializers: {
        // Drop query strings (OAuth callback carries code/state).
        req: (req: { method?: string; url?: string; hostname?: string; ip?: string }) => ({
          method: req.method,
          url: (req.url ?? '').split('?')[0],
          hostname: req.hostname,
          remoteAddress: req.ip,
        }),
      },
      ...(overrides.logStream ? { stream: overrides.logStream } : {}),
    },
  });

  for (const w of config.warnings) app.log.warn(w);

  const db = openDb(config.databasePath);
  runMigrations(db);
  const settings = createSettingsStore(db, now);
  const llm = config.llm;
  const briefingModel: BriefingModel | null =
    overrides.briefingModel ?? (llm.provider === 'anthropic' && llm.apiKey ? createAnthropicModel({ apiKey: llm.apiKey, model: llm.model }) : null);
  const briefings = createBriefingService({
    db,
    now,
    model: briefingModel,
    unconfiguredReason: llm.provider === 'anthropic' ? 'AI briefing not configured: ANTHROPIC_API_KEY is not set' : NOT_CONFIGURED_REASON,
    dailyCap: llm.dailyCap,
  });
  const tokens = createTokenStore(db, config.tokenKey, now);
  const sessions = createSessionStore(db, config.sessionSecret, now);
  const adapters = createAdapters(config, { now, fetchImpl: overrides.fetchImpl, sleep: overrides.sleep, tokens, overrides: overrides.adapters });
  const manager = new ProviderManager({
    adapters,
    mode: config.demoMode ? 'demo' : 'live',
    settings,
    snapshots: createSnapshotStore(db),
    syncMeta: createSyncMetaStore(db),
    tokens,
    now,
    log: { warn: (obj, msg) => app.log.warn(obj, msg) },
  });
  const limiter = createLoginLimiter(now);
  app.decorate('desk', { config, db, settings, tokens, sessions, manager });

  const stopRetention = startRetention(db, now);
  app.addHook('onClose', async () => {
    stopRetention();
    db.close();
  });

  await app.register(fastifyCookie);

  // Tolerate empty JSON bodies (e.g. POST with Content-Type but no payload).
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (body === '') return done(null, undefined);
    try {
      done(null, JSON.parse(body as string));
    } catch {
      const err = new Error('Invalid JSON') as Error & { statusCode: number };
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
    );
    if (isApiPath(req)) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  const mode = config.demoMode ? 'demo' : 'live';

  // All API routes live in one encapsulated plugin: its hooks authenticate every request that reaches it
  // (decided from the matched route, not the raw URL) and mark every response no-store.
  await app.register(
    async (api) => {
      api.addHook('onRequest', createApiGuard(config, sessions));
      api.addHook('onSend', async (_req, reply, payload) => {
        reply.header('Cache-Control', 'no-store');
        return payload;
      });
      api.setNotFoundHandler(async (_req, reply) => apiError(reply, 404, 'not_found', 'Not found'));

      // ---------- auth ----------
      api.post('/auth/login', async (req, reply) => {
        const body = loginBody.safeParse(req.body);
        if (!body.success) return apiError(reply, 400, 'bad_request', 'Password is required');
        // Reserve the attempt synchronously, before the (async) argon2 verify, so parallel requests cannot bypass the limit.
        const wait = limiter.attempt(req.ip);
        if (wait > 0) {
          reply.header('Retry-After', String(wait));
          return apiError(reply, 429, 'rate_limited', 'Too many failed attempts; try again later');
        }
        const check = await checkOwnerPassword(config, body.data.password);
        if (check === 'not_configured') {
          limiter.release(req.ip);
          req.log.warn('Login refused: OWNER_PASSWORD_HASH is not set. Run `npm run hash-password` and set OWNER_PASSWORD_HASH.');
          return apiError(reply, 503, 'needs_setup', 'Owner password is not configured on the server');
        }
        if (check === 'bad') return apiError(reply, 401, 'invalid_credentials', 'Incorrect password');
        limiter.reset(req.ip);
        const session = sessions.create();
        reply.setCookie(SESSION_COOKIE, session.id, {
          httpOnly: true,
          sameSite: 'lax',
          secure: config.secureCookies,
          path: '/',
          maxAge: SESSION_ABSOLUTE_MS / 1000,
        });
        return reply.code(204).send();
      });

      api.post('/auth/logout', async (req, reply) => {
        sessions.destroy(req.cookies[SESSION_COOKIE]);
        reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: config.secureCookies });
        return reply.code(204).send();
      });

      api.get('/auth/session', async (req): Promise<SessionResponse> => ({
        authenticated: sessions.validate(req.cookies[SESSION_COOKIE]),
        mode,
      }));

      api.get('/health', async () => ({ status: 'ok' }));

      // ---------- dashboard ----------
      api.get('/dashboard', async (): Promise<DashboardResponse> => {
        const envelopes = (await manager.getEnvelopes()) as DashboardResponse['envelopes'];
        const t = now();
        return {
          mode,
          serverTime: t.toISOString(),
          envelopes,
          overview: buildOverview(envelopes, settings.get(), t),
          aiBriefing: briefings.current(envelopes, settings.get()),
          ai: briefings.availability(settings.get()),
        };
      });

      // Explicit only: never called from the dashboard route or any timer.
      api.post('/briefing', async (_req, reply) => {
        const envelopes = (await manager.getEnvelopes()) as DashboardResponse['envelopes'];
        const s = settings.get();
        const result = await briefings.generate(envelopes, s);
        if (result.status === 'unavailable') return apiError(reply, 503, 'needs_setup', result.message);
        if (result.status === 'rate_limited') return apiError(reply, 429, 'rate_limited', 'Daily AI briefing limit reached');
        return { briefing: result.briefing, ai: briefings.availability(s) };
      });

      // ---------- settings ----------
      const settingsResponse = async (): Promise<SettingsResponse> => {
        const s = settings.get();
        const providerSetup = {} as SettingsResponse['providerSetup'];
        for (const id of PROVIDER_IDS) {
          let st;
          try {
            st = await (adapters[id] as { setupStatus(s: Settings): Promise<{ connection: string; requirement: string | null }> }).setupStatus(s);
          } catch {
            st = { connection: 'needs_setup', requirement: 'Provider setup check failed' };
          }
          providerSetup[id] = { configured: st.connection === 'connected', requirement: st.requirement };
        }
        return { settings: s, providerSetup, aiDisclosure: buildAiDisclosure(s, { modelName: llm.model, dailyCap: llm.dailyCap, configured: briefingModel !== null }) };
      };

      api.get('/settings', async () => settingsResponse());

      api.patch('/settings', async (req, reply) => {
        const parsed = settingsPatchSchema.safeParse(req.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: { code: 'invalid_settings', message: 'Settings are invalid', issues: parsed.error.issues } });
        }
        try {
          settings.patch(parsed.data);
        } catch (e) {
          if (e instanceof z.ZodError) {
            return reply.code(400).send({ error: { code: 'invalid_settings', message: 'Settings are invalid', issues: e.issues } });
          }
          throw e;
        }
        manager.onSettingsChanged();
        return settingsResponse();
      });

      // ---------- providers ----------
      const parseProvider = (v: unknown): ProviderId | null => (PROVIDER_IDS as readonly string[]).includes(v as string) ? (v as ProviderId) : null;

      api.post<{ Params: { provider: string } }>('/providers/:provider/refresh', async (req, reply) => {
        const id = parseProvider(req.params.provider);
        if (!id) return apiError(reply, 404, 'not_found', 'Unknown provider');
        const status = await manager.refresh(id, { manual: true });
        const body: RefreshResponse = { status, envelope: await manager.getEnvelope(id) };
        return reply.code(status === 'accepted' ? 202 : 200).send(body);
      });

      api.post<{ Params: { provider: string } }>('/providers/:provider/disconnect', async (req, reply) => {
        const id = parseProvider(req.params.provider);
        if (!id) return apiError(reply, 404, 'not_found', 'Unknown provider');
        await manager.disconnect(id);
        return reply.code(204).send();
      });

      await registerGoogleRoutes(api, { now, fetchImpl: overrides.fetchImpl, sleep: overrides.sleep });
    },
    { prefix: '/api' },
  );

  // ---------- static SPA ----------
  const indexFile = path.join(config.clientDir, 'index.html');
  const hasClient = existsSync(indexFile);
  if (hasClient) await app.register(fastifyStatic, { root: config.clientDir });

  app.setNotFoundHandler(async (req, reply) => {
    if (hasClient && (req.method === 'GET' || req.method === 'HEAD') && !isApiPath(req)) {
      return reply.type('text/html; charset=utf-8').sendFile('index.html');
    }
    return apiError(reply, 404, 'not_found', 'Not found');
  });

  if (config.demoMode) await manager.prime();

  return app;
}
