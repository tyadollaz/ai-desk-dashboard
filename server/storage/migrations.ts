import type { Db } from './db.js';

interface Migration {
  id: number;
  name: string;
  sql: string;
}

// Append-only. Never edit a released migration; add a new one.
export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'initial schema',
    sql: `
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id_hash TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS provider_tokens (
        provider TEXT PRIMARY KEY,
        ciphertext BLOB NOT NULL,
        iv BLOB NOT NULL,
        tag BLOB NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS snapshots (
        provider TEXT PRIMARY KEY,
        mode TEXT NOT NULL CHECK (mode IN ('live', 'demo')),
        config_key TEXT NOT NULL,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sync_meta (
        provider TEXT PRIMARY KEY,
        last_attempt_at TEXT,
        last_success_at TEXT,
        cooldown_until TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS ai_usage (
        date TEXT PRIMARY KEY,
        count INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS garmin_activities (
        id TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        start_time TEXT,
        updated_at TEXT NOT NULL
      );
    `,
  },
];

export function runMigrations(db: Db, migrations: Migration[] = MIGRATIONS): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const applied = new Set((db.prepare('SELECT id FROM schema_migrations').all() as { id: number }[]).map((r) => r.id));
  const insert = db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)');
  for (const m of [...migrations].sort((a, b) => a.id - b.id)) {
    if (applied.has(m.id)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      insert.run(m.id, m.name, new Date().toISOString());
    })();
  }
}
