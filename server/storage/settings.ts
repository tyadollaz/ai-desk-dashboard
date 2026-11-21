import { DEFAULT_SETTINGS, settingsSchema, type Settings, type SettingsPatch } from '../../shared/contracts.js';
import type { Db } from './db.js';

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Section-level merge: stored sections override defaults, so new sections get defaults. */
function mergeDefaults(stored: unknown): Settings {
  const base = structuredClone(DEFAULT_SETTINGS) as Record<string, unknown>;
  if (isObj(stored)) {
    for (const [k, v] of Object.entries(stored)) {
      const def = base[k];
      base[k] = isObj(def) && isObj(v) ? { ...def, ...v } : v;
    }
  }
  const parsed = settingsSchema.safeParse(base);
  return parsed.success ? parsed.data : structuredClone(DEFAULT_SETTINGS);
}

export interface SettingsStore {
  get(): Settings;
  /** Replaces whole top-level sections from the patch, validates, persists. Throws ZodError if invalid. */
  patch(patch: SettingsPatch): Settings;
}

export function createSettingsStore(db: Db, now: () => Date = () => new Date()): SettingsStore {
  let cache: Settings | null = null;
  const read = db.prepare('SELECT json FROM settings WHERE id = 1');
  const write = db.prepare(
    'INSERT INTO settings (id, json, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at',
  );
  const load = (): Settings => {
    const row = read.get() as { json: string } | undefined;
    let stored: unknown = null;
    if (row) {
      try {
        stored = JSON.parse(row.json);
      } catch {
        stored = null;
      }
    }
    return mergeDefaults(stored);
  };
  return {
    get() {
      cache ??= load();
      return structuredClone(cache);
    },
    patch(patch) {
      cache ??= load();
      const next = settingsSchema.parse({ ...cache, ...patch });
      write.run(JSON.stringify(next), now().toISOString());
      cache = next;
      return structuredClone(next);
    },
  };
}
