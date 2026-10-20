'use client';

import { forwardRef, memo } from 'react';
import type { GalaxyData } from './useGalaxyData';
import { GalaxyCard } from './GalaxyCard';

/**
 * Contêiner dos cards em coordenadas de mundo. O motor escreve nele o
 * transform da câmera (`setCardLayer`); os cards dentro têm `left/top` fixos.
 * Re-renderiza só quando o conjunto de cards visíveis (ou `heavy`/destaque)
 * muda — `memo`, já que a `Galaxy` re-renderiza a cada mudança de câmera.
 */
export const CardLayer = memo(forwardRef<
  HTMLDivElement,
  {
    data: GalaxyData;
    ids: string[];
    heavy: boolean;
    highlightId: string | null;
    onLink: (title: string) => void;
    onOpen: (id: string) => void;
    onHover: (idx: number) => void;
  }
>(function CardLayer({ data, ids, heavy, highlightId, onLink, onOpen, onHover }, ref) {
  return (
    <div ref={ref} className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ width: 0, height: 0 }}>
      {ids.map((id) => {
        const idx = data.indexById.get(id);
        if (idx === undefined) return null;
        return (
          <div key={id} className="pointer-events-auto">
            <GalaxyCard
              meta={data.metas[idx]}
              idx={idx}
              x={data.xs[idx]}
              y={data.ys[idx]}
              heavy={heavy}
              highlighted={highlightId === id}
              onLink={onLink}
              onOpen={onOpen}
              onHover={onHover}
            />
          </div>
        );
      })}
    </div>
  );
}));
