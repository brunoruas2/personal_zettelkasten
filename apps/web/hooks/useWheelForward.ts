'use client';

import { useEffect, type RefObject } from 'react';

const LINE_HEIGHT_PX = 16;

/** Algum ancestral de `el` (até `stop`, exclusive) rola por conta própria? */
function insideOwnScroller(el: HTMLElement | null, stop: HTMLElement): boolean {
  for (let n = el; n && n !== stop; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return true;
  }
  return false;
}

/**
 * Nos editores o contêiner de scroll fica dentro da coluna, então a roda com o
 * ponteiro nas laterais vazias cai num wrapper que não rola. Este hook encaminha
 * o `wheel` desse wrapper para o contêiner do modo visível.
 *
 * `targetRef` é lido a cada evento (Editar/Preview trocam o ref), sem
 * re-registrar o listener. Não usa `preventDefault`: o wrapper não rola, não há
 * ação padrão a suprimir — por isso o listener é passivo.
 */
export function useWheelForward(
  wrapperRef: RefObject<HTMLElement | null>,
  targetRef: RefObject<HTMLElement | null>,
  enabled = true,
) {
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || !enabled) return;

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey || e.deltaY === 0) return;
      const target = targetRef.current;
      if (!target) return;
      const source = e.target as HTMLElement | null;
      if (source && target.contains(source)) return;
      if (insideOwnScroller(source, wrapper)) return;

      const dy =
        e.deltaMode === 1 ? e.deltaY * LINE_HEIGHT_PX
        : e.deltaMode === 2 ? e.deltaY * target.clientHeight
        : e.deltaY;
      target.scrollBy({ top: dy });
    };

    wrapper.addEventListener('wheel', onWheel, { passive: true });
    return () => wrapper.removeEventListener('wheel', onWheel);
  }, [wrapperRef, targetRef, enabled]);
}
