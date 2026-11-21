import { z } from 'zod';
import type { Briefing, BriefingBullet, Fact, FactSource, Settings } from '../../shared/contracts.js';
import type { Db } from '../storage/db.js';
import { sgtDate } from '../util/time.js';
import { buildFacts, buildOverview, factsHash, type BuiltFact } from './overview.js';

type Envelopes = Parameters<typeof buildOverview>[0];

export const AI_BRIEFING_MAX_AGE_MS = 30 * 60_000;
export const NOT_CONFIGURED_REASON = 'AI briefing not configured: set LLM_PROVIDER=anthropic, ANTHROPIC_API_KEY and optionally LLM_MODEL';

/** The only thing the briefing code knows about a model; tests inject a fake. Receives already-filtered facts. */
export interface BriefingModel {
  generate(facts: Fact[]): Promise<unknown>;
}

/** Thrown by a model adapter when the model refused or produced no usable structured output. */
export class BriefingModelRefusal extends Error {}

// ---------- what may leave the server ----------

interface CatalogEntry {
  kinds: string[];
  sensitive: 'title' | 'health' | 'none';
  /** Plain-English description of what is sent; `full` is used when titles are allowed. */
  describe(area: string | null, full: boolean): string;
}

/** Single source of truth for both the disclosure text and (via `sensitive` on built facts) the filtering. */
const CATALOG: CatalogEntry[] = [
  { kinds: ['next_event'], sensitive: 'title', describe: (_a, full) => (full ? "your next calendar event's time and title" : "your next calendar event's time (not its title)") },
  { kinds: ['events_today'], sensitive: 'none', describe: () => 'the number of calendar events you have today' },
  {
    kinds: ['next_deadline', 'later_deadline'],
    sensitive: 'title',
    describe: (_a, full) => (full ? "up to 3 Canvas deadlines' due times, titles and course names" : "up to 3 Canvas deadlines' due times (not titles or course names)"),
  },
  { kinds: ['forecast'], sensitive: 'none', describe: (area) => `the current 2-hour forecast text for ${area ?? 'your chosen area'}` },
  { kinds: ['week_running_distance'], sensitive: 'health', describe: () => "Garmin health data: this week's running distance" },
];

/** Applies the privacy toggles BEFORE anything is sent. Dropped facts never reach the model or its payload. */
export function filterFactsForModel(facts: BuiltFact[], ai: Settings['ai']): Fact[] {
  const out: Fact[] = [];
  for (const f of facts) {
    const base = { id: f.id, source: f.source, kind: f.kind };
    if (f.sensitive === 'none') out.push({ ...base, text: f.text, sensitive: 'none' });
    else if (f.sensitive === 'title') {
      if (ai.includeTitles) out.push({ ...base, text: f.text, sensitive: 'title' });
      else if (f.safeText) out.push({ ...base, text: f.safeText, sensitive: 'none' });
    } else if (f.sensitive === 'health' && ai.includeHealth) out.push({ ...base, text: f.text, sensitive: 'health' });
  }
  return out;
}

export function describeAiDisclosure(s: Settings, info: { modelName: string; dailyCap: number; configured: boolean }): string {
  if (!s.ai.enabled) return 'AI briefing is off. Nothing is sent to any external model.';
  const items = CATALOG.filter((c) => c.sensitive !== 'health' || s.ai.includeHealth).map((c) => c.describe(s.weather.area, s.ai.includeTitles));
  const list = items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : (items[0] ?? '');
  const parts = [
    `When you click Generate AI briefing, the server sends to Anthropic (model ${info.modelName}): ${list}.`,
    s.ai.includeHealth ? '' : 'Garmin health data is not sent.',
    'It never sends bus arrivals, tokens, passwords, event descriptions, attendees, locations or links.',
    `Daily cap ${info.dailyCap} requests. Nothing is sent unless you click the button.`,
    info.configured ? '' : 'The server is not configured for AI (set LLM_PROVIDER=anthropic and ANTHROPIC_API_KEY), so nothing can be sent yet.',
  ];
  return parts.filter(Boolean).join(' ');
}

// ---------- validation ----------

const OutputSchema = z.object({
  bullets: z
    .array(z.object({ text: z.string().min(1).max(200), factIds: z.array(z.string()).min(1) }))
    .min(1)
    .max(3),
});

const NUMBER_TOKEN = /\d+(?:[.,:]\d+)*/g;
const numberTokens = (s: string): string[] => s.match(NUMBER_TOKEN) ?? [];

/** Strips control characters and anything tag-like; the client also renders as plain text. */
export function sanitizeText(s: string): string {
  return s
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/<[^>]*>?/g, '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export type Validation = { ok: true; bullets: BriefingBullet[] } | { ok: false; reason: string };

/** `facts` must be the filtered facts the model was given. Does not prove semantic correctness. */
export function validateBriefing(output: unknown, facts: Fact[]): Validation {
  const parsed = OutputSchema.safeParse(output);
  if (!parsed.success) return { ok: false, reason: 'schema' };
  const byId = new Map(facts.map((f) => [f.id, f]));
  const bullets: BriefingBullet[] = [];
  for (const b of parsed.data.bullets) {
    const refs: Fact[] = [];
    for (const id of b.factIds) {
      const f = byId.get(id);
      if (!f) return { ok: false, reason: 'unknown fact id' };
      refs.push(f);
    }
    const text = sanitizeText(b.text);
    if (!text) return { ok: false, reason: 'empty text' };
    const allowed = new Set(refs.flatMap((f) => numberTokens(f.text)));
    if (numberTokens(text).some((n) => !allowed.has(n))) return { ok: false, reason: 'unsupported number' };
    const sources = [...new Set(refs.map((f) => f.source))] as FactSource[];
    bullets.push({ text, factIds: [...new Set(b.factIds)], sources });
  }
  return { ok: true, bullets };
}

// ---------- service ----------

export type GenerateResult =
  | { status: 'ok'; briefing: Briefing }
  | { status: 'unavailable'; message: string }
  | { status: 'rate_limited' };

export interface BriefingServiceOptions {
  db: Db;
  now: () => Date;
  /** null => no provider configured. */
  model: BriefingModel | null;
  /** Reason shown when `model` is null. */
  unconfiguredReason: string;
  dailyCap: number;
}

export function createBriefingService(opts: BriefingServiceOptions) {
  const { db, now, model, dailyCap } = opts;
  let latest: Briefing | null = null;
  /** Privacy toggles in effect when `latest` was generated. */
  let latestToggles = '';
  const togglesKey = (s: Settings): string => `${s.ai.includeTitles ? 1 : 0}${s.ai.includeHealth ? 1 : 0}`;
  let inflight: Promise<GenerateResult> | null = null;

  const used = (): number => {
    const row = db.prepare('SELECT count FROM ai_usage WHERE date = ?').get(sgtDate(now())) as { count: number } | undefined;
    return row?.count ?? 0;
  };
  const remainingToday = (): number => Math.max(0, dailyCap - used());
  const recordAttempt = (): void => {
    db.prepare('INSERT INTO ai_usage (date, count) VALUES (?, 1) ON CONFLICT(date) DO UPDATE SET count = count + 1').run(sgtDate(now()));
  };

  function availability(settings: Settings): { available: boolean; reason: string | null; remainingToday: number } {
    let reason: string | null = null;
    if (!settings.ai.enabled) reason = 'AI briefing is off. Enable it in Settings.';
    else if (!model) reason = opts.unconfiguredReason;
    return { available: reason === null, reason, remainingToday: remainingToday() };
  }

  /** The stored AI briefing, only while its facts are unchanged and it is under 30 minutes old. */
  function current(envelopes: Envelopes, settings: Settings): Briefing | null {
    if (!settings.ai.enabled || !latest || latest.factsHash === null) return null;
    if (latestToggles !== togglesKey(settings)) return null;
    const t = now();
    if (t.getTime() - Date.parse(latest.generatedAt) >= AI_BRIEFING_MAX_AGE_MS) return null;
    return latest.factsHash === factsHash(buildFacts(envelopes, settings, t)) ? latest : null;
  }

  async function run(envelopes: Envelopes, settings: Settings, model: BriefingModel): Promise<GenerateResult> {
    const t = now();
    const full = buildFacts(envelopes, settings, t);
    const sent = filterFactsForModel(full, settings.ai);
    const fallback = (notice: string): GenerateResult => ({ status: 'ok', briefing: { ...buildOverview(envelopes, settings, t), notice } });
    if (sent.length === 0) return fallback('Nothing to summarise yet; showing Overview');
    recordAttempt(); // count attempts, before the paid call
    let output: unknown;
    try {
      output = await model.generate(sent);
    } catch (err) {
      return fallback(err instanceof BriefingModelRefusal ? 'AI model did not produce a briefing; showing Overview' : 'AI briefing failed; showing Overview');
    }
    const v = validateBriefing(output, sent);
    if (!v.ok) return fallback('AI briefing could not be verified; showing Overview');
    const briefing: Briefing = { kind: 'ai', bullets: v.bullets, generatedAt: now().toISOString(), factsHash: factsHash(full), notice: null };
    latest = briefing;
    latestToggles = togglesKey(settings);
    return { status: 'ok', briefing };
  }

  async function generate(envelopes: Envelopes, settings: Settings): Promise<GenerateResult> {
    const a = availability(settings);
    if (!a.available || !model) return { status: 'unavailable', message: a.reason ?? opts.unconfiguredReason };
    if (inflight) return inflight; // coalesce concurrent clicks: one model call, one usage count
    if (remainingToday() <= 0) return { status: 'rate_limited' };
    inflight = run(envelopes, settings, model).finally(() => {
      inflight = null;
    });
    return inflight;
  }

  return { availability, current, generate };
}
export type BriefingService = ReturnType<typeof createBriefingService>;
