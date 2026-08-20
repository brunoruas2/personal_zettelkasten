'use client';

import { useCallback, useEffect, useState, type RefObject } from 'react';

interface Props {
  /** Qualquer elemento dentro do conteúdo; o container é achado subindo daqui. */
  anchorRef: RefObject<HTMLElement | null>;
  /**
   * Muda quando o ancestral que rola pode ter mudado — troca de modo no editor,
   * corpo reescrito. O breakpoint é observado internamente.
   */
  revision?: string;
  className?: string;
}

/**
 * Folga usada para decidir os extremos. O cálculo erra por subpixel em zoom e
 * em telas com DPR fracionário, e `scrollHeight` inclui a última margem — sem
 * folga o botão nunca inverteria em alguns layouts. Menor que uma linha de
 * texto, então a seta não vira enquanto ainda há conteúdo legível abaixo.
 */
const EDGE_TOLERANCE = 24;

function isScrollable(el: HTMLElement): boolean {
  const overflowY = getComputedStyle(el).overflowY;
  if (overflowY !== 'auto' && overflowY !== 'scroll') return false;
  return el.scrollHeight > el.clientHeight;
}

/**
 * Quem rola muda por página e por breakpoint: na leitura é o `<main>` no
 * desktop e o documento no mobile; no editor é o container do modo visível.
 * Subir a árvore resolve os quatro casos sem a página ter que saber qual é o
 * seu.
 */
function resolveScroller(anchor: HTMLElement | null): HTMLElement | null {
  // Começa no próprio ancestral candidato: nas páginas de editor o ref passado
  // já É o container que rola, e partir do pai o deixaria de fora.
  let node = anchor;
  while (node && node !== document.body) {
    if (isScrollable(node)) return node;
    node = node.parentElement;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

export function ScrollEdgeButton({ anchorRef, revision, className = '' }: Props) {
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [atBottom, setAtBottom] = useState(false);
  const [scrollable, setScrollable] = useState(false);

  // O ancestral que rola muda com o breakpoint (no mobile o `<main>` da leitura
  // não tem overflow) e com o modo do editor.
  useEffect(() => {
    const resolve = () => setScroller(resolveScroller(anchorRef.current));
    resolve();
    window.addEventListener('resize', resolve);
    return () => window.removeEventListener('resize', resolve);
  }, [anchorRef, revision]);

  useEffect(() => {
    if (!scroller) return;

    let frame = 0;
    const measure = () => {
      frame = 0;
      const { scrollTop, clientHeight, scrollHeight } = scroller;
      setScrollable(scrollHeight - clientHeight > EDGE_TOLERANCE);
      setAtBottom(scrollTop + clientHeight >= scrollHeight - EDGE_TOLERANCE);
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    };

    measure();
    // O documento entrega o evento de scroll na window, não no scrollingElement.
    const target: EventTarget =
      scroller === document.scrollingElement || scroller === document.documentElement ? window : scroller;
    target.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      target.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [scroller, revision]);

  const scrollTo = useCallback(
    (edge: 'top' | 'bottom') => {
      if (!scroller) return;
      scroller.scrollTo({ top: edge === 'top' ? 0 : scroller.scrollHeight, behavior: 'smooth' });
    },
    [scroller],
  );

  if (!scrollable) return null;

  const up = atBottom;
  return (
    <button
      onClick={() => scrollTo(up ? 'top' : 'bottom')}
      aria-label={up ? 'Ir para o topo' : 'Ir para o fim'}
      title={up ? 'Ir para o topo' : 'Ir para o fim (Alt+F)'}
      className={`flex h-14 w-14 items-center justify-center rounded-full bg-zinc-700 text-white shadow-lg hover:opacity-90 dark:bg-zinc-600 ${className}`}
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        {up ? (
          <>
            <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
          </>
        ) : (
          <>
            <line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" />
          </>
        )}
      </svg>
    </button>
  );
}

/** Rola até o fim do container que contém `anchor`. Usado pelo atalho Alt+F. */
export function scrollToEnd(anchor: HTMLElement | null) {
  const scroller = resolveScroller(anchor);
  scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
}
