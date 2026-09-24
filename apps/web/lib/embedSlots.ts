export type EmbedMode = 'preview' | 'edit';

/**
 * Registro dos pontos do texto onde uma faixa de zettel filho pode ancorar.
 *
 * No Preview (e no leitor) o slot é um `<div>` emitido pelo `MarkdownRenderer`
 * logo depois do bloco da referência; no modo Editar é o DOM de uma
 * `Decoration.widget` do ProseMirror. O Preview e o TipTap ficam montados ao
 * mesmo tempo nas páginas de edição, então há até um slot por modo para cada
 * filho. Quem ancora a faixa (`useEmbedHosts`) só precisa perguntar "onde está o
 * slot do modo visível?" e ouvir quando isso muda.
 */
export class EmbedSlotRegistry {
  private slots = new Map<string, HTMLElement>();
  private listeners = new Set<() => void>();

  private key(mode: EmbedMode, id: string): string {
    return `${mode}:${id}`;
  }

  get(mode: EmbedMode, id: string): HTMLElement | undefined {
    return this.slots.get(this.key(mode, id));
  }

  register(mode: EmbedMode, id: string, el: HTMLElement): void {
    const k = this.key(mode, id);
    if (this.slots.get(k) === el) return;
    this.slots.set(k, el);
    this.emit();
  }

  /**
   * Só remove se o slot registrado ainda for `el`: quando o ProseMirror recria o
   * widget, o novo slot é registrado antes de o velho ser destruído, e a remoção
   * tardia do velho não pode apagar o novo.
   */
  unregister(mode: EmbedMode, id: string, el: HTMLElement): void {
    const k = this.key(mode, id);
    if (this.slots.get(k) !== el) return;
    this.slots.delete(k);
    this.emit();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }
}
