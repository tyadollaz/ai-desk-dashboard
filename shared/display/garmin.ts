import type { DatedValue, GarminData } from '../contracts.js';
import { fmtDateKey, fmtDayMonth, fmtDuration, fmtTime, fmtWeekdayDayMonth, toMs, weekStartKey, dateKeyToMs } from './time.js';

export const UNAVAILABLE = 'Unavailable';

export interface GarminView {
  latest: null | { type: string; start: string; duration: string; distance: string };
  week: { label: string; running: string; partial: boolean };
  steps: { label: string; value: string };
  sleep: { label: string; value: string };
  restingHr: { label: string; value: string } | null;
}

function km(m: number | null): string {
  return m === null || m === undefined ? UNAVAILABLE : `${(m / 1000).toFixed(1)} km`;
}

function dated(prefix: string, v: DatedValue | null, format: (n: number) => string) {
  if (!v) return { label: prefix, value: UNAVAILABLE };
  return {
    label: `${prefix} (${fmtDateKey(v.date)})`,
    value: v.value === null || v.value === undefined ? UNAVAILABLE : format(v.value),
  };
}

/** Missing values display "Unavailable", never 0. */
export function garminView(d: GarminData, nowMs: number): GarminView {
  const a = d.latestActivity;
  const startMs = a ? toMs(a.startTime) : null;
  const latest = a
    ? {
        type: a.type ?? 'Activity',
        start: startMs === null ? UNAVAILABLE : `${fmtWeekdayDayMonth(startMs)} ${fmtTime(startMs)}`,
        duration: a.durationSec === null ? UNAVAILABLE : fmtDuration(a.durationSec),
        distance: km(a.distanceM),
      }
    : null;
  return {
    latest,
    week: {
      label: `Running this week (${fmtDayMonth(dateKeyToMs(weekStartKey(nowMs)))} – now)`,
      running: km(d.weekRunningDistanceM),
      partial: d.weekCoverage !== null && d.weekCoverage.complete === false,
    },
    steps: dated('Steps', d.stepsToday, (n) => Math.round(n).toLocaleString('en-SG')),
    sleep: dated('Sleep', d.sleepDurationSec, (n) => fmtDuration(n)),
    restingHr: d.restingHeartRate ? dated('Resting HR', d.restingHeartRate, (n) => `${Math.round(n)} bpm`) : null,
  };
}
