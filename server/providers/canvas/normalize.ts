// Pure, defensive parsing of Canvas Planner API payloads. No I/O.
// Sources: developerdocs.instructure.com (Planner Items, Assignments). Fields marked UNVERIFIED are from
// memory/third parties; the parser tolerates their absence.
import { z } from 'zod';
import type { CanvasCompletion, CanvasItem, CanvasKind } from '../../../shared/contracts.js';
import { ProviderError } from '../types.js';

const MAX_TEXT = 300;

/** Strip control characters, trim, cap length. Returns null for empty. */
export function cleanText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, MAX_TEXT) : null;
}

export function toIso(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

const idSchema = z.union([z.string().min(1), z.number().finite()]).transform(String);
const opt = <T extends z.ZodType>(s: T) => s.nullish().catch(undefined);

const plannableSchema = z.looseObject({
  title: opt(z.string()),
  name: opt(z.string()),
  due_at: opt(z.string()),
  todo_date: opt(z.string()),
  assignment_id: opt(idSchema), // quizzes / discussions (UNVERIFIED for some types)
  course_id: opt(idSchema),
});

const submissionsSchema = z.looseObject({
  excused: opt(z.boolean()),
  graded: opt(z.boolean()),
  submitted: opt(z.boolean()), // UNVERIFIED key
  late: opt(z.boolean()),
  missing: opt(z.boolean()),
  needs_grading: opt(z.boolean()),
});

const itemSchema = z.looseObject({
  plannable_id: idSchema,
  plannable_type: z.string().min(1),
  plannable: opt(plannableSchema),
  plannable_date: opt(z.string()), // UNVERIFIED semantics: Canvas sort date
  course_id: opt(idSchema),
  context_name: opt(z.string()), // UNVERIFIED: course name
  html_url: opt(z.string()),
  planner_override: opt(z.looseObject({ marked_complete: opt(z.boolean()), dismissed: opt(z.boolean()) })),
  submissions: z.union([z.literal(false), submissionsSchema]).nullish().catch(undefined),
});

const KINDS: Record<string, CanvasKind> = {
  assignment: 'assignment',
  sub_assignment: 'assignment',
  quiz: 'quiz',
  discussion_topic: 'discussion_topic',
  wiki_page: 'wiki_page',
  planner_note: 'planner_note',
  calendar_event: 'calendar_event',
  announcement: 'announcement',
};
const ASSIGNMENT_LIKE = new Set(['assignment', 'sub_assignment', 'quiz', 'discussion_topic']);

export interface LookupRef {
  courseId: string;
  assignmentId: string;
}
export interface ParsedItem {
  item: CanvasItem;
  /** Set when the planner gave a date but no due_at for an assignment-like item. */
  lookup: LookupRef | null;
}

/** Resolve a URL against the Canvas base; keep only https on the Canvas host. */
export function safeCanvasUrl(raw: string | null | undefined, base: URL): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw, base);
    if (u.protocol !== 'https:' || u.hostname.toLowerCase() !== base.hostname.toLowerCase()) return null;
    if (u.username || u.password) return null;
    return u.href;
  } catch {
    return null;
  }
}

function completionOf(p: z.infer<typeof itemSchema>): CanvasCompletion {
  if (p.planner_override?.marked_complete === true) return 'marked_complete';
  const s = p.submissions;
  if (s && typeof s === 'object') {
    // Excused is deliberately NOT mapped to graded: it stays 'unknown' unless other evidence exists.
    if (s.graded === true) return 'graded';
    if (s.submitted === true) return 'submitted';
    if (s.submitted === false) return 'not_submitted';
  }
  return 'unknown';
}

/** Parse one planner page body. Throws 'malformed' if the body is not an array; skips bad elements. */
export function parsePlannerPage(body: unknown, base: URL): ParsedItem[] {
  if (!Array.isArray(body)) throw new ProviderError('malformed', 'Canvas returned an unexpected response');
  const out: ParsedItem[] = [];
  for (const raw of body) {
    const r = itemSchema.safeParse(raw);
    if (!r.success) continue;
    const p = r.data;
    const type = p.plannable_type;
    if (type === 'announcement') continue; // not a task or deadline; excluded entirely
    if (p.planner_override?.dismissed === true) continue; // user dismissed it in Canvas
    const kind = KINDS[type] ?? 'other';
    const pl = p.plannable ?? undefined;
    const todo = toIso(pl?.todo_date);
    const planDate = toIso(p.plannable_date);
    const dueAt = toIso(pl?.due_at);
    const courseId = p.course_id ?? pl?.course_id ?? null;

    let deadline: string | null = null;
    let plannerDate: string | null;
    let isReminder = false;
    let lookup: LookupRef | null = null;

    if (kind === 'planner_note') {
      isReminder = true;
      plannerDate = todo ?? planDate;
    } else if (kind === 'calendar_event') {
      plannerDate = planDate ?? dueAt;
    } else if (ASSIGNMENT_LIKE.has(type)) {
      deadline = dueAt;
      plannerDate = planDate ?? todo;
      const assignmentId = type === 'assignment' ? p.plannable_id : (pl?.assignment_id ?? null);
      if (!deadline && planDate && courseId && assignmentId) lookup = { courseId, assignmentId };
      else if (!deadline && todo) isReminder = true;
    } else {
      // wiki_page, other: a todo_date without a due date is a reminder, never a deadline.
      plannerDate = planDate ?? todo;
      if (todo && !dueAt) isReminder = true;
      deadline = dueAt;
    }

    out.push({
      item: {
        id: `${type}:${p.plannable_id}`,
        courseName: cleanText(p.context_name),
        title: cleanText(pl?.title) ?? cleanText(pl?.name) ?? '(untitled)',
        kind,
        dueAt: deadline,
        plannerDate,
        isReminder,
        completion: completionOf(p),
        htmlUrl: safeCanvasUrl(p.html_url, base),
      },
      lookup,
    });
  }
  return out;
}

const assignmentSchema = z.looseObject({
  due_at: opt(z.string()),
  submission: opt(
    z.looseObject({
      workflow_state: opt(z.string()), // UNVERIFIED values
      submitted_at: opt(z.string()),
    }),
  ),
});

export interface AssignmentInfo {
  dueAt: string | null;
  completion: CanvasCompletion;
}
/** Parse GET /courses/:c/assignments/:id?include[]=submission. due_at is the requesting user's effective date. */
export function parseAssignment(body: unknown): AssignmentInfo | null {
  const r = assignmentSchema.safeParse(body);
  if (!r.success) return null;
  const sub = r.data.submission;
  let completion: CanvasCompletion = 'unknown';
  if (sub) {
    if (sub.workflow_state === 'graded') completion = 'graded';
    else if (sub.workflow_state === 'submitted' || sub.workflow_state === 'pending_review' || toIso(sub.submitted_at)) completion = 'submitted';
    else if (sub.workflow_state === 'unsubmitted') completion = 'not_submitted';
  }
  return { dueAt: toIso(r.data.due_at), completion };
}

/** First `rel="next"` URL from a Link header, or null. */
export function parseNextLink(header: string | null): string | null {
  if (!header) return null;
  for (const m of header.matchAll(/<([^>]*)>\s*((?:;\s*[^;,]+)*)/g)) {
    const rel = /;\s*rel\s*=\s*"?([^";,]+)"?/i.exec(m[2] ?? '');
    if (rel && rel[1]!.trim().split(/\s+/).includes('next')) return m[1] ?? null;
  }
  return null;
}

function cmp(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}
/** Sort by dueAt (dated first), then plannerDate, then id. */
export function sortItems(items: CanvasItem[]): CanvasItem[] {
  return [...items].sort((a, b) => cmp(a.dueAt, b.dueAt) || cmp(a.plannerDate, b.plannerDate) || cmp(a.id, b.id));
}
