import { verify } from '@node-rs/argon2';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Config } from '../config.js';

const sha = (s: string) => createHash('sha256').update(s).digest();

export type PasswordCheck = 'ok' | 'bad' | 'not_configured';

export async function checkOwnerPassword(config: Config, password: string): Promise<PasswordCheck> {
  if (config.ownerPasswordHash) {
    try {
      return (await verify(config.ownerPasswordHash, password)) ? 'ok' : 'bad';
    } catch {
      return 'bad'; // malformed hash: never authenticate
    }
  }
  if (config.demoPasswordEnabled) return timingSafeEqual(sha(password), sha('demo')) ? 'ok' : 'bad';
  return 'not_configured';
}
