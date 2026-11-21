/** In-memory failed-login limiter: max `max` failures per key per window. */
export interface LoginLimiter {
  /** Seconds until retry is allowed, or 0 if the key may attempt. */
  blockedFor(key: string): number;
  fail(key: string): void;
  reset(key: string): void;
}

export function createLoginLimiter(now: () => Date, max = 5, windowMs = 15 * 60_000): LoginLimiter {
  const hits = new Map<string, number[]>();
  const recent = (key: string): number[] => {
    const t = now().getTime();
    const list = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
    if (list.length) hits.set(key, list);
    else hits.delete(key);
    return list;
  };
  return {
    blockedFor(key) {
      const list = recent(key);
      if (list.length < max) return 0;
      const oldest = list[0] ?? 0;
      return Math.max(1, Math.ceil((oldest + windowMs - now().getTime()) / 1000));
    },
    fail(key) {
      const list = recent(key);
      list.push(now().getTime());
      hits.set(key, list);
    },
    reset(key) {
      hits.delete(key);
    },
  };
}
