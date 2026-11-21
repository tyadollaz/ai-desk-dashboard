import { DISPLAY_TIMEZONE } from '../../shared/contracts.js';

export const SGT_OFFSET_MS = 8 * 3_600_000;
export const DAY_MS = 86_400_000;

/** YYYY-MM-DD of the given instant in Asia/Singapore (fixed UTC+8, no DST). */
export function sgtDate(d: Date): string {
  return new Date(d.getTime() + SGT_OFFSET_MS).toISOString().slice(0, 10);
}

/** Instant of 00:00 Singapore time on the day containing `d`. */
export function sgtStartOfDay(d: Date): Date {
  return new Date(Math.floor((d.getTime() + SGT_OFFSET_MS) / DAY_MS) * DAY_MS - SGT_OFFSET_MS);
}

const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: DISPLAY_TIMEZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function pick(d: Date): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of parts.formatToParts(d)) out[p.type] = p.value;
  return out;
}

/** e.g. "Sat 21 Nov, 14:00" in Singapore time. */
export function formatSgtDateTime(d: Date): string {
  const p = pick(d);
  return `${p.weekday} ${p.day} ${p.month}, ${p.hour}:${p.minute}`;
}

export function formatSgtTime(d: Date): string {
  const p = pick(d);
  return `${p.hour}:${p.minute}`;
}

/** e.g. "Sat 21 Nov" for a YYYY-MM-DD date-only value. */
export function formatDateOnly(date: string): string {
  const p = pick(new Date(`${date}T12:00:00+08:00`));
  return `${p.weekday} ${p.day} ${p.month}`;
}
