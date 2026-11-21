# AI Desk Dashboard

A private, single-user dashboard for one owner in Singapore. It is a React single-page app served by a Fastify server on the same origin, with SQLite for storage. Five cards show live data: LTA bus arrivals, weather, Canvas deadlines, Google Calendar events and Garmin training metrics. An optional AI briefing can summarise them; it is off unless you configure and enable it.

The app runs in one of two modes:

- **Live mode** uses your real provider credentials and the database file `data/dashboard.db`.
- **Demo mode** (`DEMO_MODE=true`) uses synthetic data, shows a banner, contacts no provider, and uses a separate database file, `data/dashboard-demo.db`. Demo and live data never share a file.

Integration status (what has been verified against real services) is kept as a local report, `docs/INTEGRATION-STATUS.md`, which is not committed because it records personal account data.

## Requirements

- Node >= 22.12 and npm.
- Docker, only for the container deployment.

## Quick start (demo)

```
npm install
DEMO_MODE=true npm run dev
```

Open http://localhost:5173 and log in with the password `demo`. The `demo` password is accepted only outside production, only in demo mode, and only when `OWNER_PASSWORD_HASH` is unset.

If you already have a live `.env`, the server loads it in demo mode too (values set on the command line win). To keep demo fully separate from your real setup, override the relevant values:

```
DEMO_MODE=true NODE_ENV=development DATABASE_PATH=./data/dashboard-demo.db OWNER_PASSWORD_HASH= npm run dev
```

## Run live locally

1. Create the env file: `cp .env.example .env` (or edit the one you have). For local use set `APP_ORIGIN=http://localhost:3000`, `NODE_ENV=development` or leave it unset, and `DATABASE_PATH=./data/dashboard.db`.
2. `npm run set-password` prompts for a password twice and writes the argon2id hash into `.env` as `OWNER_PASSWORD_HASH`.
3. `npm run gen-secret` prints a random base64 value. Run it twice and paste the results into `SESSION_SECRET` and `TOKEN_ENCRYPTION_KEY`.
4. `npm run build && npm start`, then open http://localhost:3000.

With `NODE_ENV=production` the server refuses to start if `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY` or `OWNER_PASSWORD_HASH` is missing. Outside production it generates ephemeral secrets and logs a warning, so sessions and stored tokens do not survive a restart.

After logging in, open Settings and:

- add a bus stop (5 digits; leading zeros are kept);
- choose a weather area;
- click Connect Google Calendar (after completing the Google setup below).

## Provider setup

Each provider is configured by environment variables in `.env`, then restarted. Only the server reads these values.

### LTA DataMall (bus arrivals)

1. Request an account key at https://datamall.lta.gov.sg.
2. Set `LTA_ACCOUNT_KEY`.
3. In Settings add up to 3 bus stops. A service filter per stop is optional.

### Weather

Uses data.gov.sg and works without a key. An optional `DATA_GOV_SG_API_KEY` raises rate limits. For the v2 real-time endpoints the limits are 6, 12 and 30 requests per 10 seconds for no key, a development key and a production key. Choose the area in Settings.

### Canvas

1. In Canvas: Account, Settings, Approved Integrations, New Access Token.
2. Set `CANVAS_BASE_URL` (https only), for example `https://canvas.nus.edu.sg`, and `CANVAS_ACCESS_TOKEN`.
3. Never use your password. If the New Access Token button is missing, your institution has disabled personal tokens.
4. Revoke the token in Canvas when you no longer want the dashboard to read it.

### Google Calendar

1. In the Google Cloud Console, create or choose a project and enable the Google Calendar API.
2. Open Google Auth Platform (OAuth consent screen). Set the user type to External.
3. Add the scope `calendar.events.readonly`.
4. Add your own Google account as a test user.
5. Create an OAuth client of type Web application.
6. Add an authorised redirect URI that exactly equals `GOOGLE_REDIRECT_URI`: `http://localhost:3000/api/google/callback` locally, or `https://<domain>/api/google/callback` when deployed.
7. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REDIRECT_URI`, restart, then use Settings, Connect Google Calendar.

Google will show "Google hasn't verified this app". That is expected for your own unverified app; continue past it.

Important: while the consent screen is in Testing status, Google issues refresh tokens that expire after 7 days, so you must reconnect weekly. Publishing the app to In production avoids that. Confirm Google's current policy for your account, as it can change.

### Garmin

1. Create a Personal API key at https://connect.garmin.com/app/settings/personalApiToken. Choose an expiry of 30, 90, 180 or 365 days. The key is shown once.
2. Set `GARMIN_PERSONAL_API_KEY`.
3. The server exchanges the key for 24-hour access tokens and caches them encrypted. Endpoints follow Garmin's Personal API Swagger documentation, saved at `docs/garmin-personal-api.pdf`.
4. Personal use only.

### AI briefing (optional)

1. Set `LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, and optionally `LLM_MODEL` (default `claude-opus-5-5`) and `AI_DAILY_REQUEST_CAP` (default 10).
2. Enable the briefing in Settings. Configuring the key alone does nothing.
3. It never runs automatically. Calendar and assignment titles, and Garmin health data, each need their own explicit opt-in. Settings shows exactly what is sent. Bus data is never sent.
4. The model output is validated against fact IDs and numbers from the dashboard. If validation fails, the deterministic Overview is shown instead.

## Environment variables

| Name | Required | Purpose |
|---|---|---|
| `APP_ORIGIN` | Yes for deploy | Public origin, must match the browser URL. `https://` enables Secure cookies. Default `http://localhost:3000`. |
| `DOMAIN` | Compose only | Domain Caddy requests a certificate for. |
| `PORT` | No | Listen port. Default 3000. |
| `HOST` | No | Listen address. Default 0.0.0.0. |
| `DATABASE_PATH` | No | SQLite file. Default `./data/dashboard.db`, or `./data/dashboard-demo.db` in demo mode. Compose uses `/data/dashboard.db`. |
| `NODE_ENV` | No | `production` enforces required secrets. |
| `DEMO_MODE` | No | `true` for synthetic data only. |
| `LOG_LEVEL` | No | fatal, error, warn, info, debug or trace. Default info. |
| `TRUST_PROXY` | No | `true` behind a reverse proxy so the client IP comes from X-Forwarded-For. |
| `SESSION_SECRET` | Production | Session and cookie signing secret. |
| `TOKEN_ENCRYPTION_KEY` | Production | Base64 of exactly 32 bytes. Encrypts stored provider tokens. |
| `OWNER_PASSWORD_HASH` | Production | Argon2id hash of the owner password. Single-quote it in `.env` because it contains `$`. |
| `LTA_ACCOUNT_KEY` | For bus | LTA DataMall account key. |
| `DATA_GOV_SG_API_KEY` | No | Raises weather rate limits. |
| `CANVAS_BASE_URL` | For Canvas | Canvas base URL, https only. |
| `CANVAS_ACCESS_TOKEN` | For Canvas | Canvas personal access token. |
| `GOOGLE_CLIENT_ID` | For Google | OAuth client ID. |
| `GOOGLE_CLIENT_SECRET` | For Google | OAuth client secret. |
| `GOOGLE_REDIRECT_URI` | For Google | Must exactly match the URI registered in Google Cloud. |
| `GARMIN_PERSONAL_API_KEY` | For Garmin | Garmin Personal API key. |
| `LLM_PROVIDER` | For AI | Only `anthropic` is supported. |
| `ANTHROPIC_API_KEY` | For AI | Anthropic API key. |
| `LLM_MODEL` | No | Default `claude-opus-5-5`. |
| `AI_DAILY_REQUEST_CAP` | No | Maximum briefing requests per day. Default 10. |

## Tests

```
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
```

- `npm test` runs the Vitest unit and integration tests.
- `npm run test:e2e` builds the app, then starts a demo server on port 4173 and a live-mode server (with no real credentials) on port 4174. Set `E2E_SKIP_BUILD=1` to reuse an existing build.
- An opt-in live smoke test calls the real providers using your `.env`: `LIVE_SMOKE=1 npx vitest run tests/server/live-smoke.test.ts`. The bus stop defaults to 44351; override with `SMOKE_BUS_STOP`. This file is newly written and has had little use.

## Deployment

The supported target is one always-on Linux server running Docker Compose with a persistent volume. That can be a VPS or a home server; a Raspberry Pi (arm64) is plausible but untested. Static hosting does not work because the app needs the server and database. No specific vendor or free tier is promised.

The Docker image has not yet been built or run. Docker was not available on the build machine, so treat the steps below as unverified.

1. Install Docker and the Compose plugin on the server.
2. Copy the repository to the server.
3. Create `.env` with production values: `APP_ORIGIN=https://<domain>`, `DOMAIN=<domain>`, `DATABASE_PATH=/data/dashboard.db`, `TRUST_PROXY=true`, `NODE_ENV=production`, plus the secrets and provider keys above.
4. Point the domain's DNS at the server and open ports 80 and 443.
5. Run `docker compose -f deploy/docker-compose.yml up -d --build`. The compose file header suggests also passing `--env-file .env`, which `DOMAIN` interpolation needs when `.env` is not picked up automatically.
6. Caddy obtains an HTTPS certificate automatically. The app itself is published on 127.0.0.1:3000 only.
7. Change the Google redirect URI, in Google Cloud and in `GOOGLE_REDIRECT_URI`, to the https one, then reconnect.

A hosted demo must be a separate deployment with its own database and `DEMO_MODE=true`. Never use the private deployment for it.

## Backup and restore

Run from the repository root:

- `deploy/backup.sh [output-dir]` writes a consistent online copy of the database to `backups/dashboard-<UTC timestamp>.db` (or the directory you give).
- `deploy/restore.sh <backup-file.db>` stops the app, replaces the database in the volume and starts the app again.

These scripts have not been run against a real volume.

`TOKEN_ENCRYPTION_KEY` is not in the backup. Back it up separately, for example in a password manager, and never store it with database backups. If it is lost, the stored Google token cannot be read and you must reconnect Google. The Garmin access token is re-derived from the key and `GARMIN_PERSONAL_API_KEY`, so it recovers on its own. A restored database works only with the key in use when it was written.

## Security notes

- One owner password, hashed with argon2id.
- Server-side sessions in HttpOnly, SameSite=Lax cookies, Secure when `APP_ORIGIN` is https. Sessions last 30 days absolute and 7 days idle.
- Login rate limiting.
- CSRF protection through a required `X-Desk-Request` header plus an Origin check.
- Provider secrets stay on the server and are never sent to the browser.
- Stored tokens are encrypted at rest with AES-256-GCM.
- Outbound requests go only to a fixed allow-list of provider hosts.
- Responses carry `Cache-Control: no-store` and a Content-Security-Policy.
- Privacy mode hides values on screen. It is a display convenience, not access control.
- Disconnect in Settings removes cached data and stored tokens. Secrets set in `.env` are not touched; remove them yourself.

## Project layout

- `client/` React single-page app.
- `server/auth/` password, sessions, CSRF, rate limiting.
- `server/providers/<id>/` one adapter per provider (`canvas`, `garmin`, `google`, `lta`, `weather`), plus the shared manager and registry.
- `server/briefing/` optional AI briefing and its validation.
- `server/storage/` SQLite access.
- `shared/` types shared by client and server.
- `tests/server`, `tests/client`, `tests/e2e`, `tests/fixtures` tests and recorded provider fixtures.
- `deploy/` Compose file, Caddyfile, backup and restore scripts.
- `docs/` integration status and the Garmin API reference.

The verification record is kept locally in `docs/INTEGRATION-STATUS.md` (not committed).
