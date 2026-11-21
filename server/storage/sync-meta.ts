import type { ProviderId } from '../../shared/contracts.js';
import type { Db } from './db.js';

export interface SyncMeta {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  cooldownUntil: string | null;
  consecutiveFailures: number;
}

export interface SyncMetaStore {
  get(provider: ProviderId): SyncMeta | null;
  save(provider: ProviderId, meta: SyncMeta): void;
  delete(provider: ProviderId): void;
}

export function createSyncMetaStore(db: Db): SyncMetaStore {
  const get = db.prepare('SELECT * FROM sync_meta WHERE provider = ?');
  const save = db.prepare(
    `INSERT INTO sync_meta (provider, last_attempt_at, last_success_at, cooldown_until, consecutive_failures)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(provider) DO UPDATE SET last_attempt_at = excluded.last_attempt_at, last_success_at = excluded.last_success_at,
       cooldown_until = excluded.cooldown_until, consecutive_failures = excluded.consecutive_failures`,
  );
  const del = db.prepare('DELETE FROM sync_meta WHERE provider = ?');
  return {
    get(provider) {
      const r = get.get(provider) as
        | { last_attempt_at: string | null; last_success_at: string | null; cooldown_until: string | null; consecutive_failures: number }
        | undefined;
      return r
        ? {
            lastAttemptAt: r.last_attempt_at,
            lastSuccessAt: r.last_success_at,
            cooldownUntil: r.cooldown_until,
            consecutiveFailures: r.consecutive_failures,
          }
        : null;
    },
    save(provider, m) {
      save.run(provider, m.lastAttemptAt, m.lastSuccessAt, m.cooldownUntil, m.consecutiveFailures);
    },
    delete(provider) {
      del.run(provider);
    },
  };
}
