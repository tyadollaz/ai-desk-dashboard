import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config.js';
import { SESSION_COOKIE, type SessionStore } from './sessions.js';

const PUBLIC: ReadonlySet<string> = new Set([
  'POST /api/auth/login',
  'GET /api/auth/session',
  'GET /api/health',
  'GET /api/google/callback',
]);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const apiError = (reply: FastifyReply, status: number, code: string, message: string) =>
  reply.code(status).send({ error: { code, message } });

export function pathOf(req: FastifyRequest): string {
  return req.url.split('?')[0] ?? req.url;
}

export function isAuthenticated(req: FastifyRequest, sessions: SessionStore): boolean {
  return sessions.validate(req.cookies[SESSION_COOKIE]);
}

/** Origin (or Referer) must match APP_ORIGIN and the custom header must be present on every non-GET /api request. */
export function csrfOk(req: FastifyRequest, config: Config): boolean {
  if (req.headers['x-desk-request'] !== '1') return false;
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin !== 'null') return origin === config.appOrigin;
  const referer = req.headers.referer;
  if (typeof referer === 'string') {
    try {
      return new URL(referer).origin === config.appOrigin;
    } catch {
      return false;
    }
  }
  return false;
}

/** Single onRequest hook: auth (401) first, then CSRF (403) for mutations. */
export function createApiGuard(config: Config, sessions: SessionStore) {
  return async function apiGuard(req: FastifyRequest, reply: FastifyReply) {
    const path = pathOf(req);
    if (!path.startsWith('/api/') && path !== '/api') return;
    const method = req.method.toUpperCase();
    if (!PUBLIC.has(`${method} ${path}`) && !isAuthenticated(req, sessions)) {
      return apiError(reply, 401, 'unauthorized', 'Sign in required');
    }
    if (!SAFE_METHODS.has(method) && !csrfOk(req, config)) {
      return apiError(reply, 403, 'forbidden', 'Missing or invalid request origin');
    }
  };
}
