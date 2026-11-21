/** In-memory failed-login limiter: max `max` attempts per key per window. Attempts are reserved before verifying. */
export interface LoginLimiter {
  /** Atomically (synchronously) counts an attempt. Returns 0 if allowed, else seconds until retry is allowed. */
  attempt(key: string): number;
  /** Refunds the most recent attempt (e.g. the attempt never reached a password check). */
  release(key: string): void;
  /** Clears the key (successful login). */
  reset(key: string): void;
}

const MAX_KEYS = 1000;

export function createLoginLimiter(now: () => Date, max = 5, windowMs = 15 * 60_000): LoginLimiter {
  const hits = new Map<string, number[]>();
  const recent = (key: string): number[] => {
    const t = now().getTime();
    return (hits.get(key) ?? []).filter((x) => t - x < windowMs);
  };
  const store = (key: string, list: number[]): void => {
    hits.delete(key); // re-insert so Map order tracks recency
    if (!list.length) return;
    hits.set(key, list);
    while (hits.size > MAX_KEYS) {
      const oldest = hits.keys().next().value;
      if (oldest === undefined) break;
      hits.delete(oldest);
    }
  };
  return {
    attempt(key) {
      const list = recent(key);
      if (list.length >= max) {
        store(key, list);
        const oldest = list[0] ?? 0;
        return Math.max(1, Math.ceil((oldest + windowMs - now().getTime()) / 1000));
      }
      list.push(now().getTime());
      store(key, list);
      return 0;
    },
    release(key) {
      const list = recent(key);
      list.pop();
      store(key, list);
    },
    reset(key) {
      hits.delete(key);
    },
  };
}
