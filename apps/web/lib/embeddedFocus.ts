/**
 * Marca a raiz de uma faixa de zettel embutido. Atalhos globais (`Alt+P/S/H/E/T/F`)
 * são registrados no `document` pelo leitor e pelos formulários de edição; sem
 * distinguir de onde o evento veio, editar um filho dentro do pai dispararia o
 * atalho nos dois (`Alt+S` salvaria pai e filho).
 */
export const EMBEDDED_ATTR = 'data-embedded-zettel';

/** true quando o alvo do evento está dentro de uma faixa de zettel embutido. */
export function eventInEmbedded(e: Event): boolean {
  const target = e.target;
  return target instanceof Element && target.closest(`[${EMBEDDED_ATTR}]`) !== null;
}
