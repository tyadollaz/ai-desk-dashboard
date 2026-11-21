import type { Db } from './db.js';

const DAY = 86_400_000;
/** Longest display window (Canvas: 14 days ahead) + 7 day buffer. */
export const SNAPSHOT_RETENTION_MS = (14 + 7) * DAY;
export const GARMIN_RETENTION_MS = 21 * DAY;

export function runRetention(db: Db, now: Date): void {
  const nowMs = now.getTime();
  db.prepare('DELETE FROM snapshots WHERE updated_at < ?').run(new Date(nowMs - SNAPSHOT_RETENTION_MS).toISOString());
  db.prepare('DELETE FROM garmin_activities WHERE COALESCE(start_time, updated_at) < ?').run(new Date(nowMs - GARMIN_RETENTION_MS).toISOString());
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowMs);
}

/** Runs once now and then hourly. Returns a stop function. */
export function startRetention(db: Db, now: () => Date): () => void {
  runRetention(db, now());
  const t = setInterval(() => runRetention(db, now()), 3_600_000);
  t.unref();
  return () => clearInterval(t);
}
