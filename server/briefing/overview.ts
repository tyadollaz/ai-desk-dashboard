import { createHash } from 'node:crypto';
import type {
  Briefing,
  BriefingBullet,
  CalendarData,
  CanvasData,
  Fact,
  ProviderId,
  Settings,
  WeatherData,
  WidgetEnvelope,
} from '../../shared/contracts.js';
import { formatDateOnly, formatSgtDateTime, formatSgtTime } from '../util/time.js';

type Envelopes = { [K in ProviderId]: WidgetEnvelope };

const usable = (e: WidgetEnvelope): boolean => e.data !== null && e.freshness !== 'expired' && e.freshness !== 'unknown';

function startMs(t: { dateTime: string | null; date: string | null }): number | null {
  if (t.dateTime) return Date.parse(t.dateTime);
  if (t.date) return Date.parse(`${t.date}T00:00:00+08:00`);
  return null;
}

/** Deterministic facts; all wording and date formatting happen here, never in a model. */
export function buildFacts(envelopes: Envelopes, _settings: Settings, now: Date): Fact[] {
  const facts: Fact[] = [];
  const add = (f: Omit<Fact, 'id'>) => facts.push({ id: `f${facts.length + 1}`, ...f });
  const t = now.getTime();

  const cal = envelopes.google;
  if (usable(cal)) {
    const events = (cal.data as CalendarData).events
      .map((e) => ({ e, s: startMs(e.start) }))
      .filter((x): x is { e: (typeof x)['e']; s: number } => x.s !== null && x.s >= t)
      .sort((a, b) => a.s - b.s);
    const next = events[0];
    if (next) {
      const title = next.e.title ?? 'Untitled event';
      const when = next.e.allDay && next.e.start.date ? `${formatDateOnly(next.e.start.date)} (all day)` : formatSgtDateTime(new Date(next.s));
      add({ source: 'google', kind: 'next_event', text: `Next event: ${title}, ${when} SGT`, sensitive: 'title' });
    }
  }

  const canvas = envelopes.canvas;
  if (usable(canvas)) {
    const next = (canvas.data as CanvasData).items
      .filter((i) => !i.isReminder && i.dueAt !== null && Date.parse(i.dueAt) >= t)
      .filter((i) => i.completion === 'not_submitted' || i.completion === 'unknown')
      .sort((a, b) => Date.parse(a.dueAt as string) - Date.parse(b.dueAt as string))[0];
    if (next && next.dueAt) {
      const course = next.courseName ? ` (${next.courseName})` : '';
      add({
        source: 'canvas',
        kind: 'next_deadline',
        text: `Next known Canvas deadline: ${next.title}${course}, due ${formatSgtDateTime(new Date(next.dueAt))} SGT`,
        sensitive: 'title',
      });
    }
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
  const facts = buildFacts(envelopes, settings, now);
  const bullets: BriefingBullet[] = facts.slice(0, 3).map((f) => ({ text: f.text, factIds: [f.id], sources: [f.source] }));
  if (bullets.length === 0) {
    bullets.push({ text: 'Nothing upcoming to summarise yet.', factIds: [], sources: [] });
  }
  return { kind: 'overview', bullets, generatedAt: now.toISOString(), factsHash: null, notice: null };
}
