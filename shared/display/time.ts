// Pure time helpers. All display is in Asia/Singapore (UTC+8, no DST).
export const DISPLAY_TZ = 'Asia/Singapore';
const SG_OFFSET_MS = 8 * 3600_000;
export const DAY_MS = 86_400_000;

export type TimeInput = string | number | Date | null | undefined;

export function toMs(t: TimeInput): number | null {
  if (t === null || t === undefined) return null;
  if (typeof t === 'number') return t;
  if (t instanceof Date) return t.getTime();
  const v = Date.parse(t);
  return Number.isNaN(v) ? null : v;
}

function parts(ms: number, opts: Intl.DateTimeFormatOptions): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-SG', { timeZone: DISPLAY_TZ, hourCycle: 'h23', ...opts }).formatToParts(ms)) {
    out[p.type] = p.value;
  }
  return out;
}

/** "YYYY-MM-DD" of the Singapore calendar day containing the instant. */
export function sgDateKey(ms: number): string {
  return new Date(ms + SG_OFFSET_MS).toISOString().slice(0, 10);
}

/** Instant of 00:00 Singapore time on a "YYYY-MM-DD" key. */
export function dateKeyToMs(key: string): number {
  return Date.parse(`${key}T00:00:00+08:00`);
}

export function addDaysKey(key: string, days: number): string {
  return sgDateKey(dateKeyToMs(key) + days * DAY_MS);
}

/** Whole Singapore calendar days from b to a (a - b). */
export function dayDiff(aMs: number, bMs: number): number {
  return Math.round((dateKeyToMs(sgDateKey(aMs)) - dateKeyToMs(sgDateKey(bMs))) / DAY_MS);
}

/** Monday of the Singapore week containing the instant, as a date key. */
export function weekStartKey(ms: number): string {
  const dow = new Date(ms + SG_OFFSET_MS).getUTCDay(); // 0 = Sunday
  return addDaysKey(sgDateKey(ms), -((dow + 6) % 7));
}

export function fmtTime(t: TimeInput): string {
  const ms = toMs(t);
  if (ms === null) return '--:--';
  const p = parts(ms, { hour: '2-digit', minute: '2-digit' });
  return `${p.hour ?? ''}:${p.minute ?? ''}`;
}

export function fmtClock(t: TimeInput): string {
  const ms = toMs(t);
  if (ms === null) return '--:--:--';
  const p = parts(ms, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return `${p.hour ?? ''}:${p.minute ?? ''}:${p.second ?? ''}`;
}

export function fmtWeekday(ms: number): string {
  return parts(ms, { weekday: 'short' }).weekday ?? '';
}

/** "21 Nov" */
export function fmtDayMonth(t: TimeInput): string {
  const ms = toMs(t);
  if (ms === null) return '';
  const p = parts(ms, { day: 'numeric', month: 'short' });
  return `${p.day ?? ''} ${p.month ?? ''}`;
}

/** "Sat 21 Nov" */
export function fmtWeekdayDayMonth(t: TimeInput): string {
  const ms = toMs(t);
  if (ms === null) return '';
  return `${fmtWeekday(ms)} ${fmtDayMonth(ms)}`;
}

/** "Saturday, 21 November 2026" */
export function fmtDateLong(t: TimeInput): string {
  const ms = toMs(t);
  if (ms === null) return '';
  const p = parts(ms, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return `${p.weekday ?? ''}, ${p.day ?? ''} ${p.month ?? ''} ${p.year ?? ''}`;
}

/** "Tue 14:00" */
export function fmtWeekdayTime(t: TimeInput): string {
  const ms = toMs(t);
  if (ms === null) return '';
  return `${fmtWeekday(ms)} ${fmtTime(ms)}`;
}

/** "Sat 21 Nov" for a "YYYY-MM-DD" key. */
export function fmtDateKey(key: string): string {
  return fmtWeekdayDayMonth(dateKeyToMs(key));
}

/** Seconds -> "h:mm". */
export function fmtDuration(sec: number): string {
  const total = Math.max(0, Math.round(sec / 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** "in 2 days, Tue 14:00" / "in 35 min, Tue 14:00" / "3 h ago, Sat 09:00" */
export function relativeDue(t: TimeInput, nowMs: number): string {
  const ms = toMs(t);
  if (ms === null) return '';
  const abs = fmtWeekdayTime(ms);
  const diffMs = ms - nowMs;
  const days = dayDiff(ms, nowMs);
  let rel: string;
  if (diffMs >= 0) {
    if (days >= 2) rel = `in ${days} days`;
    else if (days === 1) rel = 'tomorrow';
    else if (diffMs < 3600_000) rel = `in ${Math.max(1, Math.floor(diffMs / 60_000))} min`;
    else rel = `in ${Math.floor(diffMs / 3600_000)} h`;
  } else {
    const ago = -diffMs;
    if (days <= -2) rel = `${-days} days ago`;
    else if (days === -1) rel = 'yesterday';
    else if (ago < 3600_000) rel = `${Math.max(1, Math.floor(ago / 60_000))} min ago`;
    else rel = `${Math.floor(ago / 3600_000)} h ago`;
  }
  return `${rel}, ${abs}`;
}
