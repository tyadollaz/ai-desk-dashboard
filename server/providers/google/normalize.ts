// Pure normalization of Google Calendar API v3 events.list responses.
import { z } from 'zod';
import type { CalendarEvent } from '../../../shared/contracts.js';
import { ProviderError } from '../types.js';

const timeSchema = z.object({ dateTime: z.string().optional(), date: z.string().optional() }).passthrough();
const eventSchema = z
  .object({
    id: z.string().min(1),
    status: z.string().optional(),
    summary: z.string().optional(),
    htmlLink: z.string().optional(),
    recurringEventId: z.string().optional(),
    start: timeSchema,
    end: timeSchema,
    attendees: z.array(z.object({ self: z.boolean().optional(), responseStatus: z.string().optional() }).passthrough()).optional(),
  })
  .passthrough();

const pageSchema = z.object({ items: z.array(z.unknown()), nextPageToken: z.string().optional() }).passthrough();

export interface EventsPage {
  items: unknown[];
  nextPageToken: string | null;
}

export function parseEventsPage(body: unknown): EventsPage {
  const p = pageSchema.safeParse(body);
  if (!p.success) throw new ProviderError('malformed', 'Google Calendar returned an unreadable response');
  return { items: p.data.items, nextPageToken: p.data.nextPageToken ?? null };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toTime(t: z.infer<typeof timeSchema>): { dateTime: string | null; date: string | null } | null {
  if (t.dateTime) {
    const ms = Date.parse(t.dateTime);
    return Number.isNaN(ms) ? null : { dateTime: new Date(ms).toISOString(), date: null };
  }
  if (t.date && DATE_RE.test(t.date)) return { dateTime: null, date: t.date };
  return null;
}

/** Returns null for events that must be excluded (cancelled, self-declined) or are unusable. */
export function normalizeEvent(calendarId: string, raw: unknown): CalendarEvent | null {
  const p = eventSchema.safeParse(raw);
  if (!p.success) return null;
  const e = p.data;
  if (e.status === 'cancelled') return null;
  if (e.attendees?.some((a) => a.self === true && a.responseStatus === 'declined')) return null;
  const start = toTime(e.start);
  const end = toTime(e.end);
  if (!start || !end) return null;
  return {
    id: `${calendarId}:${e.id}`,
    calendarId,
    title: e.summary ?? null,
    start,
    end,
    allDay: !!e.start.date && !e.start.dateTime,
    recurringEventId: e.recurringEventId ?? null,
    htmlLink: e.htmlLink && e.htmlLink.startsWith('https://') ? e.htmlLink : null,
  };
}

export function startMs(e: CalendarEvent): number {
  return Date.parse(e.start.dateTime ?? `${e.start.date}T00:00:00+08:00`);
}

export function sortEvents(events: CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((a, b) => startMs(a) - startMs(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
