import { hash } from '@node-rs/argon2';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp, type AppOverrides } from '../../server/app.js';
import { loadConfig, type Config } from '../../server/config.js';

export const PASSWORD = 'correct horse battery';
let cachedHash: string | null = null;
export async function ownerHash(): Promise<string> {
  cachedHash ??= await hash(PASSWORD, { memoryCost: 8192, timeCost: 1, parallelism: 1 });
  return cachedHash;
}

const dirs: string[] = [];
export function tmpDb(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), 'desk-test-'));
  dirs.push(d);
  return path.join(d, 'test.db');
}
export function cleanupTmp(): void {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
}

export const ORIGIN = 'http://localhost:3000';
export const MUTATE = { 'x-desk-request': '1', origin: ORIGIN, 'content-type': 'application/json' };

export class Clock {
  constructor(public t = Date.parse('2026-11-21T04:00:00Z')) {}
  now = () => new Date(this.t);
  advance(ms: number) {
    this.t += ms;
  }
}

export async function makeConfig(extra: Record<string, string | undefined> = {}): Promise<Config> {
  return loadConfig({
    NODE_ENV: 'test',
    APP_ORIGIN: ORIGIN,
    OWNER_PASSWORD_HASH: await ownerHash(),
    DATABASE_PATH: tmpDb(),
    CLIENT_DIST: '/nonexistent',
    ...extra,
  });
}

export async function makeApp(extra: Record<string, string | undefined> = {}, overrides: AppOverrides = {}, config?: Config) {
  const cfg = config ?? (await makeConfig(extra));
  const app = await buildApp(cfg, { logLevel: 'silent', ...overrides });
  return { app, config: cfg };
}

export async function login(app: FastifyInstance, password = PASSWORD) {
  return app.inject({ method: 'POST', url: '/api/auth/login', headers: MUTATE, payload: { password } });
}

export async function loginCookie(app: FastifyInstance): Promise<string> {
  const res = await login(app);
  if (res.statusCode !== 204) throw new Error(`login failed: ${res.statusCode}`);
  const c = res.cookies.find((x) => x.name === 'desk_session');
  return `desk_session=${c?.value}`;
}
