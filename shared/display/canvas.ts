import type { CanvasData, CanvasItem } from '../contracts.js';
import { fmtDayMonth, toMs } from './time.js';

export interface CanvasGroups {
  dueSoon: CanvasItem[];
  pastDue: CanvasItem[];
  reminders: CanvasItem[];
  noDue: CanvasItem[];
  done: CanvasItem[];
}

const DONE = new Set(['submitted', 'graded', 'marked_complete']);

function byMs(get: (i: CanvasItem) => number | null, dir = 1) {
  return (a: CanvasItem, b: CanvasItem) => {
    const x = get(a);
    const y = get(b);
    if (x === null && y === null) return a.id.localeCompare(b.id);
    if (x === null) return 1;
    if (y === null) return -1;
    return (x - y) * dir || a.id.localeCompare(b.id);
  };
}

export function groupCanvasItems(items: CanvasItem[], nowMs: number): CanvasGroups {
  const seen = new Set<string>();
  const g: CanvasGroups = { dueSoon: [], pastDue: [], reminders: [], noDue: [], done: [] };
  for (const item of items) {
    if (seen.has(item.id)) continue; // dedupe by provider identity, never title
    seen.add(item.id);
    if (DONE.has(item.completion)) {
      g.done.push(item);
    } else if (item.isReminder) {
      g.reminders.push(item);
    } else {
      const due = toMs(item.dueAt);
      if (due === null) g.noDue.push(item);
      else if (due >= nowMs) g.dueSoon.push(item);
      else g.pastDue.push(item); // completion is unknown or not_submitted here
    }
  }
  g.dueSoon.sort(byMs((i) => toMs(i.dueAt)));
  g.pastDue.sort(byMs((i) => toMs(i.dueAt)));
  g.reminders.sort(byMs((i) => toMs(i.plannerDate)));
  g.noDue.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  return g;
}

export function canvasCoverageLabel(data: CanvasData): string {
  return `Showing items from ${fmtDayMonth(data.windowStart)} to ${fmtDayMonth(data.windowEnd)} — not a complete list of everything in Canvas`;
}
