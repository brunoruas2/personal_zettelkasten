import type { ReviewGrade, ReviewState } from '../models/Review';

export const INITIAL_EASE = 2.5;
export const MIN_EASE = 1.3;
export const DAY_MS = 86_400_000;

const EASE_DELTA: Record<ReviewGrade, number> = {
  again: -0.2,
  hard: -0.15,
  good: 0,
  easy: 0.15,
};

/**
 * Estado de um zettel que nunca foi revisado. Repare que `dueAt` é o próprio
 * `now`: uma linha só existe depois da primeira avaliação ou suspensão, e nesse
 * segundo caso ela precisa ser considerada vencida se voltar a ser reativada.
 */
export function initialState(zettelId: string, now: number): ReviewState {
  return {
    zettelId,
    dueAt: now,
    intervalDays: 0,
    ease: INITIAL_EASE,
    reps: 0,
    lapses: 0,
    lastReviewedAt: 0,
    suspended: false,
    updatedAt: now,
  };
}

function nextInterval(state: ReviewState, grade: ReviewGrade, ease: number): number {
  switch (grade) {
    case 'again':
      return 1;
    case 'hard':
      return Math.max(1, Math.round(state.intervalDays * 1.2));
    case 'good':
      if (state.reps === 0) return 1;
      if (state.reps === 1) return 6;
      return Math.max(1, Math.round(state.intervalDays * ease));
    case 'easy':
      if (state.reps === 0) return 4;
      return Math.max(1, Math.round(state.intervalDays * ease * 1.3));
  }
}

/**
 * Aplica uma nota e devolve o novo estado. Pura: não lê o relógio, não muta o
 * estado recebido. O `now` entra por parâmetro justamente para ser testável.
 */
export function schedule(state: ReviewState, grade: ReviewGrade, now: number): ReviewState {
  const ease = Math.max(MIN_EASE, state.ease + EASE_DELTA[grade]);
  const intervalDays = nextInterval(state, grade, ease);

  return {
    ...state,
    dueAt: now + intervalDays * DAY_MS,
    intervalDays,
    ease,
    reps: grade === 'again' ? 0 : state.reps + 1,
    lapses: grade === 'again' ? state.lapses + 1 : state.lapses,
    lastReviewedAt: now,
    updatedAt: now,
  };
}

/**
 * Intervalo em dias que cada nota produziria. Roda o próprio `schedule`, de modo
 * que o rótulo do botão nunca possa divergir do efeito de apertá-lo.
 */
export function previewIntervals(state: ReviewState, now: number): Record<ReviewGrade, number> {
  return {
    again: schedule(state, 'again', now).intervalDays,
    hard: schedule(state, 'hard', now).intervalDays,
    good: schedule(state, 'good', now).intervalDays,
    easy: schedule(state, 'easy', now).intervalDays,
  };
}
