import type { CalendarEvent } from '../contracts.js';
import {
  DAY_MS,
  addDaysKey,
  dateKeyToMs,
  fmtDateKey,
  fmtDayMonth,
  fmtTime,
  fmtWeekdayDayMonth,
  fmtWeekdayTime,
  sgDateKey,
} from './time.js';

export function eventStartMs(e: CalendarEvent): number {
  if (e.start.dateTime) return Date.parse(e.start.dateTime);
  if (e.start.date) return dateKeyToMs(e.start.date);
  return Number.NaN;
}

/** End instant. All-day end dates are exclusive, so the end is 00:00 SGT of the end date. */
export function eventEndMs(e: CalendarEvent): number {
  if (e.end.dateTime) return Date.parse(e.end.dateTime);
  if (e.end.date) return dateKeyToMs(e.end.date);
  const s = eventStartMs(e);
  return e.allDay ? s + DAY_MS : s;
}

export function eventDayKey(e: CalendarEvent): string {
  return e.start.date && e.allDay ? e.start.date : sgDateKey(eventStartMs(e));
}

export function sortEvents(events: CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((a, b) => eventStartMs(a) - eventStartMs(b) || a.id.localeCompare(b.id));
}

/** First event (by start) whose end is after now. */
export function nextEvent(events: CalendarEvent[], nowMs: number): CalendarEvent | null {
  return sortEvents(events).find((e) => eventEndMs(e) > nowMs) ?? null;
}

/** "21 Nov, all day" (end date exclusive), or "21–23 Nov, all day" for multi-day events. */
export function allDayLabel(e: CalendarEvent): string {
  const startKey = e.start.date ?? sgDateKey(eventStartMs(e));
  const lastKey = e.end.date ? addDaysKey(e.end.date, -1) : startKey;
  if (lastKey <= startKey) return `${fmtDayMonth(dateKeyToMs(startKey))}, all day`;
  return `${fmtDayMonth(dateKeyToMs(startKey))} – ${fmtDayMonth(dateKeyToMs(lastKey))}, all day`;
}

/** Time part only: "14:00–15:00", "22:00 → Sat 01:30", or "All day". */
export function eventTimeLabel(e: CalendarEvent): string {
  if (e.allDay) return 'All day';
  const s = eventStartMs(e);
  const en = eventEndMs(e);
  if (Number.isNaN(s)) return '';
  if (Number.isNaN(en) || en <= s) return fmtTime(s);
  // Ending exactly at midnight belongs to the start day.
  if (sgDateKey(en - 1) !== sgDateKey(s)) return `${fmtTime(s)} → ${fmtWeekdayTime(en)}`;
  return `${fmtTime(s)}–${fmtTime(en)}`;
}

/** Full "when" for the prominent Next event. */
export function eventWhenLabel(e: CalendarEvent): string {
  if (e.allDay) return allDayLabel(e);
  return `${fmtWeekdayDayMonth(eventStartMs(e))}, ${eventTimeLabel(e)}`;
}

/** Events overlapping today in SGT (start < tomorrow 00:00 and end > today 00:00), including ones that began earlier. */
export function todaysAgenda(events: CalendarEvent[], nowMs: number): CalendarEvent[] {
  const today = sgDateKey(nowMs);
  const todayStart = dateKeyToMs(today);
  const tomorrowStart = todayStart + DAY_MS;
  return sortEvents(events).filter((e) => {
    if (eventDayKey(e) === today) return true; // also covers zero-length events at 00:00
    const s = eventStartMs(e);
    const en = eventEndMs(e);
    return s < tomorrowStart && en > todayStart;
  });
}

export interface DayGroup {
  dayKey: string;
  label: string;
  events: CalendarEvent[];
}

export function groupByDay(events: CalendarEvent[]): DayGroup[] {
  const map = new Map<string, CalendarEvent[]>();
  for (const e of sortEvents(events)) {
    const k = eventDayKey(e);
    const list = map.get(k);
    if (list) list.push(e);
    else map.set(k, [e]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dayKey, evs]) => ({ dayKey, label: fmtDateKey(dayKey), events: evs }));
}
