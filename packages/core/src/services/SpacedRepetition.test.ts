import { describe, expect, it } from 'vitest';
import type { Zettel } from '../models/Zettel';
import type { ReviewGrade, ReviewState } from '../models/Review';
import { DAY_MS, INITIAL_EASE, MIN_EASE, initialState, previewIntervals, schedule } from './SpacedRepetition';
import { buildQueue } from '../controllers/ReviewController';

const NOW = 1_757_000_000_000;

function zettel(id: string, createdAt: number): Zettel {
  return { id, title: id, body: '', tags: [], createdAt, updatedAt: createdAt };
}

function stateFor(zettelId: string, overrides: Partial<ReviewState> = {}): ReviewState {
  return { ...initialState(zettelId, NOW), ...overrides };
}

describe('schedule', () => {
  it('progride 1d → 6d → 15d com acertos consecutivos', () => {
    let state = initialState('z1', NOW);
    const intervals: number[] = [];

    for (let i = 0; i < 3; i++) {
      state = schedule(state, 'good', NOW);
      intervals.push(state.intervalDays);
    }

    expect(intervals).toEqual([1, 6, 15]);
    expect(state.reps).toBe(3);
  });

  it('não mexe no fator de facilidade em "good"', () => {
    const state = stateFor('z1', { ease: 2.36, reps: 3, intervalDays: 10 });
    expect(schedule(state, 'good', NOW).ease).toBe(2.36);
  });

  it('mantém o piso do fator de facilidade em 1.3', () => {
    let state = initialState('z1', NOW);

    for (let i = 0; i < 10; i++) {
      state = schedule(state, 'again', NOW);
    }

    expect(state.ease).toBe(MIN_EASE);
  });

  it('"again" zera as repetições, incrementa lapsos e volta a 1 dia', () => {
    const state = stateFor('z1', { reps: 4, lapses: 1, intervalDays: 38 });
    const next = schedule(state, 'again', NOW);

    expect(next.reps).toBe(0);
    expect(next.lapses).toBe(2);
    expect(next.intervalDays).toBe(1);
  });

  it('"hard" multiplica por 1.2 e "easy" adianta o primeiro intervalo', () => {
    expect(schedule(stateFor('z1', { reps: 3, intervalDays: 10 }), 'hard', NOW).intervalDays).toBe(12);
    expect(schedule(initialState('z1', NOW), 'easy', NOW).intervalDays).toBe(4);
  });

  it('produz sempre intervalo inteiro e maior ou igual a 1', () => {
    const grades: ReviewGrade[] = ['again', 'hard', 'good', 'easy'];
    const states = [
      initialState('z1', NOW),
      stateFor('z1', { reps: 1, intervalDays: 1, ease: MIN_EASE }),
      stateFor('z1', { reps: 9, intervalDays: 200, ease: 2.9 }),
    ];

    for (const state of states) {
      for (const grade of grades) {
        const next = schedule(state, grade, NOW);
        expect(Number.isInteger(next.intervalDays)).toBe(true);
        expect(next.intervalDays).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('agenda a próxima data e carimba os dois timestamps', () => {
    const next = schedule(stateFor('z1', { reps: 2, intervalDays: 6 }), 'good', NOW);

    expect(next.intervalDays).toBe(15);
    expect(next.dueAt).toBe(NOW + 15 * DAY_MS);
    expect(next.lastReviewedAt).toBe(NOW);
    expect(next.updatedAt).toBe(NOW);
  });

  it('é pura: não muta o estado recebido', () => {
    const state = initialState('z1', NOW);
    const snapshot = { ...state };

    schedule(state, 'easy', NOW);

    expect(state).toEqual(snapshot);
  });
});

describe('initialState', () => {
  it('começa com fator 2.5, sem repetições, lapsos nem revisão anterior', () => {
    const state = initialState('z1', NOW);

    expect(state.ease).toBe(INITIAL_EASE);
    expect(state.reps).toBe(0);
    expect(state.lapses).toBe(0);
    expect(state.lastReviewedAt).toBe(0);
    expect(state.suspended).toBe(false);
  });
});

describe('previewIntervals', () => {
  it('bate com o intervalo que cada nota produz de fato', () => {
    const state = stateFor('z1', { reps: 4, intervalDays: 20, ease: 2.2 });
    const preview = previewIntervals(state, NOW);
    const grades: ReviewGrade[] = ['again', 'hard', 'good', 'easy'];

    for (const grade of grades) {
      expect(preview[grade]).toBe(schedule(state, grade, NOW).intervalDays);
    }
  });
});

describe('buildQueue', () => {
  const zettels = [
    zettel('novo-b', 200),
    zettel('vencido-tarde', 100),
    zettel('novo-a', 100),
    zettel('vencido-cedo', 100),
    zettel('futuro', 100),
    zettel('suspenso', 100),
  ];

  const states = new Map<string, ReviewState>([
    ['vencido-tarde', stateFor('vencido-tarde', { dueAt: NOW - DAY_MS })],
    ['vencido-cedo', stateFor('vencido-cedo', { dueAt: NOW - 5 * DAY_MS })],
    ['futuro', stateFor('futuro', { dueAt: NOW + 3 * DAY_MS })],
    ['suspenso', stateFor('suspenso', { dueAt: NOW - 9 * DAY_MS, suspended: true })],
  ]);

  it('traz vencidos por data crescente, depois novos por criação', () => {
    const queue = buildQueue(zettels, states, NOW, 10);

    expect(queue.items.map((z) => z.id)).toEqual(['vencido-cedo', 'vencido-tarde', 'novo-a', 'novo-b']);
    expect(queue.dueCount).toBe(2);
    expect(queue.newCount).toBe(2);
  });

  it('corta os novos pela cota diária sem limitar os vencidos', () => {
    const queue = buildQueue(zettels, states, NOW, 1);

    expect(queue.items.map((z) => z.id)).toEqual(['vencido-cedo', 'vencido-tarde', 'novo-a']);
    expect(queue.dueCount).toBe(2);
    expect(queue.newCount).toBe(1);
  });

  it('deixa de fora suspensos e agendados para o futuro', () => {
    const ids = buildQueue(zettels, states, NOW, 10).items.map((z) => z.id);

    expect(ids).not.toContain('suspenso');
    expect(ids).not.toContain('futuro');
  });

  it('mantém fora um zettel suspenso que nunca foi revisado', () => {
    const withSuspendedNew = new Map(states);
    withSuspendedNew.set('novo-a', stateFor('novo-a', { suspended: true }));

    const ids = buildQueue(zettels, withSuspendedNew, NOW, 10).items.map((z) => z.id);

    expect(ids).not.toContain('novo-a');
  });

  it('informa a menor data futura entre os não suspensos', () => {
    expect(buildQueue(zettels, states, NOW, 10).nextDueAt).toBe(NOW + 3 * DAY_MS);
  });

  it('informa ausência de próxima data quando não há agendamento futuro', () => {
    const onlyDue = new Map([['vencido-cedo', stateFor('vencido-cedo', { dueAt: NOW - DAY_MS })]]);

    expect(buildQueue([zettel('vencido-cedo', 100)], onlyDue, NOW, 0).nextDueAt).toBeNull();
  });

  it('não conta zettel suspenso como próxima data', () => {
    const onlySuspendedFuture = new Map([
      ['suspenso', stateFor('suspenso', { dueAt: NOW + DAY_MS, suspended: true })],
    ]);

    expect(buildQueue([zettel('suspenso', 100)], onlySuspendedFuture, NOW, 0).nextDueAt).toBeNull();
  });
});
