'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Mede o quanto o teclado virtual do iOS comeu da tela e mantém a barra fixa
 * do rodapé acima dele.
 *
 * Retorna:
 *   offset    — deslocamento em px a aplicar como `bottom` na barra fixa
 *   recompute — força uma medição fora dos eventos de viewport
 *   toolbarRef / spacerRef — variante imperativa: se atacados a um elemento,
 *                            recebem `style.bottom` / `style.height` direto
 *
 * O valor de referência (`stableHeight`) é capturado na montagem, com o
 * teclado ainda fechado. Só o dono da página pode fazer isso: em PWA
 * standalone `window.innerHeight` encolhe junto com o teclado, então um
 * consumidor que montasse com o teclado já aberto — o `ChordKeypad` é
 * exatamente esse caso — leria a altura já reduzida e calcularia offset zero.
 */
export function useKeyboardOffset(baseBottomSpace = 80) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);

  // Capturado uma vez, antes de qualquer abertura de teclado.
  const stableHeightRef = useRef<number | null>(null);

  const update = useCallback(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    if (stableHeightRef.current === null) stableHeightRef.current = window.innerHeight;

    const next = Math.max(0, stableHeightRef.current - vv.height - vv.offsetTop);
    if (toolbarRef.current) toolbarRef.current.style.bottom = `${next}px`;
    if (spacerRef.current) spacerRef.current.style.height = `${next + baseBottomSpace}px`;
    setOffset((prev) => (prev === next ? prev : next));
  }, [baseBottomSpace]);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();

    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [update]);

  // Sem lista de dependências de propósito: roda a cada render, que é quando a
  // barra do rodapé pode ter trocado de componente (toolbar ↔ keypad). O nó
  // novo entra sem `bottom` e nenhum evento de viewport dispara na troca.
  // Converge porque `update` lê o viewport, não o estado.
  useEffect(() => {
    update();
  });

  return { toolbarRef, spacerRef, offset, recompute: update };
}
