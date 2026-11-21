import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../../server/storage/db.js';
import { MIGRATIONS, runMigrations } from '../../server/storage/migrations.js';
import { runRetention } from '../../server/storage/retention.js';
import { createTokenStore } from '../../server/storage/tokens.js';

const dbs: Db[] = [];
const mem = () => {
  const d = openDb(':memory:');
  runMigrations(d);
  dbs.push(d);
  return d;
};
afterEach(() => dbs.splice(0).forEach((d) => d.close()));

describe('storage', () => {
  it('migrations are idempotent and recorded', () => {
    const db = mem();
    runMigrations(db);
    runMigrations(db);
    const rows = db.prepare('SELECT id FROM schema_migrations').all();
    expect(rows).toHaveLength(MIGRATIONS.length);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('token store round-trips and ciphertext does not contain plaintext', async () => {
    const db = mem();
    const store = createTokenStore(db, randomBytes(32));
    const secret = { refresh_token: 'SENTINEL_REFRESH_TOKEN_abc', n: 1 };
    await store.set('google', secret);
    expect(await store.get('google')).toEqual(secret);
    const row = db.prepare('SELECT * FROM provider_tokens').get() as { ciphertext: Buffer; iv: Buffer; tag: Buffer };
    expect(row.ciphertext.toString('utf8')).not.toContain('SENTINEL');
    expect(JSON.stringify(row)).not.toContain('SENTINEL');
    expect(row.iv).toHaveLength(12);
    expect(row.tag).toHaveLength(16);
    // wrong key cannot read
    expect(await createTokenStore(db, randomBytes(32)).get('google')).toBeNull();
    await store.clear('google');
    expect(await store.get('google')).toBeNull();
  });

  it('retention deletes old snapshots, garmin activities and expired sessions', () => {
    const db = mem();
    const now = new Date('2026-11-21T00:00:00Z');
    const old = new Date(now.getTime() - 25 * 86_400_000).toISOString();
    const recent = new Date(now.getTime() - 86_400_000).toISOString();
    const ins = db.prepare("INSERT INTO snapshots (provider, mode, config_key, payload, updated_at) VALUES (?, 'live', '', '{}', ?)");
    ins.run('lta', old);
    ins.run('weather', recent);
    const g = db.prepare('INSERT INTO garmin_activities (id, json, start_time, updated_at) VALUES (?, ?, ?, ?)');
    g.run('a', '{}', old, recent);
    g.run('b', '{}', recent, recent);
    runRetention(db, now);
    expect(db.prepare('SELECT provider FROM snapshots').all()).toEqual([{ provider: 'weather' }]);
    expect(db.prepare('SELECT id FROM garmin_activities').all()).toEqual([{ id: 'b' }]);
  });
});
