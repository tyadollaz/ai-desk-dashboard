import type { Coverage, Mode, ProviderId } from '../../shared/contracts.js';
import type { Db } from './db.js';

export interface SnapshotPayload {
  data: unknown;
  sourceUpdatedAt: string | null;
  validUntil: string | null;
  coverage: Coverage | null;
  detailUrl: string | null;
  lastSuccessAt: string;
}

export interface SnapshotStore {
  /** Returns the snapshot only if its mode AND config key match; otherwise deletes it and returns null. */
  get(provider: ProviderId, mode: Mode, configKey: string): SnapshotPayload | null;
  save(provider: ProviderId, mode: Mode, configKey: string, payload: SnapshotPayload, nowIso: string): void;
  delete(provider: ProviderId): void;
  /** Removes every snapshot not belonging to `mode`; returns the affected providers. */
  purgeOtherModes(mode: Mode): ProviderId[];
}

export function createSnapshotStore(db: Db): SnapshotStore {
  const get = db.prepare('SELECT mode, config_key, payload FROM snapshots WHERE provider = ?');
  const del = db.prepare('DELETE FROM snapshots WHERE provider = ?');
  const save = db.prepare(
    `INSERT INTO snapshots (provider, mode, config_key, payload, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(provider) DO UPDATE SET mode = excluded.mode, config_key = excluded.config_key,
       payload = excluded.payload, updated_at = excluded.updated_at`,
  );
  return {
    get(provider, mode, configKey) {
      const row = get.get(provider) as { mode: string; config_key: string; payload: string } | undefined;
      if (!row) return null;
      if (row.mode !== mode || row.config_key !== configKey) {
        del.run(provider);
        return null;
      }
      try {
        return JSON.parse(row.payload) as SnapshotPayload;
      } catch {
        del.run(provider);
        return null;
      }
    },
    save(provider, mode, configKey, payload, nowIso) {
      save.run(provider, mode, configKey, JSON.stringify(payload), nowIso);
    },
    delete(provider) {
      del.run(provider);
    },
    purgeOtherModes(mode) {
      const rows = db.prepare('SELECT provider FROM snapshots WHERE mode != ?').all(mode) as { provider: ProviderId }[];
      db.prepare('DELETE FROM snapshots WHERE mode != ?').run(mode);
      return rows.map((r) => r.provider);
    },
  };
}
