import { describe, expect, it } from 'vitest';
import { createLiveAdapter, MAX_PAGES } from '../../../server/providers/canvas/live.js';
import { ProviderError, type HttpClient, type HttpResponse, type ProviderDeps } from '../../../server/providers/types.js';
import { DEFAULT_SETTINGS } from '../../../shared/contracts.js';
import { Clock } from '../helpers.js';
import { BASE, assignment8, assignmentItem, noteItem, undatedDueItem, wikiItem } from '../../fixtures/canvas/planner.js';

const TOKEN = 'tok_SECRET_123';
type Handler = (url: string, headers: Record<string, string>) => { body: unknown; link?: string } | Error;

function setup(handler: Handler, env: Record<string, string | undefined> = {}, clock = new Clock()) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const http: HttpClient = {
    async request(url, init) {
      const headers = init?.headers ?? {};
      calls.push({ url, headers });
      const r = handler(url, headers);
      if (r instanceof Error) throw r;
      const res: HttpResponse = {
        status: 200,
        headers: new Headers(r.link ? { link: r.link } : {}),
        json: async () => r.body,
        text: async () => JSON.stringify(r.body),
      };
      return res;
    },
  };
  const deps: ProviderDeps = {
    env: { CANVAS_BASE_URL: BASE, CANVAS_ACCESS_TOKEN: TOKEN, ...env },
    now: clock.now,
    http,
    tokens: { get: async () => null, set: async () => {}, clear: async () => {} },
  };
  return { adapter: createLiveAdapter(deps), calls, clock };
}
const run = (a: ReturnType<typeof setup>['adapter']) => a.fetch(DEFAULT_SETTINGS, new AbortController().signal);
const next = (n: number) => `<${BASE}/api/v1/planner/items?page=${n}&per_page=100>; rel="next"`;

describe('canvas live adapter', () => {
  it('setupStatus reports requirements', async () => {
    expect((await setup(() => ({ body: [] }), { CANVAS_ACCESS_TOKEN: undefined }).adapter.setupStatus(DEFAULT_SETTINGS)).requirement).toMatch(/CANVAS_ACCESS_TOKEN/);
    expect((await setup(() => ({ body: [] }), { CANVAS_BASE_URL: 'http://x.edu' }).adapter.setupStatus(DEFAULT_SETTINGS)).requirement).toBe('CANVAS_BASE_URL must be an https URL');
    expect((await setup(() => ({ body: [] })).adapter.setupStatus(DEFAULT_SETTINGS)).connection).toBe('connected');
  });

  it('empty list is valid; token only in Authorization header; window is -7d..+14d', async () => {
    const { adapter, calls, clock } = setup(() => ({ body: [] }));
    const r = await run(adapter);
    expect(r.data.items).toEqual([]);
    expect(r.coverage).toEqual({ start: r.data.windowStart, end: r.data.windowEnd, complete: true });
    expect(Date.parse(r.data.windowStart)).toBe(clock.t - 7 * 86_400_000);
    expect(Date.parse(r.data.windowEnd)).toBe(clock.t + 14 * 86_400_000);
    expect(calls[0]!.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls.every((c) => !c.url.includes(TOKEN))).toBe(true);
  });

  it('uses the user-specific due date from the assignment lookup', async () => {
    const { adapter, calls } = setup((url) => (url.includes('/assignments/8') ? { body: assignment8 } : { body: [undatedDueItem] }));
    const r = await run(adapter);
    const it = r.data.items[0]!;
    expect(it.dueAt).toBe('2026-11-27T15:59:00.000Z');
    expect(it.plannerDate).toBe('2026-11-25T15:59:00.000Z');
    expect(it.completion).toBe('not_submitted');
    expect(calls[1]!.url).toBe(`${BASE}/api/v1/courses/1/assignments/8?include[]=submission`);
  });

  it('unresolved lookup leaves dueAt null (planner date not promoted) and coverage partial', async () => {
    const { adapter } = setup((url) => (url.includes('/assignments/8') ? new ProviderError('upstream', 'x') : { body: [undatedDueItem] }));
    const r = await run(adapter);
    expect(r.data.items[0]!.dueAt).toBeNull();
    expect(r.data.items[0]!.plannerDate).toBe('2026-11-25T15:59:00.000Z');
    expect(r.coverage!.complete).toBe(false);
  });

  it('follows Link next across 3 pages', async () => {
    const { adapter, calls } = setup((url) => {
      if (url.includes('page=3')) return { body: [assignmentItem(3)] };
      if (url.includes('page=2')) return { body: [assignmentItem(2)], link: next(3) };
      return { body: [assignmentItem(1)], link: next(2) };
    });
    const r = await run(adapter);
    expect(calls).toHaveLength(3);
    expect(r.data.items.map((i) => i.id).sort()).toEqual(['assignment:1', 'assignment:2', 'assignment:3']);
    expect(r.coverage!.complete).toBe(true);
  });

  it('does not follow a next link to a foreign host; coverage partial', async () => {
    const { adapter, calls } = setup(() => ({ body: [assignmentItem(1)], link: '<https://evil.example.com/api/v1/planner/items?page=2>; rel="next"' }));
    const r = await run(adapter);
    expect(calls).toHaveLength(1);
    expect(r.coverage!.complete).toBe(false);
    expect(r.data.items).toHaveLength(1);
  });

  it('does not follow a non-https next link', async () => {
    const { adapter, calls } = setup(() => ({ body: [], link: '<http://canvas.example.edu/x?page=2>; rel="next"' }));
    expect((await run(adapter)).coverage!.complete).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('page budget exceeded gives a partial result without error', async () => {
    const { adapter, calls } = setup((url) => {
      const n = Number(/page=(\d+)/.exec(url)?.[1] ?? 1);
      return { body: [assignmentItem(n)], link: next(n + 1) };
    });
    const r = await run(adapter);
    expect(calls).toHaveLength(MAX_PAGES);
    expect(r.coverage!.complete).toBe(false);
    expect(r.data.items).toHaveLength(MAX_PAGES);
  });

  it('time budget exceeded gives a partial result', async () => {
    const clock = new Clock();
    const { adapter, calls } = setup((url) => {
      clock.advance(30_000);
      return { body: [assignmentItem(1)], link: next(2) };
    }, {}, clock);
    const r = await run(adapter);
    expect(calls).toHaveLength(1);
    expect(r.coverage!.complete).toBe(false);
  });

  it('completion: unknown stays unknown, submitted, graded, marked_complete, explicit not_submitted', async () => {
    const { adapter } = setup(() => ({
      body: [
        assignmentItem(1, { submissions: false }),
        assignmentItem(2, { submissions: { submitted: true, graded: false } }),
        assignmentItem(3, { submissions: { graded: true, submitted: true } }),
        assignmentItem(4, { planner_override: { marked_complete: true, dismissed: false } }),
        assignmentItem(5, { submissions: { submitted: false, excused: false } }),
        assignmentItem(6, { submissions: { excused: true } }),
      ],
    }));
    const c = Object.fromEntries((await run(adapter)).data.items.map((i) => [i.id, i.completion]));
    expect(c).toEqual({
      'assignment:1': 'unknown',
      'assignment:2': 'submitted',
      'assignment:3': 'graded',
      'assignment:4': 'marked_complete',
      'assignment:5': 'not_submitted',
      'assignment:6': 'unknown',
    });
  });

  it('planner notes are reminders, not deadlines; wiki todo is a reminder; undated item only if returned', async () => {
    const { adapter } = setup(() => ({ body: [noteItem, wikiItem, assignmentItem(9, { plannable_date: null, plannable: { title: 'No date' } })] }));
    const items = (await run(adapter)).data.items;
    const note = items.find((i) => i.id === 'planner_note:77')!;
    expect(note).toMatchObject({ isReminder: true, dueAt: null, plannerDate: '2026-11-22T00:00:00.000Z' });
    expect(items.find((i) => i.id === 'wiki_page:5')).toMatchObject({ isReminder: true, dueAt: null });
    expect(items.find((i) => i.id === 'assignment:9')).toMatchObject({ dueAt: null, plannerDate: null, isReminder: false });
    expect(items).toHaveLength(3);
    expect((await run(setup(() => ({ body: [] })).adapter)).data.items).toHaveLength(0);
  });

  it('announcements and dismissed items are dropped; calendar events are not deadlines', async () => {
    const { adapter } = setup(() => ({
      body: [
        { plannable_id: 1, plannable_type: 'announcement', plannable: { title: 'Hi' }, plannable_date: '2026-11-22T00:00:00Z' },
        assignmentItem(2, { planner_override: { dismissed: true } }),
        { plannable_id: 3, plannable_type: 'calendar_event', plannable: { title: 'Lecture', start_at: '2026-11-22T01:00:00Z' }, plannable_date: '2026-11-22T01:00:00Z' },
      ],
    }));
    const items = (await run(adapter)).data.items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'calendar_event', dueAt: null, isReminder: false, plannerDate: '2026-11-22T01:00:00.000Z' });
  });

  it('dedupes by id across pages, keeps same-title different ids separate', async () => {
    const a = assignmentItem(1, { plannable: { title: 'Same', due_at: '2026-11-23T15:59:00Z' } });
    const b = assignmentItem(2, { plannable: { title: 'Same', due_at: '2026-11-23T15:59:00Z' } });
    const { adapter } = setup((url) => (url.includes('page=2') ? { body: [a] } : { body: [a, b], link: next(2) }));
    expect((await run(adapter)).data.items.map((i) => i.id)).toEqual(['assignment:1', 'assignment:2']);
  });

  it('resolves relative html_url, drops javascript: and foreign urls; strips control chars', async () => {
    const { adapter } = setup(() => ({
      body: [
        assignmentItem(1),
        assignmentItem(2, { html_url: 'javascript:alert(1)' }),
        assignmentItem(3, { html_url: 'https://evil.example.com/x' }),
        assignmentItem(4, { plannable: { title: 'A\u0000B\u001bC', due_at: '2026-11-23T15:59:00Z' } }),
      ],
    }));
    const items = (await run(adapter)).data.items;
    const by = (id: string) => items.find((i) => i.id === id)!;
    expect(by('assignment:1').htmlUrl).toBe(`${BASE}/courses/1/assignments/1`);
    expect(by('assignment:2').htmlUrl).toBeNull();
    expect(by('assignment:3').htmlUrl).toBeNull();
    expect(by('assignment:4').title).toBe('A B C');
  });

  it('sorts by dueAt then plannerDate', async () => {
    const { adapter } = setup(() => ({
      body: [noteItem, assignmentItem(2, { plannable: { title: 'late', due_at: '2026-11-26T00:00:00Z' } }), assignmentItem(1, { plannable: { title: 'early', due_at: '2026-11-23T00:00:00Z' } })],
    }));
    expect((await run(adapter)).data.items.map((i) => i.id)).toEqual(['assignment:1', 'assignment:2', 'planner_note:77']);
  });

  it('propagates auth_failed and rate_limited; token never in the error', async () => {
    for (const code of ['auth_failed', 'rate_limited'] as const) {
      const { adapter } = setup(() => new ProviderError(code, 'nope'));
      const e = await run(adapter).catch((x) => x);
      expect(e).toBeInstanceOf(ProviderError);
      expect(e.code).toBe(code);
      expect(JSON.stringify([e.message, e.safeMessage])).not.toContain(TOKEN);
    }
  });

  it('malformed body -> malformed', async () => {
    const e = await run(setup(() => ({ body: { not: 'an array' } })).adapter).catch((x) => x);
    expect(e).toBeInstanceOf(ProviderError);
    expect(e.code).toBe('malformed');
  });

  it('skips malformed elements without failing', async () => {
    const r = await run(setup(() => ({ body: [null, 5, { foo: 1 }, assignmentItem(1)] })).adapter);
    expect(r.data.items).toHaveLength(1);
  });

  it('fetch without setup throws needs_setup', async () => {
    const e = await run(setup(() => ({ body: [] }), { CANVAS_ACCESS_TOKEN: '' }).adapter).catch((x) => x);
    expect(e.code).toBe('needs_setup');
  });
});
