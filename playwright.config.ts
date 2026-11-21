import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { hash } from '@node-rs/argon2';
import { defineConfig, devices } from '@playwright/test';

// Two servers: demo (4173, password "demo") and live-without-credentials (4174, password LIVE_PASSWORD).
// The config is evaluated in the main process and again in each worker; the build and the run id
// are therefore guarded through environment variables that workers inherit.
export const DEMO_PORT = 4173;
export const LIVE_PORT = 4174;
export const LIVE_PASSWORD = 'live-e2e-password';

const root = process.cwd();
const runId = (process.env.E2E_RUN_ID ??= String(Date.now()));
const stateDir = path.join(root, 'test-results', 'e2e-state'); // outside Playwright's outputDir so it is not wiped
mkdirSync(path.join(stateDir, 'logs'), { recursive: true });

if (!process.env.E2E_BUILT && !process.env.E2E_SKIP_BUILD) {
  execSync('npm run build', { cwd: root, stdio: 'inherit' });
}
process.env.E2E_BUILT = '1';

const ownerHash = await hash(LIVE_PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1 });

// The server loads ./.env without overriding variables that are already set, so blank everything
// the developer's real .env might define; otherwise e2e would depend on (and use) real credentials.
const ISOLATED: Record<string, string> = Object.fromEntries(
  ['SESSION_SECRET', 'TOKEN_ENCRYPTION_KEY', 'OWNER_PASSWORD_HASH', 'LTA_ACCOUNT_KEY', 'DATA_GOV_SG_API_KEY', 'CANVAS_BASE_URL', 'CANVAS_ACCESS_TOKEN',
    'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'GARMIN_PERSONAL_API_KEY', 'LLM_PROVIDER', 'ANTHROPIC_API_KEY', 'LLM_MODEL',
    'AI_DAILY_REQUEST_CAP', 'HOST', 'TRUST_PROXY'].map((k) => [k, '']),
);

const start = 'node dist/server/server/index.js';
const log = (name: string) => `> "${path.join(stateDir, 'logs', name)}" 2>&1`;

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results/artifacts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${DEMO_PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `${start} ${log('demo.log')}`,
      url: `http://localhost:${DEMO_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...ISOLATED,
        DEMO_MODE: 'true',
        NODE_ENV: 'development',
        PORT: String(DEMO_PORT),
        DATABASE_PATH: path.join(stateDir, `demo-${runId}.db`),
        APP_ORIGIN: `http://localhost:${DEMO_PORT}`,
      },
    },
    {
      command: `${start} ${log('live.log')}`,
      url: `http://localhost:${LIVE_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...ISOLATED,
        DEMO_MODE: 'false',
        NODE_ENV: 'development',
        PORT: String(LIVE_PORT),
        LOG_LEVEL: 'debug',
        DATABASE_PATH: path.join(stateDir, `live-${runId}.db`),
        APP_ORIGIN: `http://localhost:${LIVE_PORT}`,
        OWNER_PASSWORD_HASH: ownerHash,
        LTA_ACCOUNT_KEY: 'SENTINEL_LTA_9f3',
        CANVAS_ACCESS_TOKEN: 'SENTINEL_CANVAS_9f3',
        GOOGLE_CLIENT_SECRET: 'SENTINEL_GOOGLE_9f3',
        CANVAS_BASE_URL: 'https://canvas.invalid.example',
      },
    },
  ],
});
