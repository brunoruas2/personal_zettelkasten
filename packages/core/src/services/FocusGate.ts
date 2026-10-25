/**
 * Portão de "modo foco" com contador de referências: enquanto ativo, `run`
 * guarda o trabalho por chave (a última função de cada chave vence, na ordem
 * da primeira vez que a chave apareceu) em vez de executá-lo. O `exit` que
 * zera o contador devolve o que ficou pendente — quem chama decide quando rodar.
 */
export class FocusGate {
  private count = 0;
  private pending = new Map<string, () => void>();

  get active(): boolean {
    return this.count > 0;
  }

  enter(): void {
    this.count++;
  }

  /** Sai uma vez; com o contador já em zero é no-op. Devolve os pendentes só ao zerar. */
  exit(): [string, () => void][] {
    if (this.count <= 0) return [];
    this.count--;
    if (this.count > 0) return [];
    const out = [...this.pending.entries()];
    this.pending.clear();
    return out;
  }

  /** Executa já (true) ou, com o portão ativo, adia sob `key` (false). */
  run(key: string, fn: () => void): boolean {
    if (this.count > 0) {
      this.pending.set(key, fn);
      return false;
    }
    fn();
    return true;
  }
}
