// Normalized contracts shared by server and client.
// Conventions: instants are ISO-8601 UTC strings; date-only values are "YYYY-MM-DD";
// distance in metres; duration in seconds; unknown values are null (never 0).
import { z } from 'zod';

export const PROVIDER_IDS = ['lta', 'weather', 'canvas', 'google', 'garmin'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export type Mode = 'live' | 'demo';
export type Connection = 'connected' | 'needs_setup' | 'reauth_required' | 'unsupported' | 'disabled';
export type FetchState = 'idle' | 'fetching' | 'ok' | 'error';
export type Freshness = 'fresh' | 'stale' | 'expired' | 'unknown';

export interface Coverage {
  start: string; // ISO instant or date
  end: string;
  complete: boolean;
}

export type SafeErrorCode =
  | 'needs_setup'
  | 'unsupported'
  | 'auth_failed'
  | 'reauth_required'
  | 'rate_limited'
  | 'timeout'
  | 'network'
  | 'upstream'
  | 'malformed'
  | 'partial'
  | 'internal';

export interface SafeError {
  code: SafeErrorCode;
  /** Human-readable next step. Must never contain secrets or raw upstream bodies. */
  message: string;
}

export interface WidgetEnvelope<T = unknown> {
  provider: ProviderId;
  mode: Mode;
  connection: Connection;
  fetchState: FetchState;
  freshness: Freshness;
  data: T | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  sourceUpdatedAt: string | null;
  validUntil: string | null;
  coverage: Coverage | null;
  error: SafeError | null;
  /** Earliest time a manual refresh will reach upstream (quota/Retry-After cooldown). */
  nextAllowedRefreshAt: string | null;
  /** Provider-hosted page for details, http(s) only. */
  detailUrl: string | null;
}

// ---------- Bus (LTA DataMall v3 BusArrival) ----------
export type BusLoad = 'SEA' | 'SDA' | 'LSD';
export interface BusArrival {
  estimatedArrival: string | null; // null => "No estimate"
  load: BusLoad | null;
  monitored: boolean | null; // false => schedule-based
}
export interface BusService {
  serviceNo: string; // string, keep suffixes like "36A" distinct
  operator: string | null;
  arrivals: BusArrival[]; // NextBus, NextBus2, NextBus3 in order (max 3)
}
export interface BusStop {
  code: string; // 5 chars, leading zeroes preserved
  nickname: string | null;
  services: BusService[];
  error: SafeError | null; // per-stop failure doesn't fail the card
}
export interface BusData {
  stops: BusStop[];
}

// ---------- Weather (data.gov.sg two-hr-forecast) ----------
export interface WeatherData {
  area: string | null; // null => owner must pick an area
  forecast: string | null;
  validFrom: string | null;
  validUntil: string | null;
  issuedAt: string | null; // provider update_timestamp
  availableAreas: string[]; // from area_metadata
}

// ---------- Canvas ----------
export type CanvasKind = 'assignment' | 'quiz' | 'discussion_topic' | 'wiki_page' | 'planner_note' | 'calendar_event' | 'announcement' | 'other';
export type CanvasCompletion = 'submitted' | 'graded' | 'marked_complete' | 'not_submitted' | 'unknown';
export interface CanvasItem {
  id: string; // provider identity: `${plannable_type}:${plannable_id}`
  courseName: string | null;
  title: string;
  kind: CanvasKind;
  /** Actual submission deadline (user-specific if Canvas returned one). null if not a deadline / undated. */
  dueAt: string | null;
  /** Planner date (todo/reminder date). Not necessarily a deadline. */
  plannerDate: string | null;
  /** True for personal planner notes / to-do reminders that are not submission deadlines. */
  isReminder: boolean;
  completion: CanvasCompletion;
  htmlUrl: string | null;
}
export interface CanvasData {
  windowStart: string; // instant
  windowEnd: string;
  items: CanvasItem[];
}

// ---------- Google Calendar ----------
export interface CalendarTime {
  dateTime: string | null; // instant (UTC ISO) for timed events
  date: string | null; // YYYY-MM-DD for all-day events; end date is EXCLUSIVE
}
export interface CalendarEvent {
  id: string; // `${calendarId}:${eventId}` — instances of recurring events are distinct
  calendarId: string;
  title: string | null;
  start: CalendarTime;
  end: CalendarTime;
  allDay: boolean;
  recurringEventId: string | null;
  htmlLink: string | null;
}
export interface CalendarSourceStatus {
  calendarId: string;
  ok: boolean;
  error: SafeError | null;
}
export interface CalendarData {
  windowStart: string;
  windowEnd: string;
  events: CalendarEvent[]; // excludes cancelled and self-declined events, sorted by start
  calendars: CalendarSourceStatus[];
}

// ---------- Garmin ----------
export interface GarminActivity {
  id: string;
  type: string | null;
  startTime: string | null;
  durationSec: number | null;
  distanceM: number | null;
  sourceUrl: string | null;
}
export interface DatedValue {
  date: string; // YYYY-MM-DD the measurement applies to
  value: number | null;
}
export interface GarminData {
  latestActivity: GarminActivity | null;
  weekRunningDistanceM: number | null;
  weekCoverage: Coverage | null; // complete=false => "Partial week data"
  stepsToday: DatedValue | null;
  sleepDurationSec: DatedValue | null;
  restingHeartRate: DatedValue | null;
}

export interface ProviderDataMap {
  lta: BusData;
  weather: WeatherData;
  canvas: CanvasData;
  google: CalendarData;
  garmin: GarminData;
}

// ---------- Briefing ----------
export type FactSource = 'google' | 'canvas' | 'weather' | 'garmin';
export interface Fact {
  id: string; // e.g. "f1"
  source: FactSource;
  kind: string; // e.g. "next_event", "next_deadline", "forecast"
  text: string; // pre-computed in code; dates/durations already formatted
  sensitive: 'title' | 'health' | 'none';
}
export interface BriefingBullet {
  text: string;
  factIds: string[];
  sources: FactSource[];
}
export interface Briefing {
  kind: 'overview' | 'ai';
  bullets: BriefingBullet[]; // max 3
  generatedAt: string;
  /** For 'ai': hash of input facts; mismatch or >30 min age => show overview. */
  factsHash: string | null;
  notice: string | null; // e.g. "AI output rejected; showing overview"
}

// ---------- Settings ----------
export const WIDGET_IDS = ['calendar', 'canvas', 'lta', 'weather', 'garmin'] as const;
export type WidgetId = (typeof WIDGET_IDS)[number];

export const busStopSchema = z.object({
  code: z.string().regex(/^\d{5}$/, 'Bus stop code must be exactly 5 digits'),
  nickname: z.string().trim().max(40).nullable().default(null),
  services: z.array(z.string().trim().regex(/^[0-9A-Za-z]{1,5}$/)).max(20).default([]),
});

export const settingsSchema = z.object({
  widgets: z
    .array(z.object({ id: z.enum(WIDGET_IDS), visible: z.boolean() }))
    .length(WIDGET_IDS.length)
    .refine((w) => new Set(w.map((x) => x.id)).size === WIDGET_IDS.length, 'Each widget must appear once'),
  bus: z.object({ stops: z.array(busStopSchema).max(3) }),
  weather: z.object({ area: z.string().trim().min(1).max(80).nullable() }),
  calendar: z.object({
    calendarIds: z.array(z.string().trim().min(1).max(200)).min(1).max(10),
  }),
  privacy: z.object({ enabled: z.boolean() }),
  ai: z.object({
    enabled: z.boolean(),
    includeTitles: z.boolean(), // calendar/Canvas titles to external model
    includeHealth: z.boolean(), // Garmin values to external model, off by default
  }),
  providers: z.object({
    lta: z.object({ enabled: z.boolean() }),
    weather: z.object({ enabled: z.boolean() }),
    canvas: z.object({ enabled: z.boolean() }),
    google: z.object({ enabled: z.boolean() }),
    garmin: z.object({ enabled: z.boolean() }),
  }),
});
export type Settings = z.infer<typeof settingsSchema>;

/** PATCH body: any top-level section may be replaced wholesale. */
export const settingsPatchSchema = settingsSchema.partial();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export const DEFAULT_SETTINGS: Settings = {
  widgets: WIDGET_IDS.map((id) => ({ id, visible: true })),
  bus: { stops: [] },
  weather: { area: null },
  calendar: { calendarIds: ['primary'] },
  privacy: { enabled: false },
  ai: { enabled: false, includeTitles: false, includeHealth: false },
  providers: {
    lta: { enabled: true },
    weather: { enabled: true },
    canvas: { enabled: true },
    google: { enabled: true },
    garmin: { enabled: true },
  },
};

// ---------- API payloads ----------
export interface DashboardResponse {
  mode: Mode;
  serverTime: string;
  envelopes: { [K in ProviderId]: WidgetEnvelope<ProviderDataMap[K]> };
  overview: Briefing; // deterministic, always present
  aiBriefing: Briefing | null; // only if generated, still valid (facts unchanged, <30 min)
  ai: { available: boolean; reason: string | null; remainingToday: number };
}

export interface SessionResponse {
  authenticated: boolean;
  mode: Mode;
}

export interface RefreshResponse {
  status: 'accepted' | 'in_flight' | 'cooldown' | 'disabled';
  envelope: WidgetEnvelope;
}

export interface SettingsResponse {
  settings: Settings;
  /** Non-secret readiness facts for the settings UI, e.g. which env secrets are present. */
  providerSetup: { [K in ProviderId]: { configured: boolean; requirement: string | null } };
  aiDisclosure: string; // exact description of what would be transmitted
}

/** Application refresh defaults (not provider quotas). */
export const REFRESH_POLICY: { [K in ProviderId]: { intervalMs: number; staleAfterMs: number } } = {
  lta: { intervalMs: 30_000, staleAfterMs: 90_000 },
  weather: { intervalMs: 5 * 60_000, staleAfterMs: 15 * 60_000 },
  google: { intervalMs: 5 * 60_000, staleAfterMs: 15 * 60_000 },
  canvas: { intervalMs: 10 * 60_000, staleAfterMs: 30 * 60_000 },
  garmin: { intervalMs: 60 * 60_000, staleAfterMs: 2 * 60 * 60_000 },
};

export const DISPLAY_TIMEZONE = 'Asia/Singapore';
