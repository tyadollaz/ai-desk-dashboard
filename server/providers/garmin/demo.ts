// Synthetic DEMO Garmin data. No network calls.
import { DAY_MS, sgtDate, sgtStartOfDay } from '../../util/time.js';
import type { AdapterFactory } from '../types.js';

export const createDemoAdapter: AdapterFactory<'garmin'> = ({ now }) => ({
  id: 'garmin',
  mode: 'demo',
  async setupStatus() {
    return { connection: 'connected', requirement: null };
  },
  configKey: () => 'demo',
  async fetch() {
    const current = now();
    const today = sgtDate(current);
    const dayStart = sgtStartOfDay(current);
    const sinceMonday = (new Date(dayStart.getTime() + 8 * 3_600_000).getUTCDay() + 6) % 7;
    const weekStart = new Date(dayStart.getTime() - sinceMonday * DAY_MS);
    return {
      data: {
        latestActivity: {
          id: 'demo-run-1',
          type: 'running',
          startTime: new Date(current.getTime() - 20 * 3_600_000).toISOString(),
          durationSec: 2700,
          distanceM: 7500,
          sourceUrl: null,
        },
        weekRunningDistanceM: 18200,
        weekCoverage: { start: weekStart.toISOString(), end: current.toISOString(), complete: true },
        stepsToday: { date: today, value: 6420 },
        sleepDurationSec: { date: today, value: 7 * 3600 + 30 * 60 },
        restingHeartRate: null, // demo: intentionally unavailable
      },
      sourceUpdatedAt: current.toISOString(),
      validUntil: null,
      coverage: { start: weekStart.toISOString(), end: current.toISOString(), complete: true },
      detailUrl: null,
    };
  },
});
