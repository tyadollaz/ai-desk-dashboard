import { createHash } from 'node:crypto';
import type {
  Briefing,
  BriefingBullet,
  CalendarData,
  CanvasData,
  Fact,
  GarminData,
  ProviderId,
  Settings,
  WeatherData,
  WidgetEnvelope,
} from '../../shared/contracts.js';
import { formatDateOnly, formatSgtDateTime, formatSgtTime, sgtDate } from '../util/time.js';

type Envelopes = { [K in ProviderId]: WidgetEnvelope };

const usable = (e: WidgetEnvelope): boolean => e.data !== null && e.freshness !== 'expired' && e.freshness !== 'unknown';

function startMs(t: { dateTime: string | null; date: string | null }): number | null {
  if (t.dateTime) return Date.parse(t.dateTime);
  if (t.date) return Date.parse(`${t.date}T00:00:00+08:00`);
  return null;
}

/** A fact plus the wording used when its sensitive content (titles) must not leave the server. */
export interface BuiltFact extends Fact {
  /** Title-free wording for 'title' facts; when absent the fact is dropped if titles are not allowed. */
  safeText?: string;
}

/** Fact kinds shown by the deterministic Overview (extras exist only as input for the AI briefing). */
const OVERVIEW_KINDS = new Set(['next_event', 'next_deadline', 'forecast']);

/** Deterministic facts; all wording and date formatting happen here, never in a model. */
export function buildFacts(envelopes: Envelopes, _settings: Settings, now: Date): BuiltFact[] {
  const facts: BuiltFact[] = [];
  const add = (f: Omit<BuiltFact, 'id'>) => facts.push({ id: `f${facts.length + 1}`, ...f });
  const t = now.getTime();
  const extras: Array<Omit<BuiltFact, 'id'>> = [];

  const cal = envelopes.google;
  if (usable(cal)) {
    const all = (cal.data as CalendarData).events
      .map((e) => ({ e, s: startMs(e.start) }))
      .filter((x): x is { e: (typeof x)['e']; s: number } => x.s !== null);
    const events = all.filter((x) => x.s >= t).sort((a, b) => a.s - b.s);
    const next = events[0];
    if (next) {
      const title = next.e.title ?? 'Untitled event';
      const when = next.e.allDay && next.e.start.date ? `${formatDateOnly(next.e.start.date)} (all day)` : formatSgtDateTime(new Date(next.s));
      add({
        source: 'google',
        kind: 'next_event',
        text: `Next event: ${title}, ${when} SGT`,
        safeText: `Next calendar event: ${when} SGT`,
        sensitive: 'title',
      });
    }
    const today = sgtDate(now);
    const todayCount = all.filter((x) => sgtDate(new Date(x.s)) === today).length;
    if (todayCount > 0) {
      extras.push({ source: 'google', kind: 'events_today', text: `Calendar events today: ${todayCount}`, sensitive: 'none' });
    }
  }

  const canvas = envelopes.canvas;
  if (usable(canvas)) {
    const upcoming = (canvas.data as CanvasData).items
      .filter((i) => !i.isReminder && i.dueAt !== null && Date.parse(i.dueAt) >= t)
      .filter((i) => i.completion === 'not_submitted' || i.completion === 'unknown')
      .sort((a, b) => Date.parse(a.dueAt as string) - Date.parse(b.dueAt as string))
      .slice(0, 3);
    upcoming.forEach((item, idx) => {
      const due = formatSgtDateTime(new Date(item.dueAt as string));
      const course = item.courseName ? ` (${item.courseName})` : '';
      const first = idx === 0;
      const fact: Omit<BuiltFact, 'id'> = {
        source: 'canvas',
        kind: first ? 'next_deadline' : 'later_deadline',
        text: first ? `Next known Canvas deadline: ${item.title}${course}, due ${due} SGT` : `Later Canvas deadline: ${item.title}${course}, due ${due} SGT`,
        safeText: first ? `Next known Canvas deadline: due ${due} SGT` : `Later Canvas deadline: due ${due} SGT`,
        sensitive: 'title',
      };
      if (first) add(fact);
      else extras.push(fact);
    });
  }

  const weather = envelopes.weather;
  if (usable(weather)) {
    const w = weather.data as WeatherData;
    if (w.area && w.forecast && w.validUntil && Date.parse(w.validUntil) > t) {
      add({
        source: 'weather',
        kind: 'forecast',
        text: `Weather forecast for ${w.area}: ${w.forecast}, valid until ${formatSgtTime(new Date(w.validUntil))} SGT`,
        sensitive: 'none',
      });
    }
  }

  const garmin = envelopes.garmin;
  if (usable(garmin)) {
    const g = garmin.data as GarminData;
    if (g.weekRunningDistanceM !== null) {
      const partial = g.weekCoverage && !g.weekCoverage.complete ? ' (partial week data)' : '';
      extras.push({
        source: 'garmin',
        kind: 'week_running_distance',
        text: `Running distance this week: ${(g.weekRunningDistanceM / 1000).toFixed(1)} km${partial}`,
        sensitive: 'health',
      });
    }
  }

  for (const x of extras) add(x);
  return facts;
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, x]) => [k, canonical(x)]),
    );
  }
  return v;
}

export function factsHash(facts: Fact[]): string {
  return createHash('sha256').update(JSON.stringify(canonical(facts))).digest('hex');
}

export function buildOverview(envelopes: Envelopes, settings: Settings, now: Date): Briefing {
  const facts = buildFacts(envelopes, settings, now).filter((f) => OVERVIEW_KINDS.has(f.kind));
  const bullets: BriefingBullet[] = facts.slice(0, 3).map((f) => ({ text: f.text, factIds: [f.id], sources: [f.source] }));
  if (bullets.length === 0) {
    bullets.push({ text: 'Nothing upcoming to summarise yet.', factIds: [], sources: [] });
  }
  return { kind: 'overview', bullets, generatedAt: now.toISOString(), factsHash: null, notice: null };
}
