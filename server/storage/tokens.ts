import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { ProviderId } from '../../shared/contracts.js';
import type { TokenStore } from '../providers/types.js';
import type { Db } from './db.js';

/** AES-256-GCM encrypted-at-rest JSON blobs. The provider id is bound as additional authenticated data. */
export function createTokenStore(db: Db, key: Buffer, now: () => Date = () => new Date()): TokenStore {
  if (key.length !== 32) throw new Error('Token encryption key must be 32 bytes');
  const get = db.prepare('SELECT ciphertext, iv, tag FROM provider_tokens WHERE provider = ?');
  const set = db.prepare(
    `INSERT INTO provider_tokens (provider, ciphertext, iv, tag, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(provider) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, tag = excluded.tag, updated_at = excluded.updated_at`,
  );
  const del = db.prepare('DELETE FROM provider_tokens WHERE provider = ?');
  return {
    async get(provider: ProviderId) {
      const row = get.get(provider) as { ciphertext: Buffer; iv: Buffer; tag: Buffer } | undefined;
      if (!row) return null;
      try {
        const d = createDecipheriv('aes-256-gcm', key, row.iv);
        d.setAAD(Buffer.from(provider));
        d.setAuthTag(row.tag);
        const plain = Buffer.concat([d.update(row.ciphertext), d.final()]).toString('utf8');
        return JSON.parse(plain) as Record<string, unknown>;
      } catch {
        // Wrong key or tampered data: treat as absent so the provider asks to reconnect.
        return null;
      }
    },
    async set(provider, value) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', key, iv);
      c.setAAD(Buffer.from(provider));
      const ciphertext = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
      set.run(provider, ciphertext, iv, c.getAuthTag(), now().toISOString());
    },
    async clear(provider) {
      del.run(provider);
    },
  };
}
