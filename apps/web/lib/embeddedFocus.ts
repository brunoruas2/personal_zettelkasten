/**
 * Marca a raiz de uma faixa de zettel embutido. Atalhos globais (`Alt+P/S/H/E/T/F`)
 * são registrados no `document` pelo leitor e pelos formulários de edição; sem
 * distinguir de onde o evento veio, editar um filho dentro do pai dispararia o
 * atalho nos dois (`Alt+S` salvaria pai e filho).
 */
export const EMBEDDED_ATTR = 'data-embedded-zettel';

/**
 * Marca a raiz do modal de desenho. O modal é montado num portal no `body`, mas os
 * atalhos do pai continuam no `document` — a mesma guarda das faixas os silencia.
 */
export const DRAWING_MODAL_ATTR = 'data-drawing-modal';

/** true quando o alvo do evento está dentro de uma faixa de zettel embutido ou do modal de desenho. */
export function eventInEmbedded(e: Event): boolean {
  const target = e.target;
  return (
    target instanceof Element &&
    target.closest(`[${EMBEDDED_ATTR}], [${DRAWING_MODAL_ATTR}]`) !== null
  );
}
