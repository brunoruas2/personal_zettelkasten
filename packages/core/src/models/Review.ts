export type ReviewGrade = 'again' | 'hard' | 'good' | 'easy';

export interface ReviewState {
  zettelId: string;
  dueAt: number;
  intervalDays: number;
  ease: number;
  reps: number;
  lapses: number;
  lastReviewedAt: number;
  suspended: boolean;
  updatedAt: number;
}

export interface ReviewRow {
  zettel_id: string;
  due_at: number;
  interval_days: number;
  ease: number;
  reps: number;
  lapses: number;
  last_reviewed_at: number;
  suspended: 0 | 1; // IndexedDB não indexa boolean
  updated_at: number;
}

export function rowToReview(row: ReviewRow): ReviewState {
  return {
    zettelId: row.zettel_id,
    dueAt: row.due_at,
    intervalDays: row.interval_days,
    ease: row.ease,
    reps: row.reps,
    lapses: row.lapses,
    lastReviewedAt: row.last_reviewed_at,
    suspended: row.suspended === 1,
    updatedAt: row.updated_at,
  };
}

export function reviewToRow(state: ReviewState): ReviewRow {
  return {
    zettel_id: state.zettelId,
    due_at: state.dueAt,
    interval_days: state.intervalDays,
    ease: state.ease,
    reps: state.reps,
    lapses: state.lapses,
    last_reviewed_at: state.lastReviewedAt,
    suspended: state.suspended ? 1 : 0,
    updated_at: state.updatedAt,
  };
}
