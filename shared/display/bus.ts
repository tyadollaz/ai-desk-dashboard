import type { BusArrival, BusLoad } from '../contracts.js';
import { toMs, type TimeInput } from './time.js';

export const BUS_STALE_MS = 90_000;
export const BUS_EXPIRE_MS = 60_000;

const LOAD_TEXT: Record<BusLoad, string> = {
  SEA: 'Seats available',
  SDA: 'Standing available',
  LSD: 'Limited standing',
};

export function occupancyText(load: BusLoad | null): string | null {
  return load ? (LOAD_TEXT[load] ?? null) : null;
}

/** True when the last successful fetch is more than 90 s old (or never happened). */
export function isBusStale(lastSuccessAt: TimeInput, nowMs: number): boolean {
  const ms = toMs(lastSuccessAt);
  return ms === null || nowMs - ms > BUS_STALE_MS;
}

export interface ArrivalView {
  kind: 'minutes' | 'arriving' | 'none' | 'update';
  text: string;
  occupancy: string | null;
  scheduled: boolean;
}

/** Countdown text for one estimate, or null if the estimate has expired (>60 s in the past). */
export function arrivalCountdown(estimate: string | null, nowMs: number): Pick<ArrivalView, 'kind' | 'text'> | null {
  if (estimate === null) return { kind: 'none', text: 'No estimate' };
  const ms = toMs(estimate);
  if (ms === null) return { kind: 'none', text: 'No estimate' };
  const seconds = (ms - nowMs) / 1000;
  if (seconds < -BUS_EXPIRE_MS / 1000) return null;
  if (seconds < 60) return { kind: 'arriving', text: 'Arriving' };
  return { kind: 'minutes', text: `${Math.floor(seconds / 60)} min` };
}

/** Next (up to 3) arrival views for a service. When stale, every countdown becomes "Update needed". */
export function busArrivalViews(arrivals: BusArrival[], nowMs: number, stale: boolean): ArrivalView[] {
  const out: ArrivalView[] = [];
  for (const a of arrivals) {
    const c = arrivalCountdown(a.estimatedArrival, nowMs);
    if (c === null) continue;
    out.push({
      kind: stale ? 'update' : c.kind,
      text: stale ? 'Update needed' : c.text,
      occupancy: occupancyText(a.load),
      scheduled: a.monitored === false,
    });
    if (out.length === 3) break;
  }
  return out;
}
