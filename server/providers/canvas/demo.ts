// Synthetic DEMO Canvas items. No network calls.
import type { CanvasItem } from '../../../shared/contracts.js';
import type { AdapterFactory } from '../types.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const createDemoAdapter: AdapterFactory<'canvas'> = ({ now }) => ({
  id: 'canvas',
  mode: 'demo',
  async setupStatus() {
    return { connection: 'connected', requirement: null };
  },
  configKey: () => 'demo',
  async fetch() {
    const t = now().getTime();
    const iso = (ms: number) => new Date(t + ms).toISOString();
    const course = '[Demo] Course 101';
    const base = { courseName: course, htmlUrl: null };
    const items: CanvasItem[] = [
      { ...base, id: 'assignment:demo-1', title: '[Demo] Problem set (due soon)', kind: 'assignment', dueAt: iso(26 * HOUR), plannerDate: iso(26 * HOUR), isReminder: false, completion: 'not_submitted' },
      { ...base, id: 'assignment:demo-2', title: '[Demo] Lab report (past due, status unknown)', kind: 'assignment', dueAt: iso(-2 * DAY), plannerDate: iso(-2 * DAY), isReminder: false, completion: 'unknown' },
      { ...base, id: 'quiz:demo-3', title: '[Demo] Quiz 2 (already submitted)', kind: 'quiz', dueAt: iso(3 * DAY), plannerDate: iso(3 * DAY), isReminder: false, completion: 'submitted' },
      { ...base, courseName: null, id: 'planner_note:demo-4', title: '[Demo] Personal reminder: plan study week', kind: 'planner_note', dueAt: null, plannerDate: iso(2 * DAY), isReminder: true, completion: 'unknown' },
      { ...base, id: 'wiki_page:demo-5', title: '[Demo] Reading page (no date)', kind: 'wiki_page', dueAt: null, plannerDate: null, isReminder: false, completion: 'unknown' },
      { ...base, id: 'assignment:demo-6', title: '[Demo] Essay draft (personal due date override)', kind: 'assignment', dueAt: iso(5 * DAY), plannerDate: iso(4 * DAY), isReminder: false, completion: 'not_submitted' },
    ];
    return {
      data: { windowStart: iso(-7 * DAY), windowEnd: iso(14 * DAY), items },
      sourceUpdatedAt: now().toISOString(),
      validUntil: null,
      coverage: { start: iso(-7 * DAY), end: iso(14 * DAY), complete: true },
      detailUrl: null,
    };
  },
});
