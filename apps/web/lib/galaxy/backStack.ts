import type { Camera } from './camera';

/** De onde o usuário saltou: o zettel atual (se havia) e a câmera do momento. */
export interface BackEntry {
  id: string | null;
  camera: Camera;
}

export const BACK_STACK_MAX = 50;

/**
 * Pilha de saltos entre zettels ("← Voltar"). Só memória da sessão, nunca
 * persistida. Teto de 50 descartando a mais antiga; saltar de novo a partir
 * do mesmo zettel do topo não duplica a entrada (só atualiza a câmera).
 */
export class BackStack {
  private entries: BackEntry[] = [];

  push(entry: BackEntry): void {
    const top = this.entries[this.entries.length - 1];
    if (top && entry.id !== null && top.id === entry.id) {
      this.entries[this.entries.length - 1] = entry;
      return;
    }
    this.entries.push(entry);
    if (this.entries.length > BACK_STACK_MAX) this.entries.shift();
  }

  pop(): BackEntry | undefined {
    return this.entries.pop();
  }

  peek(): BackEntry | undefined {
    return this.entries[this.entries.length - 1];
  }

  get size(): number {
    return this.entries.length;
  }

  /** Há alguma entrada que satisfaz `pred`? (sem desempilhar) */
  some(pred: (e: BackEntry) => boolean): boolean {
    return this.entries.some(pred);
  }

  /** Desempilha até a primeira entrada (do topo) que satisfaz `pred`, descartando as de cima. */
  popUntil(pred: (e: BackEntry) => boolean): BackEntry | undefined {
    while (this.entries.length > 0) {
      const e = this.entries.pop()!;
      if (pred(e)) return e;
    }
    return undefined;
  }
}
