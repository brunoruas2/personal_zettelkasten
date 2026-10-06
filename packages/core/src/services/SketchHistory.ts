import type { Stroke } from '../models/Sketch';

export const MAX_HISTORY = 200;

type Op =
  | { type: 'add'; stroke: Stroke }
  // `index` é a posição original (na ordem de pintura) para desfazer restaurar no mesmo lugar.
  | { type: 'erase'; removed: { stroke: Stroke; index: number }[] }
  | { type: 'clear'; removed: Stroke[] };

/**
 * Traços da cena + pilhas de desfazer/refazer. Puro: o editor chama `add`,
 * `erase` e `clear` e redesenha a partir de `strokes`. Uma passada de borracha
 * apaga N traços e vira UMA operação.
 */
export class SketchHistory {
  private list: Stroke[];
  private undoStack: Op[] = [];
  private redoStack: Op[] = [];
  /** Sobe a cada mudança; o editor compara com o valor inicial para saber se está sujo. */
  version = 0;

  constructor(initial: Stroke[] = []) {
    this.list = [...initial];
  }

  get strokes(): readonly Stroke[] {
    return this.list;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  private push(op: Op): void {
    this.undoStack.push(op);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.version++;
  }

  add(stroke: Stroke): void {
    this.list.push(stroke);
    this.push({ type: 'add', stroke });
  }

  /** Remove os traços (por id). Devolve se algo foi removido. */
  erase(strokes: readonly Stroke[]): boolean {
    const ids = new Set(strokes.map((s) => s.id));
    const removed: { stroke: Stroke; index: number }[] = [];
    this.list.forEach((s, index) => {
      if (ids.has(s.id)) removed.push({ stroke: s, index });
    });
    if (removed.length === 0) return false;
    this.list = this.list.filter((s) => !ids.has(s.id));
    this.push({ type: 'erase', removed });
    return true;
  }

  clear(): boolean {
    if (this.list.length === 0) return false;
    const removed = this.list;
    this.list = [];
    this.push({ type: 'clear', removed });
    return true;
  }

  undo(): boolean {
    const op = this.undoStack.pop();
    if (!op) return false;
    if (op.type === 'add') {
      this.list = this.list.filter((s) => s.id !== op.stroke.id);
    } else if (op.type === 'erase') {
      // Em ordem crescente de índice: cada splice devolve o traço à posição original.
      for (const { stroke, index } of op.removed) this.list.splice(index, 0, stroke);
    } else {
      this.list = [...op.removed];
    }
    this.redoStack.push(op);
    this.version++;
    return true;
  }

  redo(): boolean {
    const op = this.redoStack.pop();
    if (!op) return false;
    if (op.type === 'add') {
      this.list.push(op.stroke);
    } else if (op.type === 'erase') {
      const ids = new Set(op.removed.map((r) => r.stroke.id));
      this.list = this.list.filter((s) => !ids.has(s.id));
    } else {
      this.list = [];
    }
    this.undoStack.push(op);
    this.version++;
    return true;
  }
}
