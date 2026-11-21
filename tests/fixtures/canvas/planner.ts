// Synthetic, shaped per Canvas Planner API docs (developerdocs.instructure.com), fields marked UNVERIFIED in comments.
// UNVERIFIED: plannable_date semantics, context_name, submissions.submitted, assignment lookup submission.workflow_state values.
export const BASE = 'https://canvas.example.edu';

export const assignmentItem = (id: number, over: Record<string, unknown> = {}) => ({
  plannable_id: id,
  plannable_type: 'assignment',
  course_id: 1,
  context_type: 'Course',
  context_name: 'Intro to Testing', // UNVERIFIED
  plannable_date: '2026-11-23T15:59:00Z', // UNVERIFIED semantics
  html_url: `/courses/1/assignments/${id}`,
  planner_override: null,
  submissions: false,
  plannable: { id, title: `Assignment ${id}`, due_at: '2026-11-23T15:59:00Z', points_possible: 10 },
  ...over,
});

export const noteItem = {
  plannable_id: 77,
  plannable_type: 'planner_note',
  course_id: null,
  plannable_date: '2026-11-22T00:00:00Z',
  html_url: null,
  planner_override: null,
  submissions: false,
  plannable: { id: 77, title: 'Plan study week', todo_date: '2026-11-22T00:00:00Z' },
};

export const wikiItem = {
  plannable_id: 5,
  plannable_type: 'wiki_page',
  course_id: 1,
  plannable_date: '2026-11-24T00:00:00Z',
  html_url: '/courses/1/pages/reading',
  planner_override: null,
  submissions: false,
  plannable: { title: 'Reading', todo_date: '2026-11-24T00:00:00Z' },
};

/** Planner dated this assignment but gave no due_at: needs a lookup. */
export const undatedDueItem = assignmentItem(8, {
  plannable_date: '2026-11-25T15:59:00Z',
  plannable: { id: 8, title: 'Essay (override)' },
});

/** Response of GET /courses/1/assignments/8?include[]=submission (user-specific due_at). */
export const assignment8 = {
  id: 8,
  due_at: '2026-11-27T15:59:00Z',
  submission: { workflow_state: 'unsubmitted', submitted_at: null }, // UNVERIFIED values
};
