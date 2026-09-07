import type { Zettel } from '../models/Zettel';
import type { ReviewGrade, ReviewState } from '../models/Review';
import { initialState, schedule } from '../services/SpacedRepetition';

export interface ReviewRepository {
  findAll(): Promise<ReviewState[]>;
  findById(zettelId: string): Promise<ReviewState | null>;
  put(state: ReviewState): Promise<void>;
  putMany(states: ReviewState[]): Promise<void>;
  delete(zettelId: string): Promise<void>;
  clearAll(): Promise<void>;
}

export interface ReviewQueue {
  /** Vencidos primeiro, depois novos — a ordem em que a sessão percorre. */
  items: Zettel[];
  dueCount: number;
  newCount: number;
  /** Menor `dueAt` futuro entre os não suspensos, ou null se não houver. */
  nextDueAt: number | null;
}

export const DEFAULT_NEW_PER_DAY = 10;

export class ReviewController {
  constructor(private repo: ReviewRepository) {}

  async getAll(): Promise<ReviewState[]> {
    return this.repo.findAll();
  }

  /**
   * Registra uma nota. Cria a linha na primeira avaliação — um zettel sem linha
   * é um zettel nunca revisado, e é isso que o coloca entre os novos da fila.
   */
  async grade(zettelId: string, grade: ReviewGrade, now: number): Promise<ReviewState> {
    const existing = await this.repo.findById(zettelId);
    const base = existing ?? initialState(zettelId, now);
    const next = schedule(base, grade, now);
    await this.repo.put(next);
    return next;
  }

  async setSuspended(zettelId: string, suspended: boolean, now: number): Promise<ReviewState> {
    const existing = await this.repo.findById(zettelId);
    const base = existing ?? initialState(zettelId, now);
    const next: ReviewState = { ...base, suspended, updatedAt: now };
    await this.repo.put(next);
    return next;
  }
}

/**
 * Monta a fila de uma sessão. Pura — o Dashboard chama só pelas contagens.
 *
 * A sessão congela o resultado: recalcular a cada avaliação faria o item
 * avaliado sair do array e deslocaria todos os índices seguintes.
 */
export function buildQueue(
  zettels: Zettel[],
  states: Map<string, ReviewState>,
  now: number,
  newPerDay: number
): ReviewQueue {
  const due: Zettel[] = [];
  const fresh: Zettel[] = [];
  let nextDueAt: number | null = null;

  for (const zettel of zettels) {
    const state = states.get(zettel.id);

    if (!state) {
      fresh.push(zettel);
      continue;
    }
    if (state.suspended) continue;

    if (state.dueAt <= now) {
      due.push(zettel);
    } else if (nextDueAt === null || state.dueAt < nextDueAt) {
      nextDueAt = state.dueAt;
    }
  }

  due.sort((a, b) => states.get(a.id)!.dueAt - states.get(b.id)!.dueAt);
  fresh.sort((a, b) => a.createdAt - b.createdAt);

  const limited = fresh.slice(0, Math.max(0, newPerDay));

  return {
    items: [...due, ...limited],
    dueCount: due.length,
    newCount: limited.length,
    nextDueAt,
  };
}
