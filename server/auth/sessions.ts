import { createHmac, randomBytes } from 'node:crypto';
import type { Db } from '../storage/db.js';

export const SESSION_COOKIE = 'desk_session';
export const SESSION_ABSOLUTE_MS = 30 * 86_400_000;
export const SESSION_IDLE_MS = 7 * 86_400_000;

export interface SessionStore {
  create(): { id: string; expiresAt: number };
  /** True if the cookie value maps to a live session; refreshes last_seen. */
  validate(id: string | undefined): boolean;
  destroy(id: string | undefined): void;
}

export function createSessionStore(db: Db, secret: string, now: () => Date): SessionStore {
  const hashId = (id: string) => createHmac('sha256', secret).update(id).digest('hex');
  const insert = db.prepare('INSERT INTO sessions (id_hash, created_at, expires_at, last_seen) VALUES (?, ?, ?, ?)');
  const find = db.prepare('SELECT expires_at, last_seen FROM sessions WHERE id_hash = ?');
  const touch = db.prepare('UPDATE sessions SET last_seen = ? WHERE id_hash = ?');
  const del = db.prepare('DELETE FROM sessions WHERE id_hash = ?');
  return {
    create() {
      const id = randomBytes(32).toString('base64url');
      const t = now().getTime();
      const expiresAt = t + SESSION_ABSOLUTE_MS;
      insert.run(hashId(id), t, expiresAt, t);
      return { id, expiresAt };
    },
    validate(id) {
      if (!id || id.length > 100) return false;
      const h = hashId(id);
      const row = find.get(h) as { expires_at: number; last_seen: number } | undefined;
      if (!row) return false;
      const t = now().getTime();
      if (t >= row.expires_at || t - row.last_seen >= SESSION_IDLE_MS) {
        del.run(h);
        return false;
      }
      touch.run(t, h);
      return true;
    },
    destroy(id) {
      if (id) del.run(hashId(id));
    },
  };
}
