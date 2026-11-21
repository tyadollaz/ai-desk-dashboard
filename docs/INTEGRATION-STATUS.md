# Integration status

Date: 21 November 2026. This is the completion report for the build brief. "Live-verified" means checked against the real service. Anything not listed as live-verified has only been tested against fixtures.

## Summary

| Provider | Implemented | Fixture-tested | Live-verified | Blocked or remaining |
|---|---|---|---|---|
| LTA bus arrivals | Yes | Yes | Yes (21 Nov 2026) | LTA status for an invalid key and behaviour for an invalid stop code are unverified |
| Weather | Yes | Yes | Yes, public endpoint | Owner's area not yet chosen or compared; `x-api-key` with a real key unverified |
| Canvas (NUS) | Yes | Yes | Yes, small sample | Owner to compare more deadlines; some fields inferred |
| Google Calendar | Yes | Yes | No | Owner has not yet connected in the browser |
| Garmin | Yes | Yes | Yes, partly | No real sleep value observed yet |
| AI briefing | Yes | Yes, fake model | No | No `ANTHROPIC_API_KEY`; no real model call made |
| Deployment | Files written | n/a | Partly | Docker image not built or run; backup and restore not executed |

## LTA bus arrivals

- Implemented.
- Fixture-tested: valid response, empty, auth failure, rate limit, malformed, per-stop partial failure, suffix services, leading-zero stop codes.
- Live-verified 21 Nov 2026 at 16:15 SGT against stop 44351. Adapter output was compared with a raw LTA BusArrival v3 response taken 8 seconds later. They matched exactly for services 966, 972M and 973: arrival times, load (SEA), and monitored/scheduled flags. An empty third estimate for 972M is shown as "No estimate".
- Unverified: the HTTP status LTA returns for an invalid key, and its behaviour for an invalid stop code.
- Source: LTA DataMall API User Guide v6.11 (30 Oct 2026).

## Weather

- Implemented.
- Fixture-tested, including expiry after a successful fetch.
- Live-verified 21 Nov 2026 against the public endpoint without a key: 47 areas returned, valid period 15:30 to 17:30 SGT.
- Not done: comparing the owner's chosen area with the published forecast page, because the area has not been chosen.
- Unverified: the `x-api-key` header with a real key.

## Canvas (NUS)

- Implemented.
- Fixture-tested: user-specific due date through assignment lookup, pagination, a next link to a foreign host is not followed, page budget gives a partial result, unknown completion, submitted, marked complete, reminders, undated items, dedupe by id, relative URLs.
- Live-verified 21 Nov 2026 with the owner's token on canvas.nus.edu.sg: 2 items from 2 courses in the 14 Nov to 5 Dec window (1 submitted, 1 graded), with full coverage.
- Remaining: the sample is small. The owner should compare several deadlines with Canvas itself.
- Fields not in the official docs and inferred: `plannable_date` semantics, `context_name`, `submissions.submitted`, and the `workflow_state` values of submissions.
- Announcements and dismissed items are excluded by design.

## Google Calendar

- Implemented: OAuth code flow with PKCE, single-use state bound to the session, encrypted refresh token, token refresh, and `invalid_grant` leading to a reconnect prompt without a retry loop. Events use `events.list` with `singleEvents`, `orderBy` and pagination. Declined and cancelled events are excluded.
- Fixture-tested: recurring instances, cross-midnight events, exclusive all-day end dates, duplicate titles, pagination, token refresh, revoked token.
- Not live-verified. The owner has created the OAuth client and set the env vars but has not yet completed Connect Google Calendar in the browser.
- Remaining: connect, then compare events for the next 7 days with Google Calendar. Confirm whether the consent screen is in Testing or In production, since Testing refresh tokens expire after 7 days.

## Garmin

- Implemented from Garmin's official Personal API Swagger export (`docs/garmin-personal-api.pdf`): token exchange (`POST personal-api-key/token`, ApiKey header, returns a 24 h JWT), activity search, daily steps, daily sleep summaries, daily heart rate.
- Fixture-tested: token caching, expiry and retry; rejected key; rate limit; malformed response; per-metric failure; pagination bound giving a partial week; dedupe; Monday boundary in SGT; null values.
- Live-verified 21 Nov 2026 with the owner's key. All calls returned HTTP 200.
  - Latest activity: a run on 14 Nov 2026, 23.59 km, 3 h 34 min.
  - Weekly running distance: 0 m with complete coverage (no runs this week).
  - Resting heart rate: 59, dated 20 Nov.
  - Steps for 21 Nov and sleep for 20 and 21 Nov came back null from Garmin, so a real sleep value has not been observed.
- Discrepancies from the Swagger file: the token endpoint returns `text/plain` (a bare JWT), not JSON; sleep timestamps are epoch milliseconds, not date-time strings.
- Remaining: compare metrics with Garmin Connect for the same day once the watch has synced; confirm what sleep `calendarDate` means; rate limits are undocumented, so the app polls at most hourly.

## AI briefing

- Implemented with Anthropic: official SDK, structured output, validation, fallback to the deterministic Overview, daily cap, and opt-in filters.
- Fixture-tested with a fake model: disabled gives zero calls, health and title exclusion, unknown fact IDs, fabricated numbers, malicious titles, cap, invalidation, refusal.
- Not live-verified. No `ANTHROPIC_API_KEY` is configured and no real model call was made.

## Deployment

- Written: Dockerfile, Compose file with Caddy HTTPS, backup and restore scripts.
- Verified locally: production start fails fast without secrets, and health returns OK with them.
- Not done: the Docker image has not been built or run (Docker is not installed on the build machine). The backup and restore scripts have not been executed against a real volume.

## Commands run

Final run, 21 November 2026, on macOS with Node 22.23.1:

| Command | Result |
|---|---|
| `npm run typecheck` (client, server and test configs) | Pass |
| `npx vitest run` | Pass: 16 files, 168 tests passed; 5 skipped (the opt-in live smoke tests) |
| `npx playwright test` (builds first; demo server on 4173 plus a live-mode server with sentinel credentials on 4174) | Pass: 15 of 15, at 1440×900, 1024×600 and 390×844 |
| `npm run build` | Pass (run as part of the Playwright step) |
| `NODE_ENV=production node dist/server/server/index.js` with no `.env` and no secrets | Exits 1: "Missing required environment variables in production: SESSION_SECRET, TOKEN_ENCRYPTION_KEY, OWNER_PASSWORD_HASH" and "APP_ORIGIN must be set explicitly in production" |
| The same command with the owner's `.env` | Starts in live mode and listens on 127.0.0.1:3000 |
| Live checks (LTA stop 44351 compared with a raw response, weather, Canvas, Garmin) | See the provider table above |
| `docker build` / `docker compose up` | Not run: Docker is not installed on the build machine |

Sentinel secrets (`SENTINEL_*`) were absent from the compiled client assets, from the `/api/dashboard`, `/api/settings` and `/api/auth/session` responses, and from server logs captured at debug level.

## Security review

An independent code review found:

- a critical authentication bypass through percent-encoded `/api` paths;
- a login rate-limit race;
- gaps in production config validation;
- AI briefing toggle staleness;
- LTA per-stop data loss;
- omission of cross-midnight events from today's agenda;
- manager cooldown and freshness issues.

All of these were fixed and covered by regression tests before this report:

- **Auth bypass (critical):** every `/api` route is now registered in one encapsulated plugin. The guard decides from the matched route (`routeOptions.url`) and fails closed, rather than reading the raw URL. `tests/server/guard-bypass.test.ts` covers `/%61pi/...`, `/%41PI/...`, `/api/%64ashboard`, `//api/...`, `/api/./...`, `/api/../api/...` and mixed-case variants for GET, POST and PATCH. All private responses carry `Cache-Control: no-store`.
- **Login rate limit:** each attempt is counted before the password is verified. In a test of 20 concurrent wrong passwords, only 5 reached verification and the other 15 got 429. The limiter tracks at most 1,000 IPs.
- **Production config:** production requires an explicit `APP_ORIGIN`, which must be https except on localhost. It also requires a valid argon2 PHC hash, and a `SESSION_SECRET` of at least 32 characters that isn't the placeholder.
- **AI briefing:** a stored briefing is hidden as soon as AI is disabled, or if the titles or health toggle differs from when it was generated.
- **LTA:** if one stop fails, that stop keeps its previous arrivals with the error shown, so its card isn't blanked.
- **Calendar:** "Today" now includes timed events that started yesterday and are still running.
- **Refresh manager:**
  - Editing settings no longer clears a Retry-After cooldown.
  - The block after an auth failure is lifted only when that provider's config or tokens change.
  - A retained snapshot is shown as stale while reconnection is required.
  - LTA and weather now honour the manager's abort signal.
- **Client privacy:** the dashboard renders masked until the owner's privacy setting has loaded, so titles can't flash unmasked.
- **Canvas throttling:** a 403 whose body says "Rate Limit Exceeded", or with `X-Rate-Limit-Remaining` at or below 0, is treated as a rate limit, not an authentication failure.

## Known limitations

- The SSRF host check is name-based. It does not resolve DNS.
- Privacy mode is display-only, not access control.
- The AI briefing is held in memory and is lost on restart.
- Canvas coverage is bounded to 7 days back and 14 days ahead.
- There is no background sync while the app is closed.

## Owner next steps

1. Connect Google Calendar and compare the next 7 days of events; confirm Testing versus In production status.
2. Compare several Canvas deadlines and the Garmin metrics with the source apps, once the watch has synced.
3. Pick a weather area and compare it with the published forecast.
4. Optionally configure the AI briefing.
5. Choose the deployment domain and server, then build and run the Docker image.
