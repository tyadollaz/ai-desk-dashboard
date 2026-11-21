// Pure normalization for Garmin data.
// NOTE: GarminRawSnapshot is an INTERNAL adapter shape, not Garmin's wire format. A future live
// adapter must map verified Garmin API responses into it.
import type { Coverage, DatedValue, GarminActivity, GarminData } from '../../../shared/contracts.js';
import { DAY_MS, sgtDate, sgtStartOfDay } from '../../util/time.js';

export interface GarminRawActivity {
  id: string;
  type: string | null;
  startTime: string; // ISO instant
  durationSec: number | null;
  distanceM: number | null;
  sourceUrl?: string | null;
  updatedAt?: string | null; // ISO instant; later wins when the same id appears twice
}
export interface GarminRawDaily {
  date: string; // YYYY-MM-DD (Singapore date)
  steps?: number | null;
  sleepSec?: number | null;
  restingHr?: number | null;
}
export interface GarminRawSnapshot {
  activities: GarminRawActivity[];
  /** Instants actually fetched for `activities`. */
  activityWindow: { start: string; end: string };
  daily: GarminRawDaily[];
}

/** Monday 00:00 Asia/Singapore of the week containing `now`. */
export function sgtWeekStart(now: Date): Date {
  const dayStart = sgtStartOfDay(now);
  const dow = new Date(dayStart.getTime() + 8 * 3_600_000).getUTCDay(); // 0=Sun
  return new Date(dayStart.getTime() - ((dow + 6) % 7) * DAY_MS);
}

function ms(s: string | null | undefined): number {
  if (!s) return NaN;
  return Date.parse(s);
}

function dedupe(list: GarminRawActivity[]): GarminRawActivity[] {
  const byId = new Map<string, GarminRawActivity>();
  for (const a of list) {
    const prev = byId.get(a.id);
    if (!prev) {
      byId.set(a.id, a);
      continue;
    }
    const pu = ms(prev.updatedAt);
    const au = ms(a.updatedAt);
    // Later updatedAt wins; a known updatedAt beats an unknown one; ties keep the later entry.
    if (Number.isNaN(pu) ? true : !Number.isNaN(au) && au >= pu) byId.set(a.id, a);
  }
  return [...byId.values()];
}

function latestDated(daily: GarminRawDaily[], pick: (d: GarminRawDaily) => number | null | undefined): DatedValue | null {
  let best: DatedValue | null = null;
  for (const d of daily) {
    const v = pick(d);
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    if (!best || d.date > best.date) best = { date: d.date, value: v };
  }
  return best;
}

export function normalizeGarmin(raw: GarminRawSnapshot, now: Date): GarminData {
  const activities = dedupe(raw.activities);

  let latest: GarminRawActivity | null = null;
  for (const a of activities) {
    const t = ms(a.startTime);
    if (Number.isNaN(t)) continue;
    if (!latest || t > ms(latest.startTime)) latest = a;
  }
  const latestActivity: GarminActivity | null = latest && {
    id: latest.id,
    type: latest.type,
    startTime: new Date(ms(latest.startTime)).toISOString(),
    durationSec: latest.durationSec,
    distanceM: latest.distanceM,
    sourceUrl: latest.sourceUrl ?? null,
  };

  const weekStart = sgtWeekStart(now);
  const winStart = ms(raw.activityWindow.start);
  const winEnd = ms(raw.activityWindow.end);
  let complete = !Number.isNaN(winStart) && !Number.isNaN(winEnd) && winStart <= weekStart.getTime() && winEnd >= now.getTime();

  let sum = 0;
  for (const a of activities) {
    const t = ms(a.startTime);
    if (Number.isNaN(t) || t < weekStart.getTime() || t > now.getTime()) continue;
    if (!a.type || !/run/i.test(a.type)) continue;
    if (a.distanceM === null || a.distanceM === undefined || !Number.isFinite(a.distanceM)) {
      complete = false; // run with unknown distance: partial total
      continue;
    }
    sum += a.distanceM;
  }
  const weekCoverage: Coverage = { start: weekStart.toISOString(), end: now.toISOString(), complete };

  const today = sgtDate(now);
  const todayEntry = raw.daily.find((d) => d.date === today);
  const steps = todayEntry?.steps;
  const stepsToday: DatedValue | null = todayEntry ? { date: today, value: steps === undefined || steps === null || !Number.isFinite(steps) ? null : steps } : null;

  return {
    latestActivity,
    weekRunningDistanceM: sum,
    weekCoverage,
    stepsToday,
    sleepDurationSec: latestDated(raw.daily, (d) => d.sleepSec),
    restingHeartRate: latestDated(raw.daily, (d) => d.restingHr),
  };
}
