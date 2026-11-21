# AI Desk Dashboard — MVP implementation brief

Prepared 17 November 2026. Intended consumer: Claude Code.

## 1. Outcome and scope

Build a private, single-user dashboard for Aditya in Singapore. Initially ship a responsive browser SPA with a small backend. Later, the same URL should work on a Raspberry Pi display without a frontend rewrite.

The dashboard should answer, at a glance: What is happening today? What is due? When is my bus arriving? What is the weather forecast? What activity has my Garmin recorded?

MVP includes five independently connectable integrations: LTA bus arrivals, Singapore weather, Canvas LMS, Google Calendar, and Garmin. Include an optional, manually generated AI briefing. Deliver a usable application even when only one provider is configured.

Assumptions: one owner; Asia/Singapore display timezone; metric units; Google means Calendar only; read-only access to provider data; an always-running server with persistent storage is available for eventual deployment. These are product choices, not provider requirements.

Defer Gmail, Drive, Google Tasks, writes to calendars or Canvas, training prescriptions, route planning, chat, multi-agent systems, custom layout builders, notifications, physical sensors/buttons, and Raspberry Pi provisioning. Do not add these to make the first release feel more complete.

## 2. Experience and visual direction

Build a quiet, attractive desk display: charcoal background, warm neutral text, one restrained accent, generous spacing, large time/ETA numerals, subtle borders, and minimal animation. Avoid a dense monitoring-console aesthetic. Support light/dark preference, reduced motion, visible keyboard focus, readable contrast, and status conveyed through text as well as color.

Routes:
- `/`: dashboard.
- `/settings`: widget visibility/order using simple up/down buttons, provider connections, bus stops, weather area, calendar IDs, privacy and AI controls.
- `/login`: owner authentication.

Desktop layout:
1. Header: time/date, refresh control, privacy toggle, settings.
2. Briefing strip: up to three concise observations; collapsible.
3. Main grid: Today/Google Calendar and Canvas deadlines take the widest columns; bus and weather cards remain prominent; activity card below or beside them.

At 1440×900, default cards should fit without horizontal scrolling and show their most important information without page scrolling. At 1024×600, prioritize time, next event, next deadline, bus arrivals, and weather; allow scrolling to activity. At 390×844, use a single column. Settings and card expansion can scroll normally. Use large touch targets for a later desk screen.

Each card has a provider label, relevant source/measurement time, last successful fetch, refresh action, and detail link when available. A failed card must not replace the whole page with an error. Privacy mode masks event/assignment titles and health values, including briefing text derived from them; it is a display convenience, not an authentication boundary.

## 3. Functional requirements

### Bus arrivals
Save up to three stops by five-character stop code and optional nickname. Preserve leading zeroes. Optionally filter service numbers as strings. Manual code entry is sufficient for MVP; searchable stop directories are later work.

Show the next three arrivals per service, occupancy labels, and whether an estimate is schedule-based. Use the current documented endpoint `https://datamall2.mytransport.sg/ltaodataservice/v3/BusArrival`, query `BusStopCode`, and server-side `AccountKey` authentication. Read `NextBus`, `NextBus2`, `NextBus3`, `EstimatedArrival`, `Load`, and `Monitored`. The documented feed updates every 20 seconds; use a 30-second application refresh. Round positive durations down; under one minute show “Arriving.” Missing estimates show “No estimate”; missing data alone does not establish that a service has stopped. Source: [LTA API guide, version 6.11](https://datamall.lta.gov.sg/content/dam/datamall/datasets/LTA_DataMall_API_User_Guide.pdf).

Product rules: expire an individual estimate once its timestamp is more than 60 seconds in the past. After 90 seconds without a successful fetch, replace numerical countdowns with “Update needed,” retaining stop/service labels and last-update time. Do not keep an old arrival at zero indefinitely. Keep directional service suffixes distinct.

### Singapore weather
Choose a forecast area from provider metadata; do not assume the user's neighborhood. Use `https://api-open.data.gov.sg/v2/real-time/api/two-hr-forecast`. Normalize the current `data.items` forecast with `area_metadata`, matching by area name and using its validity interval. Display area, forecast text, and “Valid until …”. This endpoint returned a structured response during preparation; that is a schema observation, not an application integration test. [Official API documentation](https://developers.data.gov.sg/datasets?formats=API&resultId=d_3f9e064e25005b0e42969944ccaf2e7a).

For MVP, forecast text and validity are sufficient. The two-hour forecast is not a current temperature reading or rainfall probability. Add temperature only after wiring and labelling a separate documented measurement feed. Support optional server-side `DATA_GOV_SG_API_KEY` and use the documented authentication/rate limits at implementation time. Refresh every five minutes; mark forecasts expired when their validity ends even if the last HTTP request succeeded.

### Canvas deadlines
Connect one institution using a server-configured HTTPS base URL and personal access token, if permitted by the institution. Personal token access is appropriate to this owner's own dashboard; institution-issued developer keys are needed for the OAuth route if later supporting other users. Never request the institution password. [Canvas authentication documentation](https://canvas.instructure.com/doc/api/file.oauth.html).

Use `GET /api/v1/planner/items` for a bounded window: seven days back through fourteen days ahead. Follow all pagination links on the approved Canvas host. Normalize item identity, course, title, date, link and any returned completion state. Planner dates are not universally assignment deadlines. Use assignment metadata when needed to establish actual due dates/status; unknown completion stays unknown. Sources: [Planner](https://developerdocs.instructure.com/services/canvas/resources/planner), [Assignments](https://developerdocs.instructure.com/services/canvas/resources/assignments).

Show “Due soon” sorted by actual deadline, “Past due — check status” when completion is unknown, and a separate undated group only for undated items actually returned. Respect user-specific due dates and distinguish a personal planner reminder from a submission deadline. Completion/submission/grading are different concepts; hide an item as finished only on supported evidence. No grade display or completion writes in MVP. Label the coverage window; do not imply this bounded fetch inventories every unresolved item in Canvas. Deduplicate by provider item identity, never title alone. Link to Canvas for detail. Refresh every ten minutes.

### Google Calendar
Use server-side OAuth authorization-code flow, requesting offline access for refresh tokens, with state verification and a maintained Google auth library. Request `https://www.googleapis.com/auth/calendar.events.readonly`; start with `primary`, optionally accept explicitly entered calendar IDs. Calendar-list discovery would require an additional scope and is deferred. Sources: [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth), [web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server).

Read `events.list` for today through the next seven days with `singleEvents=true`, `orderBy=startTime`, and pagination. Show next event and today's agenda; expanded view shows the full window. Preserve all-day dates, exclusive end dates, recurring instances, cancellation state and timezone-aware timestamps. Exclude declined/cancelled events. Distinct events with the same name remain distinct. [Events API](https://developers.google.com/workspace/calendar/api/v3/reference/events/list).

Refresh every five minutes. Reauthorization errors show a reconnect action. Document that external OAuth apps in Testing may have short-lived refresh tokens; production readiness includes confirming the consent configuration applicable to the owner's account. [Google token lifecycle](https://developers.google.com/identity/protocols/oauth2).

### Garmin
Target Garmin's official **Personal** access route for the owner's own data. The current public overview describes obtaining a personal API key through Garmin Connect and generating access tokens, with pull access to activity and health JSON and activity FIT data. This differs from Business access. [Garmin program overview](https://developer.garmin.com/gc-developer-program/overview/).

Before writing live Garmin requests, obtain the Personal documentation available to the owner and establish the exact token flow, endpoint URLs, scopes/permissions, quotas, pagination, date semantics, and accessible metrics. Those details were not verified for this brief. Do not invent REST paths or substitute Business webhook behavior. Do not collect a Garmin password or silently introduce an unofficial scraping library.

Desired MVP display, subject to documented availability:
- Latest activity: type, start time, duration, distance, source link if supplied.
- Running distance this Singapore calendar week, Monday through now.
- Steps today and most recent sleep duration, each labelled with its actual date.
- Resting heart rate as optional detail if available; Body Battery/readiness are future additions unless explicitly supported.

Store/deduplicate activity IDs; reconcile edits within the fetched window. Fetch the full supported current-week interval before presenting a weekly total as complete; show “Partial week data” when coverage is incomplete. Missing metrics remain unavailable, never zero. A successful fetch is not evidence that the watch has synced today. Display source timestamp/coverage separately. Poll at most hourly by default, adjusted to documented limits.

If Personal access or documentation is unavailable, ship the Garmin adapter interface, labelled fixtures, settings/status UI, and tests. The live adapter must report `needs_setup` or `unsupported` with the exact unmet requirement. Mark Garmin live integration incomplete in the handoff. This is an allowed delivery limitation, not permission to claim the requested integration works.

### Optional AI briefing
Default to a deterministic overview: next event, nearest known deadline, and current valid forecast. Call it “Overview.” It works without model credentials.

Provide “Generate AI briefing” only after the owner enables it and configures one model provider. Implement one provider, not a model router; if unspecified, leave the LLM adapter unconfigured and document required settings. Use current official documentation when adding that provider.

Show at most three bullets, with source chips and generation time. Input is a minimal normalized snapshot; calendar/Canvas titles require explicit opt-in for external AI, and Garmin health data has a separate off-by-default toggle. Exclude tokens, descriptions, attendees, routes and location traces. Explain exactly what will be transmitted in settings. Imported content is data, not instructions; the briefing has no tools and cannot write to integrations.

Compute dates, durations and totals in code. Require structured output referencing input fact IDs; reject unknown IDs and unsupported numerical claims, otherwise fall back to the deterministic overview. This validation limits errors but does not prove semantic correctness. Briefing tests should include invented facts and malicious event titles. Exclude bus countdowns from generated prose because they expire quickly. Invalidate generated content when input facts change or after 30 minutes, and show the deterministic overview until regenerated. No automatic paid model calls; enforce a configurable daily request cap, default 10. Invalid output is rendered as text, never executable HTML.

## 4. Architecture

For a new repository, use React + TypeScript + Vite for the SPA; Node.js + TypeScript + Fastify for the same-origin API/static server; SQLite on a persistent volume; Zod for boundary validation; Vitest for unit/integration tests and Playwright for browser tests. These are chosen implementation defaults. If an existing repository has equivalent conventions, preserve them and explain material differences. Pin supported dependency versions when implementing.

One application process serves compiled frontend assets, `/api/*`, and provider adapters. Prefer a single deployable container on a persistent server; ephemeral static-only hosting cannot run this design. No Redis, microservices, WebSockets or background job platform are needed.

Suggested structure:
```
client/                 # SPA and widget components
server/auth/            # owner sessions; Google connection flow
server/providers/       # lta, weather, canvas, google, garmin
server/briefing/        # deterministic overview; optional LLM
server/storage/         # migrations, settings, tokens, cache
shared/                 # normalized contracts and validation
tests/fixtures/         # synthetic, schema-labelled payloads
tests/e2e/
```

Persist settings, encrypted OAuth tokens, bounded normalized snapshots, and sync metadata. Store static provider secrets in deployment environment/secret files. Keep the encryption key outside SQLite and the repository. Settings UI changes non-secret preferences and connection actions; avoid building a generic secrets editor.

Suggested API surface, all protected except login, non-sensitive health status and the state-validated OAuth callback:
- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/session`.
- `GET /api/dashboard`: cached normalized widget envelopes; never waits for every provider's upstream network call.
- `GET /api/settings`, `PATCH /api/settings`.
- `POST /api/providers/:provider/refresh`: coalesced and throttled; return immediately with accepted/cached status.
- `POST /api/providers/:provider/disconnect`: disable provider and remove cached data/dynamic tokens; document removal of static environment secrets separately.
- `GET /api/google/connect`, `GET /api/google/callback`.
- `POST /api/briefing`: explicitly requested, capped model generation.
- `GET /api/health`: minimal process readiness without account data.

Define a shared envelope with separate dimensions:
```
provider
mode: live | demo
connection: connected | needs_setup | reauth_required | unsupported | disabled
fetchState: idle | fetching | ok | error
freshness: fresh | stale | expired | unknown
data: normalized payload | null
lastAttemptAt, lastSuccessAt, sourceUpdatedAt, validUntil
coverage: optional date range and complete/partial flag
error: optional safe code and next-step message
```

An empty successful dataset is valid data, not an error. Authentication failure and data freshness can coexist: show the reconnect action and label any retained snapshot stale. Keep timestamp instants in UTC internally; retain date-only fields as dates and render with Asia/Singapore. Store distance in metres and duration in seconds. Preserve unknowns as null.

## 5. Refresh, caching and failure behavior

The refresh intervals below are application defaults, not statements of provider quotas:

| Provider | Minimum normal refresh interval | Stale/expired behavior |
|---|---|---|
| LTA | 30 seconds while dashboard visible | Suppress countdown after 90 seconds |
| Weather | 5 minutes while visible | Stale after 15 minutes without successful fetch; expired at forecast validity end |
| Calendar | 5 minutes while visible | Stale after 15 minutes |
| Canvas | 10 minutes while visible | Stale after 30 minutes |
| Garmin | 60 minutes while visible | Sync stale after 2 hours; separately show measurement age and coverage |

Use browser visibility to trigger/suspend refresh requests. Server-side TTL and one in-flight request per provider/configuration prevent repeated tabs from multiplying upstream calls. On reopen, show cached results and request providers that are due. An always-visible desk display naturally keeps refreshing. Background sync while closed is not required for MVP.

Use a 10-second upstream timeout, bounded retries with jitter for network/5xx errors, respect `Retry-After` on 429, and stop retrying invalid credentials. Manual refresh cannot bypass quota cooldowns. Mark paginated results partial if the bounded page/time budget is exceeded; never silently claim complete coverage. Keep last successful snapshots on transient failures; partial failures must not erase successfully loaded cards. Automatically remove normalized private records outside the current display window plus a seven-day buffer. Logout clears frontend caches and visible content; no private service-worker caching.

## 6. Private deployment and configuration

Use one owner password with a maintained password-hashing library and server-side sessions. Provision the password hash outside source control. There is no public registration. Use HttpOnly, SameSite cookies with Secure enabled under HTTPS, session expiration/logout, login rate limiting, and CSRF/origin checks for mutations. Google authorization grants Calendar access; it is separate from owner dashboard authentication.

Every provider secret stays on the server: no frontend build variables containing secrets, localStorage tokens, logged authorization headers, or tokens in URLs. Validate provider responses and user configuration. Restrict Canvas requests and pagination to the administrator-configured HTTPS institution host, reject redirects to other hosts and private/link-local targets. Provider API hosts are fixed; there is no arbitrary fetch proxy. Render provider strings as text and allow only safe external link protocols. Return private API responses with `Cache-Control: no-store`; the application-owned server cache remains private behind auth.

Create `.env.example` with placeholders and document at least:
- `APP_ORIGIN`, `PORT`, `DATABASE_PATH`, `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`, `OWNER_PASSWORD_HASH`.
- `LTA_ACCOUNT_KEY`, optional `DATA_GOV_SG_API_KEY`.
- `CANVAS_BASE_URL`, `CANVAS_ACCESS_TOKEN`.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.
- Garmin credential variables only after the Personal flow is verified; label any temporary placeholders unimplemented.
- Optional model provider/key/model identifier and request cap.

Owner inputs needed for live setup: preferred stops/services; weather area; Canvas URL/token; Google Cloud OAuth application and exact redirect URI; calendar IDs (default primary); Garmin Personal credentials/documentation; optional LLM credentials; deployment domain. Ask for secrets through deployment configuration, never a committed document or chat transcript.

Provide Dockerfile, persistent-volume setup, migrations, backup/restore instructions and a reverse-proxy HTTPS example. State the supported deployment target and avoid promising a particular hosting vendor's free tier. App/API share one origin; SPA routes work on direct reload. Production startup fails clearly if owner authentication or encryption secrets are absent. Demo mode can run locally without provider credentials; a hosted demo must remain separate from private production data.

## 7. Implementation order and exit criteria

1. **Inspect and scaffold.** Read repository instructions, confirm stack, create shared contracts and clearly labelled synthetic fixtures. Exit: all cards render in demo mode with zero credentials and no upstream calls.
2. **Secure app shell.** Add sessions, settings persistence, SQLite migrations, status handling and responsive layout. Exit: anonymous API requests fail; authenticated settings survive restart; demo does not leak into live mode.
3. **Public-context adapters.** Add LTA and weather. Exit: contract tests pass; real smoke checks are recorded only where credentials/access allow.
4. **Personal-account adapters.** Add Canvas and Google, then Garmin once its contract is verified. Exit: each provider has tests for valid, empty, expired credentials, rate-limited and malformed responses; unavailable access is documented per provider.
5. **Briefing.** Add deterministic overview, optional configured LLM, opt-in data controls and validation. Exit: the dashboard remains useful with AI disabled or failing.
6. **Deployment and verification.** Finish browser tests, build/container checks and README. Exit: local production build passes; live verification status and remaining owner steps are explicit. Prepare deployment artifacts, but do not purchase infrastructure, authorize accounts or publish without the owner's deployment instruction.

## 8. Acceptance tests

Use executable tests for consequential behavior, not snapshots of implementation details. Fixtures must be synthetic or sanitized and identify the official schema/version they exercise. Tests involving time use a controlled clock.

| Test | Observable pass condition |
|---|---|
| Unconfigured start | Demo renders with a banner; live mode shows setup states, never synthetic personal data |
| Independent cards | A timed-out Canvas response leaves bus/weather/calendar responsive |
| Authentication | Anonymous private API requests are denied; invalid OAuth state is rejected; logout invalidates the session |
| Secrets | Sentinel test credentials are absent from compiled client assets, API payloads and captured logs |
| Bus calculation | A 119-second ETA displays 1 min; 45 seconds displays Arriving; blank estimate displays No estimate; >90-second-old cache hides countdowns |
| Weather validity | An expired interval remains expired even after a successful fetch of the same old forecast |
| Canvas | User-specific deadline, pagination, unknown completion, actual submitted state and no-due-date fixtures render correctly without claiming universal deadline coverage |
| Calendar | Recurring instances, cross-midnight events, exclusive all-day end dates, declined/cancelled events and duplicate names behave correctly |
| Google lifecycle | Expired access token refreshes in a mocked flow; revoked refresh token yields reconnect without a retry loop |
| Garmin | Missing health values remain null; duplicate activities count once; Monday boundary is Singapore time; incomplete week fetch is visibly partial |
| Rate limits | Repeated clicks/tabs coalesce upstream work and honor a supplied Retry-After |
| AI | Disabled mode makes zero model calls; excluded health data never enters request payloads; unknown fact IDs/fabricated numbers trigger fallback |
| Persistence | Restart preserves settings and valid server-held connection state; disconnect clears provider snapshots and tokens |
| Browser | At 1440×900, 1024×600 and 390×844: no horizontal overflow, usable navigation/focus, visible stale/setup/error labels, functioning privacy mode |
| Build | Typecheck, relevant tests, production build and container startup pass with documented commands |

After credentials are configured, compare one chosen stop against a contemporaneous LTA response, one forecast against its published validity, several deadlines against Canvas, calendar events against Google, and available activity metrics against Garmin for the same date/window. Bus estimates change; compare timestamps and reasonable timing drift, not screenshots taken minutes apart. Record observed discrepancies and coverage gaps.

Completion report must distinguish: implemented, fixture-tested, live-verified, and blocked by access. Passing fixture tests does not mean all five live integrations work.

## 9. Deliverables expected from Claude Code

- Working SPA and same-origin backend, migrations, fixture mode and relevant automated tests.
- Setup README with exact run/build/test commands, environment configuration, provider connection steps and deployment instructions.
- `.env.example`, container files and backup/restore notes without secrets.
- Brief verification report listing provider status, commands actually run, live comparisons performed, and unresolved requirements.

## 10. Brief provenance and deepen-task record

Format choice: an executable implementation brief combines a small PRD with integration contracts, decision boundaries and acceptance tests. It is more useful for this coding handoff than a market-oriented PRD or a long unconstrained prompt. The app itself has not been built or deployed.

Four depth improvements:
1. Professional practice: scope the first release and explicitly design authentication, independent failures and freshness.
2. Raw material: official API documentation and observed public weather JSON; personal credentials and account-specific Garmin documentation remain unavailable.
3. Methods/tools: source comparison, provider adapters, normalized contracts, fixture tests and browser verification; tests are specified here, not claimed executed.
4. Independent validation: executable acceptance tests plus comparisons against provider records after connection; source review alone cannot establish live correctness.

Reusable rewritten request:
> Create a Claude Code implementation brief for a basic, single-user AI desk dashboard, initially deployed as a responsive web SPA with a secure backend. Include LTA bus arrivals, Singapore weather, Canvas deadlines, Google Calendar, Garmin activity/health data, and a concise optional AI briefing. Use official documentation to verify authentication, available data and access constraints. Assume Calendar-only Google integration and Asia/Singapore display time. Credentials, preferred stops, Canvas URL and Garmin account access are not supplied. Specify MVP behavior, architecture, adapters, refresh/freshness, secret handling, deployment, milestones and executable acceptance criteria. Support partially connected integrations and clearly labelled demo data. Separate verified documentation from assumptions and access-dependent work. Deliver a Markdown handoff and short launch prompt; do not build or deploy the application.

Verification limits: official LTA guide, Google OAuth/Calendar docs, Canvas resources, Garmin public overview and Singapore weather documentation were reviewed. The public weather endpoint returned JSON through the web research tool. No private account API was called, no credentials were tested, and no application tests or independent specialist review were performed. Recheck provider documentation when implementing, especially Garmin's account-visible Personal API details.
