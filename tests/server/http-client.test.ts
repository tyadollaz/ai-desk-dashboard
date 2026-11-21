import { describe, expect, it, vi } from 'vitest';
import { createHttpClient } from '../../server/http/client.js';
import { ProviderError } from '../../server/providers/types.js';

const ok = (body: unknown = {}) => new Response(JSON.stringify(body), { status: 200 });
const mk = (fetchImpl: (...a: never[]) => Promise<Response>, extra = {}) => {
  const sleep = vi.fn(async () => undefined);
  const client = createHttpClient({
    allowedHosts: ['api.example.com'],
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep,
    now: () => new Date('2026-11-21T00:00:00Z'),
    ...extra,
  });
  return { client, sleep };
};
const rejects = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as ProviderError;
  }
  throw new Error('expected rejection');
};

describe('http client', () => {
  it('returns json on success', async () => {
    const { client } = mk(async () => ok({ a: 1 }));
    expect(await (await client.request('https://api.example.com/x')).json()).toEqual({ a: 1 });
  });

  it('429 -> rate_limited honoring Retry-After seconds and HTTP-date; default 60s', async () => {
    let header: string | null = '120';
    const f = vi.fn(async () => new Response('', { status: 429, headers: header ? { 'retry-after': header } : {} }));
    const { client } = mk(f);
    let e = await rejects(client.request('https://api.example.com/x'));
    expect(e).toMatchObject({ code: 'rate_limited', opts: { retryAfterMs: 120_000 } });
    expect(f).toHaveBeenCalledTimes(1);
    header = 'Sat, 21 Nov 2026 00:00:30 GMT';
    e = await rejects(client.request('https://api.example.com/x'));
    expect(e.opts.retryAfterMs).toBe(30_000);
    header = null;
    e = await rejects(client.request('https://api.example.com/x'));
    expect(e.opts.retryAfterMs).toBe(60_000);
  });

  it('retries 5xx twice then fails; recovers if a retry succeeds', async () => {
    const f = vi.fn(async () => new Response('', { status: 503 }));
    const { client, sleep } = mk(f);
    const e = await rejects(client.request('https://api.example.com/x'));
    expect(e.code).toBe('upstream');
    expect(f).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);

    const g = vi.fn().mockResolvedValueOnce(new Response('', { status: 500 })).mockResolvedValueOnce(ok({ fine: true }));
    const { client: c2 } = mk(g);
    expect(await (await c2.request('https://api.example.com/x')).json()).toEqual({ fine: true });
  });

  it('retries network errors', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const { client } = mk(f);
    expect((await rejects(client.request('https://api.example.com/x'))).code).toBe('network');
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('401/403 -> auth_failed, not retried; other 4xx -> upstream', async () => {
    for (const status of [401, 403]) {
      const f = vi.fn(async () => new Response('', { status }));
      const { client } = mk(f);
      expect((await rejects(client.request('https://api.example.com/x'))).code).toBe('auth_failed');
      expect(f).toHaveBeenCalledTimes(1);
    }
    const { client } = mk(async () => new Response('', { status: 404 }));
    expect((await rejects(client.request('https://api.example.com/x'))).code).toBe('upstream');
  });

  it('rejects disallowed host, http://, IP literals, localhost, odd ports without calling fetch', async () => {
    const f = vi.fn(async () => ok());
    const { client } = mk(f, { allowedHosts: ['api.example.com', '127.0.0.1', 'localhost'] });
    for (const url of [
      'https://evil.example.com/x',
      'http://api.example.com/x',
      'https://127.0.0.1/x',
      'https://[::1]/x',
      'https://localhost/x',
      'https://api.example.com:8443/x',
      'https://user:pw@api.example.com/x',
    ]) {
      expect((await rejects(client.request(url))).code).toBe('internal');
    }
    expect(f).not.toHaveBeenCalled();
  });

  it('follows allow-listed https redirects (<=3), rejects other hosts, strips headers cross-host', async () => {
    const f = vi.fn();
    f.mockResolvedValueOnce(new Response('', { status: 302, headers: { location: 'https://api.example.com/y' } })).mockResolvedValueOnce(ok({ done: 1 }));
    const { client } = mk(f);
    expect(await (await client.request('https://api.example.com/x')).json()).toEqual({ done: 1 });
    expect(f.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });

    const g = vi.fn(async () => new Response('', { status: 302, headers: { location: 'https://evil.example.com/' } }));
    const { client: c2 } = mk(g);
    expect((await rejects(c2.request('https://api.example.com/x'))).code).toBe('upstream');
    expect(g).toHaveBeenCalledTimes(1);

    const h = vi.fn(async () => new Response('', { status: 302, headers: { location: 'http://api.example.com/' } }));
    expect((await rejects(mk(h).client.request('https://api.example.com/x'))).code).toBe('upstream');

    const loop = vi.fn(async () => new Response('', { status: 302, headers: { location: 'https://api.example.com/loop' } }));
    expect((await rejects(mk(loop).client.request('https://api.example.com/x'))).code).toBe('upstream');
    expect(loop).toHaveBeenCalledTimes(4);

    const hdr = vi.fn();
    hdr.mockResolvedValueOnce(new Response('', { status: 302, headers: { location: 'https://other.example.com/z' } })).mockResolvedValueOnce(ok());
    await mk(hdr, { allowedHosts: ['api.example.com', 'other.example.com'] }).client.request('https://api.example.com/x', { headers: { authorization: 'Bearer SECRET' } });
    expect(hdr.mock.calls[1]?.[1]).toMatchObject({ headers: {} });
  });

  it('times out (retrying) and reports timeout', async () => {
    const f = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_res, rej) => init.signal?.addEventListener('abort', () => rej(init.signal?.reason))),
    );
    const { client } = mk(f as never, { timeoutMs: 20 });
    expect((await rejects(client.request('https://api.example.com/x'))).code).toBe('timeout');
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('caller abort is not retried', async () => {
    const ac = new AbortController();
    const f = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_res, rej) => init.signal?.addEventListener('abort', () => rej(init.signal?.reason))),
    );
    const { client } = mk(f as never);
    const p = rejects((client as { request(u: string, i: object): Promise<unknown> }).request('https://api.example.com/x', { signal: ac.signal }));
    ac.abort();
    expect((await p).code).toBe('network');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('malformed JSON -> malformed', async () => {
    const { client } = mk(async () => new Response('not json', { status: 200 }));
    const res = await client.request('https://api.example.com/x');
    expect((await rejects(res.json())).code).toBe('malformed');
  });
});
