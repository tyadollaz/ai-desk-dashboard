import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

export class ConfigError extends Error {}

export interface Config {
  appOrigin: string;
  port: number;
  host: string;
  databasePath: string;
  sessionSecret: string;
  tokenKey: Buffer;
  /** argon2id hash of the owner password; null when unset. */
  ownerPasswordHash: string | null;
  /** Non-production demo convenience: password "demo" accepted because no hash is set. */
  demoPasswordEnabled: boolean;
  demoMode: boolean;
  nodeEnv: string;
  isProduction: boolean;
  secureCookies: boolean;
  trustProxy: boolean;
  /** Provider-related env vars passed through to adapters (never exposed via the API). */
  providerEnv: Record<string, string | undefined>;
  /** Optional AI briefing provider; `provider` null => unconfigured. */
  llm: { provider: 'anthropic' | null; apiKey: string | null; model: string; dailyCap: number };
  clientDir: string;
  logLevel: string;
  /** Startup warnings to log loudly. */
  warnings: string[];
}

/** PHC string: $argon2id$v=19$m=...,t=...,p=...$salt$hash */
const ARGON2_PHC = /^\$argon2(id|i|d)\$v=\d+\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/;

const PROVIDER_PREFIXES = ['LTA_', 'DATA_GOV_SG_', 'CANVAS_', 'GOOGLE_', 'GARMIN_'];

/** Loads ./.env (if present) without overriding variables already set. */
export function loadDotEnv(file = '.env'): void {
  if (existsSync(file)) process.loadEnvFile(file);
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const errors: string[] = [];
  const warnings: string[] = [];
  const nodeEnv = env.NODE_ENV ?? 'development';
  const isProduction = nodeEnv === 'production';
  const demoMode = env.DEMO_MODE === 'true';

  let appOrigin = 'http://localhost:3000';
  if (isProduction && !env.APP_ORIGIN) errors.push('APP_ORIGIN must be set explicitly in production');
  try {
    const url = new URL(env.APP_ORIGIN || appOrigin);
    appOrigin = url.origin;
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (isProduction && env.APP_ORIGIN && url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
      errors.push('APP_ORIGIN must be an https URL in production (http is only allowed for localhost, 127.0.0.1 or [::1])');
    }
  } catch {
    errors.push('APP_ORIGIN is not a valid URL');
  }

  const port = Number.parseInt(env.PORT || '3000', 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) errors.push('PORT must be an integer between 0 and 65535');

  // Separate DB file per mode by default so demo and live data can never share a file.
  const databasePath = env.DATABASE_PATH || (demoMode ? './data/dashboard-demo.db' : './data/dashboard.db');

  const ownerPasswordHash = env.OWNER_PASSWORD_HASH || null;

  let sessionSecret = env.SESSION_SECRET || '';
  let tokenKey: Buffer | null = null;
  const missing: string[] = [];
  if (!sessionSecret) missing.push('SESSION_SECRET');
  if (env.TOKEN_ENCRYPTION_KEY) {
    const key = Buffer.from(env.TOKEN_ENCRYPTION_KEY, 'base64');
    if (key.length !== 32) errors.push('TOKEN_ENCRYPTION_KEY must be base64 encoding of exactly 32 bytes (run: npm run gen-secret)');
    else tokenKey = key;
  } else missing.push('TOKEN_ENCRYPTION_KEY');
  if (!ownerPasswordHash) missing.push('OWNER_PASSWORD_HASH');

  if (ownerPasswordHash && !ARGON2_PHC.test(ownerPasswordHash)) {
    errors.push('OWNER_PASSWORD_HASH is not a valid argon2 hash (run: npm run hash-password)');
  }
  if (isProduction && sessionSecret && (sessionSecret.length < 32 || sessionSecret === 'replace-me')) {
    errors.push('SESSION_SECRET must be at least 32 characters and not the placeholder value (run: npm run gen-secret)');
  }

  let demoPasswordEnabled = false;
  if (isProduction) {
    if (missing.length) errors.unshift(`Missing required environment variables in production: ${missing.join(', ')}`);
  } else {
    if (!sessionSecret) {
      sessionSecret = randomBytes(32).toString('base64');
      warnings.push('SESSION_SECRET is not set: using an ephemeral random secret (sessions reset on restart).');
    }
    if (!tokenKey && !errors.some((e) => e.startsWith('TOKEN_ENCRYPTION_KEY'))) {
      tokenKey = randomBytes(32);
      warnings.push('TOKEN_ENCRYPTION_KEY is not set: using an ephemeral random key (stored provider tokens become unreadable on restart).');
    }
    if (!ownerPasswordHash) {
      if (demoMode) {
        demoPasswordEnabled = true;
        warnings.push('*** DEMO_MODE is on and OWNER_PASSWORD_HASH is unset: the password "demo" is accepted. Never expose this instance. ***');
      } else {
        warnings.push('OWNER_PASSWORD_HASH is not set: login is refused. Run `npm run hash-password` and put the output in OWNER_PASSWORD_HASH.');
      }
    }
  }

  let llmProvider: 'anthropic' | null = null;
  if (env.LLM_PROVIDER === 'anthropic') llmProvider = 'anthropic';
  else if (env.LLM_PROVIDER) warnings.push('LLM_PROVIDER must be "anthropic" (the only supported value); AI briefing is unavailable.');
  const cap = Number.parseInt(env.AI_DAILY_REQUEST_CAP || '10', 10);
  const dailyCap = Number.isInteger(cap) && cap >= 0 ? cap : 10;

  if (errors.length) throw new ConfigError(`Invalid configuration:\n - ${errors.join('\n - ')}`);

  const providerEnv: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    if (PROVIDER_PREFIXES.some((p) => k.startsWith(p))) providerEnv[k] = v;
  }

  return {
    appOrigin,
    port,
    host: env.HOST || '0.0.0.0',
    databasePath,
    sessionSecret,
    tokenKey: tokenKey ?? randomBytes(32),
    ownerPasswordHash,
    demoPasswordEnabled,
    demoMode,
    nodeEnv,
    isProduction,
    secureCookies: appOrigin.startsWith('https://'),
    trustProxy: env.TRUST_PROXY === 'true',
    providerEnv,
    llm: { provider: llmProvider, apiKey: env.ANTHROPIC_API_KEY || null, model: env.LLM_MODEL || 'claude-opus-5-5', dailyCap },
    clientDir: env.CLIENT_DIST || path.resolve(process.cwd(), 'dist/client'),
    logLevel: env.LOG_LEVEL || 'info',
    warnings,
  };
}
