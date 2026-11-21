import type { CanvasItem } from '../../../shared/contracts.js';
import type { AdapterFactory, HttpClient, ProviderDeps } from '../types.js';
import { ProviderError } from '../types.js';
import { parseAssignment, parseNextLink, parsePlannerPage, sortItems, type LookupRef } from './normalize.js';

const DAY = 86_400_000;
const PAGE_SIZE = 100;
export const MAX_PAGES = 10;
export const MAX_LOOKUPS = 15;
export const TIME_BUDGET_MS = 25_000;

const NEEDS_BASE = 'CANVAS_BASE_URL must be an https URL';
const NEEDS_SETUP = 'Set CANVAS_BASE_URL (https) and CANVAS_ACCESS_TOKEN in the server environment';

function baseOf(env: ProviderDeps['env']): URL | null {
  const raw = env.CANVAS_BASE_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' ? new URL(u.origin) : null;
  } catch {
    return null;
  }
}

export const createLiveAdapter: AdapterFactory<'canvas'> = ({ env, now, http }) => {
  const token = () => env.CANVAS_ACCESS_TOKEN?.trim() || null;

  async function get(http: HttpClient, url: string, signal: AbortSignal) {
    const init = { headers: { Authorization: `Bearer ${token()}`, Accept: 'application/json' }, signal };
    return http.request(url, init);
  }

  return {
    id: 'canvas',
    mode: 'live',
    async setupStatus() {
      if (!env.CANVAS_BASE_URL?.trim() && !token()) return { connection: 'needs_setup', requirement: NEEDS_SETUP };
      if (!baseOf(env)) return { connection: 'needs_setup', requirement: env.CANVAS_BASE_URL?.trim() ? NEEDS_BASE : NEEDS_SETUP };
      if (!token()) return { connection: 'needs_setup', requirement: NEEDS_SETUP };
      return { connection: 'connected', requirement: null };
    },
    configKey: () => `canvas:${baseOf(env)?.hostname ?? 'unset'}`,
    async fetch(_settings, signal) {
      const base = baseOf(env);
      if (!base || !token()) throw new ProviderError('needs_setup', base ? NEEDS_SETUP : env.CANVAS_BASE_URL?.trim() ? NEEDS_BASE : NEEDS_SETUP);

      const startedAt = now().getTime();
      const windowStart = new Date(startedAt - 7 * DAY).toISOString();
      const windowEnd = new Date(startedAt + 14 * DAY).toISOString();
      const budget = AbortSignal.timeout(TIME_BUDGET_MS);
      const sig = AbortSignal.any([signal, budget]);
      const overBudget = () => now().getTime() - startedAt > TIME_BUDGET_MS || budget.aborted;
      const checkCancelled = () => {
        if (signal.aborted) throw new ProviderError('timeout', 'Canvas refresh was cancelled');
      };

      const params = new URLSearchParams({ start_date: windowStart, end_date: windowEnd, per_page: String(PAGE_SIZE) });
      let next: string | null = `${base.origin}/api/v1/planner/items?${params.toString()}`;
      let complete = true;
      let pages = 0;
      const seenUrls = new Set<string>();
      const byId = new Map<string, { item: CanvasItem; lookup: LookupRef | null }>();

      while (next) {
        checkCancelled();
        if (pages >= MAX_PAGES || overBudget() || seenUrls.has(next)) {
          complete = false;
          break;
        }
        seenUrls.add(next);
        let res;
        try {
          res = await get(http, next, sig);
        } catch (e) {
          checkCancelled();
          if (pages > 0 && budget.aborted) {
            complete = false;
            break;
          }
          if (budget.aborted) throw new ProviderError('timeout', 'Canvas did not respond in time', { retryable: true });
          throw e;
        }
        pages++;
        const parsed = parsePlannerPage(await res.json(), base);
        for (const p of parsed) if (!byId.has(p.item.id)) byId.set(p.item.id, p);

        const link = parseNextLink(res.headers.get('link'));
        next = null;
        if (link) {
          let u: URL | null = null;
          try {
            u = new URL(link, base);
          } catch {
            u = null;
          }
          if (u && u.protocol === 'https:' && u.hostname.toLowerCase() === base.hostname.toLowerCase() && !u.username && !u.password) next = u.href;
          else complete = false; // foreign or malformed next link: do not follow
        }
      }

      // Resolve user-specific due dates for assignment-like items the planner dated without due_at.
      let lookups = 0;
      let stopLookups = false;
      for (const entry of byId.values()) {
        if (!entry.lookup) continue;
        if (stopLookups || lookups >= MAX_LOOKUPS || overBudget()) {
          complete = false;
          continue;
        }
        checkCancelled();
        lookups++;
        const { courseId, assignmentId } = entry.lookup;
        const url = `${base.origin}/api/v1/courses/${encodeURIComponent(courseId)}/assignments/${encodeURIComponent(assignmentId)}?include[]=submission`;
        try {
          const res = await get(http, url, sig);
          const info = parseAssignment(await res.json());
          if (!info) {
            complete = false;
            continue;
          }
          if (info.dueAt) entry.item.dueAt = info.dueAt;
          if (entry.item.completion === 'unknown') entry.item.completion = info.completion;
        } catch (e) {
          checkCancelled();
          complete = false;
          // Lookups are best-effort; the due date stays null. Stop on throttling/auth to avoid hammering.
          if (e instanceof ProviderError && (e.code === 'rate_limited' || e.code === 'auth_failed')) stopLookups = true;
        }
      }

      return {
        data: { windowStart, windowEnd, items: sortItems([...byId.values()].map((e) => e.item)) },
        sourceUpdatedAt: now().toISOString(),
        validUntil: null,
        coverage: { start: windowStart, end: windowEnd, complete },
        detailUrl: `${base.origin}/calendar`,
      };
    },
  };
};
