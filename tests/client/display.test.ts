import { describe, expect, it } from 'vitest';
import type { CalendarEvent, CanvasItem, GarminData, WeatherData } from '../../shared/contracts';
import { busArrivalViews, isBusStale } from '../../shared/display/bus';
import { weatherView } from '../../shared/display/weather';
import { groupCanvasItems } from '../../shared/display/canvas';
import {
  allDayLabel,
  eventTimeLabel,
  groupByDay,
  nextEvent,
  todaysAgenda,
} from '../../shared/display/calendar';
import { garminView } from '../../shared/display/garmin';
import { safeExternalUrl } from '../../shared/display/url';
import { relativeDue, sgDateKey, weekStartKey } from '../../shared/display/time';
import { bulletText, MASK } from '../../shared/display/privacy';

// Saturday 21 Nov 2026, 12:00 Singapore time.
const NOW = Date.parse('2026-11-21T04:00:00Z');
const at = (sec: number) => new Date(NOW + sec * 1000).toISOString();
const arr = (sec: number | null) => ({
  estimatedArrival: sec === null ? null : at(sec),
  load: null,
  monitored: true,
});

describe('bus', () => {
  it('formats countdowns', () => {
    const v = busArrivalViews([arr(119), arr(45), arr(null)], NOW, false);
    expect(v.map((x) => x.text)).toEqual(['1 min', 'Arriving', 'No estimate']);
  });
  it('drops estimates more than 60 s in the past, keeps 59 s as Arriving', () => {
    expect(busArrivalViews([arr(-61)], NOW, false)).toEqual([]);
    expect(busArrivalViews([arr(-59)], NOW, false)[0]?.text).toBe('Arriving');
  });
  it('replaces countdowns with Update needed when last success is 91 s old', () => {
    expect(isBusStale(at(-91), NOW)).toBe(true);
    expect(isBusStale(at(-89), NOW)).toBe(false);
    const v = busArrivalViews([arr(300)], NOW, isBusStale(at(-91), NOW));
    expect(v[0]?.text).toBe('Update needed');
  });
  it('labels occupancy and schedule-based estimates', () => {
    const v = busArrivalViews([{ estimatedArrival: at(300), load: 'SDA', monitored: false }], NOW, false);
    expect(v[0]?.occupancy).toBe('Standing available');
    expect(v[0]?.scheduled).toBe(true);
  });
});

describe('weather', () => {
  const base: WeatherData = {
    area: 'Bedok',
    forecast: 'Partly Cloudy',
    validFrom: at(-3600),
    validUntil: at(-60),
    issuedAt: at(-30),
    availableAreas: ['Bedok'],
  };
  it('is expired even if fetched recently', () => {
    expect(weatherView(base, null, NOW).state).toBe('expired');
  });
  it('shows validity when current', () => {
    const v = weatherView({ ...base, validUntil: at(3600) }, null, NOW);
    expect(v).toMatchObject({ state: 'ok', validity: 'Valid until 13:00' });
  });
  it('asks for an area', () => {
    expect(weatherView({ ...base, area: null }, null, NOW).state).toBe('no_area');
  });
});

describe('canvas', () => {
  const item = (o: Partial<CanvasItem> & { id: string }): CanvasItem => ({
    courseName: 'C',
    title: 'Same title',
    kind: 'assignment',
    dueAt: null,
    plannerDate: null,
    isReminder: false,
    completion: 'unknown',
    htmlUrl: null,
    ...o,
  });
  it('groups items correctly', () => {
    const g = groupCanvasItems(
      [
        item({ id: 'a:1', dueAt: at(86400) }), // user-specific due date
        item({ id: 'a:2', dueAt: at(-86400), completion: 'unknown' }),
        item({ id: 'a:3', dueAt: at(-86400), completion: 'not_submitted' }),
        item({ id: 'a:4', dueAt: at(-86400), completion: 'submitted' }),
        item({ id: 'a:5', dueAt: at(86400), completion: 'graded' }),
        item({ id: 'p:1', isReminder: true, plannerDate: at(7200) }),
        item({ id: 'a:6' }),
      ],
      NOW,
    );
    expect(g.dueSoon.map((i) => i.id)).toEqual(['a:1']);
    expect(g.pastDue.map((i) => i.id)).toEqual(['a:2', 'a:3']);
    expect(g.done.map((i) => i.id)).toEqual(['a:4', 'a:5']);
    expect(g.reminders.map((i) => i.id)).toEqual(['p:1']);
    expect(g.noDue.map((i) => i.id)).toEqual(['a:6']);
  });
  it('has no undated group when none returned', () => {
    expect(groupCanvasItems([item({ id: 'a:1', dueAt: at(10) })], NOW).noDue).toEqual([]);
  });
  it('dedupes by id, not title', () => {
    const g = groupCanvasItems(
      [item({ id: 'a:1', dueAt: at(10) }), item({ id: 'a:1', dueAt: at(10) }), item({ id: 'a:2', dueAt: at(20) })],
      NOW,
    );
    expect(g.dueSoon).toHaveLength(2);
  });
  it('formats relative due dates', () => {
    expect(relativeDue('2026-11-23T06:00:00Z', NOW)).toBe('in 2 days, Mon 14:00');
  });
});

describe('calendar', () => {
  const ev = (o: Partial<CalendarEvent> & { id: string }): CalendarEvent => ({
    calendarId: 'primary',
    title: 'Standup',
    start: { dateTime: null, date: null },
    end: { dateTime: null, date: null },
    allDay: false,
    recurringEventId: null,
    htmlLink: null,
    ...o,
  });
  const timed = (id: string, s: string, e: string, title = 'Standup') =>
    ev({ id, title, start: { dateTime: s, date: null }, end: { dateTime: e, date: null } });

  it('shows an all-day event with exclusive end as a single date', () => {
    const e = ev({ id: 'x', allDay: true, start: { dateTime: null, date: '2026-11-21' }, end: { dateTime: null, date: '2026-11-22' } });
    expect(allDayLabel(e)).toBe('21 Nov, all day');
  });
  it('shows multi-day all-day ranges inclusively', () => {
    const e = ev({ id: 'x', allDay: true, start: { dateTime: null, date: '2026-11-21' }, end: { dateTime: null, date: '2026-11-24' } });
    expect(allDayLabel(e)).toBe('21 Nov – 23 Nov, all day');
  });
  it('picks the next event by end time, skipping finished ones', () => {
    const past = timed('a', '2026-11-21T01:00:00Z', '2026-11-21T02:00:00Z');
    const ongoing = timed('b', '2026-11-21T03:30:00Z', '2026-11-21T05:00:00Z');
    expect(nextEvent([ongoing, past], NOW)?.id).toBe('b');
    expect(nextEvent([past], NOW)).toBeNull();
  });
  it('labels cross-midnight events on the start day with the end day', () => {
    // 22:00 SGT Sat to 01:30 SGT Sun
    const e = timed('c', '2026-11-21T14:00:00Z', '2026-11-21T17:30:00Z');
    expect(eventTimeLabel(e)).toBe('22:00 → Sun 01:30');
    const groups = groupByDay([e]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.dayKey).toBe('2026-11-21');
    expect(todaysAgenda([e], NOW)).toHaveLength(1);
  });
  it('keeps events with the same title as separate rows', () => {
    const a = timed('cal:1', '2026-11-21T06:00:00Z', '2026-11-21T07:00:00Z');
    const b = timed('cal:2', '2026-11-21T08:00:00Z', '2026-11-21T09:00:00Z');
    const g = groupByDay([a, b]);
    expect(g[0]?.events.map((x) => x.id)).toEqual(['cal:1', 'cal:2']);
  });
  it('uses Singapore day boundaries', () => {
    // 23:30 UTC on the 20th is 07:30 SGT on the 21st.
    const e = timed('d', '2026-11-20T23:30:00Z', '2026-11-21T00:30:00Z');
    expect(groupByDay([e])[0]?.dayKey).toBe('2026-11-21');
    expect(sgDateKey(Date.parse('2026-11-20T16:00:00Z'))).toBe('2026-11-21');
    expect(weekStartKey(NOW)).toBe('2026-11-16'); // Monday
    expect(weekStartKey(Date.parse('2026-11-22T16:30:00Z'))).toBe('2026-11-23'); // Mon 00:30 SGT
  });
});

describe('garmin', () => {
  it('shows Unavailable for nulls, never 0', () => {
    const d: GarminData = {
      latestActivity: { id: '1', type: 'Running', startTime: null, durationSec: null, distanceM: null, sourceUrl: null },
      weekRunningDistanceM: null,
      weekCoverage: { start: at(-1), end: at(0), complete: false },
      stepsToday: { date: '2026-11-21', value: null },
      sleepDurationSec: null,
      restingHeartRate: null,
    };
    const v = garminView(d, NOW);
    expect(v.latest).toMatchObject({ start: 'Unavailable', duration: 'Unavailable', distance: 'Unavailable' });
    expect(v.week.running).toBe('Unavailable');
    expect(v.week.partial).toBe(true);
    expect(v.steps.value).toBe('Unavailable');
    expect(v.steps.label).toContain('Sat 21 Nov');
    expect(v.sleep.value).toBe('Unavailable');
    expect(v.restingHr).toBeNull();
  });
  it('formats values', () => {
    const d: GarminData = {
      latestActivity: { id: '1', type: 'Running', startTime: at(-3600), durationSec: 2520, distanceM: 5234, sourceUrl: null },
      weekRunningDistanceM: 12000,
      weekCoverage: { start: at(-1), end: at(0), complete: true },
      stepsToday: { date: '2026-11-21', value: 4321 },
      sleepDurationSec: { date: '2026-11-21', value: 7 * 3600 + 5 * 60 },
      restingHeartRate: { date: '2026-11-21', value: 52 },
    };
    const v = garminView(d, NOW);
    expect(v.latest).toMatchObject({ duration: '0:42', distance: '5.2 km' });
    expect(v.week).toMatchObject({ running: '12.0 km', partial: false });
    expect(v.sleep.value).toBe('7:05');
    expect(v.restingHr?.value).toBe('52 bpm');
  });
});

describe('url and privacy', () => {
  it('rejects unsafe URLs', () => {
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('data:text/html,<b>x</b>')).toBeNull();
    expect(safeExternalUrl('/relative')).toBeNull();
    expect(safeExternalUrl(null)).toBeNull();
    expect(safeExternalUrl('https://example.com/a')).toBe('https://example.com/a');
  });
  it('masks briefing bullets that derive from private sources', () => {
    const b = (sources: Array<'google' | 'weather'>) => ({ text: 'Hello', factIds: [], sources });
    expect(bulletText(b(['google']), true)).toBe(MASK);
    expect(bulletText(b(['weather']), true)).toBe('Hello');
    expect(bulletText(b(['google']), false)).toBe('Hello');
  });
});
