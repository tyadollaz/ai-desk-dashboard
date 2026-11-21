import { isIP } from 'node:net';
import { ProviderError, type HttpClient, type HttpResponse } from '../providers/types.js';

export interface HttpClientOptions {
  allowedHosts: string[];
  fetchImpl?: typeof fetch;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** Test hooks. */
  timeoutMs?: number;
  maxRetries?: number;
  random?: () => number;
}

export interface RequestInitEx {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  /** Caller cancellation, combined with the internal timeout. */
  signal?: AbortSignal;
}

const MAX_REDIRECTS = 3;
const BASE_BACKOFF_MS = 500;
const DEFAULT_RETRY_AFTER_MS = 60_000;
const MAX_RETRY_AFTER_MS = 24 * 3_600_000;

export function parseRetryAfter(value: string | null, nowMs: number): number {
  if (!value) return DEFAULT_RETRY_AFTER_MS;
  const v = value.trim();
  let ms: number;
  if (/^\d+$/.test(v)) ms = Number(v) * 1000;
  else {
    const at = Date.parse(v);
    if (Number.isNaN(at)) return DEFAULT_RETRY_AFTER_MS;
    ms = Math.max(0, at - nowMs);
  }
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}

const REDIRECT = new Set([301, 302, 303, 307, 308]);

export function createHttpClient(opts: HttpClientOptions): HttpClient {
  const allowed = new Set(opts.allowedHosts.map((h) => h.toLowerCase()));
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => new Date());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxRetries = opts.maxRetries ?? 2;
  const random = opts.random ?? Math.random;

  function validate(raw: string): URL {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      throw new ProviderError('internal', 'Blocked request: invalid URL');
    }
    if (u.protocol !== 'https:') throw new ProviderError('internal', 'Blocked request: only https is allowed');
    if (u.username || u.password) throw new ProviderError('internal', 'Blocked request: credentials in URL are not allowed');
    if (u.port && u.port !== '443') throw new ProviderError('internal', 'Blocked request: non-standard port');
    const host = u.hostname.toLowerCase().replace(/\.$/, '');
    const bare = host.replace(/^\[|\]$/g, '');
    if (
      isIP(bare) ||
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      throw new ProviderError('internal', 'Blocked request: private or IP-literal hosts are not allowed');
    }
    if (!allowed.has(host)) throw new ProviderError('internal', 'Blocked request: host is not allow-listed');
    return u;
  }

  async function sendWithRetry(
    url: URL,
    method: string,
    headers: Record<string, string>,
    body: string | undefined,
    caller: AbortSignal | undefined,
  ): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = caller ? AbortSignal.any([timeout, caller]) : timeout;
      let res: Response;
      try {
        res = await fetchImpl(url.href, { method, headers, body, redirect: 'manual', signal });
      } catch {
        if (caller?.aborted) throw new ProviderError('network', 'Request was cancelled');
        const isTimeout = timeout.aborted;
        if (attempt < maxRetries) {
          await sleep(random() * BASE_BACKOFF_MS * 2 ** attempt);
          continue;
        }
        throw isTimeout
          ? new ProviderError('timeout', 'The service did not respond in time', { retryable: true })
          : new ProviderError('network', 'Could not reach the service', { retryable: true });
      }
      if (res.status >= 500) {
        void res.body?.cancel().catch(() => undefined);
        if (attempt < maxRetries) {
          await sleep(random() * BASE_BACKOFF_MS * 2 ** attempt);
          continue;
        }
        throw new ProviderError('upstream', `The service reported an error (HTTP ${res.status})`, { retryable: true });
      }
      return res;
    }
  }

  return {
    async request(rawUrl, init: RequestInitEx = {}): Promise<HttpResponse> {
      let method = init.method ?? 'GET';
      let body = init.body;
      let headers: Record<string, string> = { ...init.headers };
      let url = validate(rawUrl);
      for (let redirects = 0; ; redirects++) {
        const res = await sendWithRetry(url, method, headers, body, init.signal);
        if (REDIRECT.has(res.status)) {
          void res.body?.cancel().catch(() => undefined);
          const loc = res.headers.get('location');
          if (!loc || redirects >= MAX_REDIRECTS) throw new ProviderError('upstream', 'Too many or invalid redirects');
          let next: URL;
          try {
            next = validate(new URL(loc, url).href);
          } catch {
            throw new ProviderError('upstream', 'Blocked redirect to a disallowed location');
          }
          // Never forward credentials to a different host.
          if (next.host !== url.host) headers = {};
          if (res.status === 303) {
            method = 'GET';
            body = undefined;
          }
          url = next;
          continue;
        }
        if (res.status === 429) {
          void res.body?.cancel().catch(() => undefined);
          const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'), now().getTime());
          throw new ProviderError('rate_limited', 'The service is rate limiting requests; try again later', { retryAfterMs });
        }
        if (res.status === 401 || res.status === 403) {
          void res.body?.cancel().catch(() => undefined);
          throw new ProviderError('auth_failed', 'The service rejected the credentials');
        }
        if (res.status < 200 || res.status >= 300) {
          void res.body?.cancel().catch(() => undefined);
          throw new ProviderError('upstream', `The service returned an unexpected response (HTTP ${res.status})`);
        }
        return {
          status: res.status,
          headers: res.headers,
          async json() {
            try {
              return await res.json();
            } catch {
              throw new ProviderError('malformed', 'The service returned an unreadable response');
            }
          },
          text: () => res.text(),
        };
      }
    },
  };
}
