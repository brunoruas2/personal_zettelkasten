/** De onde o usuário saltou: o zettel atual (se havia) e a câmera do momento. */
export interface BackEntry<C = unknown> {
  id: string | null;
  camera: C;
}

export const BACK_STACK_MAX = 50;

/**
 * Pilha de saltos entre zettels ("← Voltar") e a de "Avançar →". Só memória da
 * sessão, nunca persistida. Teto de 50 em cada uma, descartando a mais
 * antiga; saltar de novo a partir do mesmo zettel do topo não duplica a
 * entrada (só atualiza a câmera).
 *
 * Invariante do avançar: um salto novo (`push`) limpa o avançar; já o Voltar e
 * o Avançar (`pushFromForward`, `pushForward`) o preservam.
 */
export class BackStack<C = unknown> {
  private entries: BackEntry<C>[] = [];
  private forward: BackEntry<C>[] = [];

  /** Salto intencional: empilha a origem e descarta o que havia para avançar. */
  push(entry: BackEntry<C>): void {
    this.add(entry);
    this.forward = [];
  }

  /** Avançar: devolve o estado atual ao Voltar sem apagar o resto do avançar. */
  pushFromForward(entry: BackEntry<C>): void {
    this.add(entry);
  }

  private add(entry: BackEntry<C>): void {
    const top = this.entries[this.entries.length - 1];
    if (top && entry.id !== null && top.id === entry.id) {
      this.entries[this.entries.length - 1] = entry;
      return;
    }
    this.entries.push(entry);
    if (this.entries.length > BACK_STACK_MAX) this.entries.shift();
  }

  pop(): BackEntry<C> | undefined {
    return this.entries.pop();
  }

  peek(): BackEntry<C> | undefined {
    return this.entries[this.entries.length - 1];
  }

  get size(): number {
    return this.entries.length;
  }

  /** Há alguma entrada que satisfaz `pred`? (sem desempilhar) */
  some(pred: (e: BackEntry<C>) => boolean): boolean {
    return this.entries.some(pred);
  }

  /** Desempilha até a primeira entrada (do topo) que satisfaz `pred`, descartando as de cima. */
  popUntil(pred: (e: BackEntry<C>) => boolean): BackEntry<C> | undefined {
    while (this.entries.length > 0) {
      const e = this.entries.pop()!;
      if (pred(e)) return e;
    }
    return undefined;
  }

  /** As últimas `n` entradas, da mais antiga para a mais nova (para a trilha). */
  recent(n: number): BackEntry<C>[] {
    return this.entries.slice(Math.max(0, this.entries.length - n));
  }

  /**
   * Volta até a entrada `fromTop` posições abaixo do topo (0 = o topo): remove
   * essa e as de cima e devolve a alcançada junto com as removidas acima dela
   * (da mais antiga para a mais nova), que o chamador empurra no avançar.
   */
  popBack(fromTop: number): { reached: BackEntry<C>; skipped: BackEntry<C>[] } | undefined {
    const index = this.entries.length - 1 - fromTop;
    if (fromTop < 0 || index < 0) return undefined;
    const removed = this.entries.splice(index);
    return { reached: removed[0], skipped: removed.slice(1) };
  }

  // --- avançar ---

  pushForward(entry: BackEntry<C>): void {
    this.forward.push(entry);
    if (this.forward.length > BACK_STACK_MAX) this.forward.shift();
  }

  popForward(): BackEntry<C> | undefined {
    return this.forward.pop();
  }

  peekForward(): BackEntry<C> | undefined {
    return this.forward[this.forward.length - 1];
  }

  get forwardSize(): number {
    return this.forward.length;
  }
}
