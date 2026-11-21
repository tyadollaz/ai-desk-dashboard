// Synthetic DEMO calendar events. No network calls.
import type { CalendarEvent } from '../../../shared/contracts.js';
import { DAY_MS, sgtDate, sgtStartOfDay } from '../../util/time.js';
import type { AdapterFactory } from '../types.js';

const HOUR = 3_600_000;

export const createDemoAdapter: AdapterFactory<'google'> = ({ now }) => ({
  id: 'google',
  mode: 'demo',
  async setupStatus() {
    return { connection: 'connected', requirement: null };
  },
  configKey: () => 'demo',
  async fetch() {
    const current = now();
    const t = current.getTime();
    const dayStart = sgtStartOfDay(current).getTime();
    const iso = (ms: number) => new Date(ms).toISOString();
    const timed = (id: string, title: string, start: number, end: number, recurring: string | null = null): CalendarEvent => ({
      id: `primary:${id}`,
      calendarId: 'primary',
      title,
      start: { dateTime: iso(start), date: null },
      end: { dateTime: iso(end), date: null },
      allDay: false,
      recurringEventId: recurring,
      htmlLink: null,
    });
    const events: CalendarEvent[] = [
      timed('demo-1', '[Demo] Morning focus block', dayStart + 9 * HOUR, dayStart + 10 * HOUR),
      timed('demo-2', '[Demo] Team standup', t + 90 * 60_000, t + 120 * 60_000),
      timed('demo-3', '[Demo] Late call (crosses midnight)', dayStart + 23 * HOUR, dayStart + 25 * HOUR),
      timed('demo-4a', '[Demo] Weekly sync', dayStart + 2 * DAY_MS + 10 * HOUR, dayStart + 2 * DAY_MS + 11 * HOUR, 'demo-recurring-1'),
      {
        id: 'primary:demo-5',
        calendarId: 'primary',
        title: '[Demo] Public holiday (all day)',
        start: { dateTime: null, date: sgtDate(new Date(t + 3 * DAY_MS)) },
        end: { dateTime: null, date: sgtDate(new Date(t + 4 * DAY_MS)) }, // exclusive
        allDay: true,
        recurringEventId: null,
        htmlLink: null,
      },
      timed('demo-4b', '[Demo] Weekly sync', dayStart + 5 * DAY_MS + 10 * HOUR, dayStart + 5 * DAY_MS + 11 * HOUR, 'demo-recurring-1'),
    ].sort((a, b) => Date.parse(a.start.dateTime ?? `${a.start.date}T00:00:00+08:00`) - Date.parse(b.start.dateTime ?? `${b.start.date}T00:00:00+08:00`));
    return {
      data: {
        windowStart: iso(dayStart),
        windowEnd: iso(dayStart + 8 * DAY_MS),
        events,
        calendars: [{ calendarId: 'primary', ok: true, error: null }],
      },
      sourceUpdatedAt: current.toISOString(),
      validUntil: null,
      coverage: { start: iso(dayStart), end: iso(dayStart + 8 * DAY_MS), complete: true },
      detailUrl: null,
    };
  },
});
