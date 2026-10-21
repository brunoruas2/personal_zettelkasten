'use client';

import { forwardRef, memo, type RefObject } from 'react';
import type { Zettel } from '@zettelkasten/core';
import type { GalaxyData } from './useGalaxyData';
import { GalaxyCard, type CardActions } from './GalaxyCard';
import type { InplaceEditorHandle } from './InplaceEditor';

/**
 * Contêiner dos cards em coordenadas de mundo. O motor escreve nele o
 * transform da câmera (`setCardLayer`); os cards dentro têm `left/top` fixos.
 * Re-renderiza só quando o conjunto de cards visíveis (ou `heavy`/destaque/
 * edição) muda — `memo`, já que a `Galaxy` re-renderiza a cada mudança de
 * câmera. O card em edição e o em arraste ficam montados mesmo fora do
 * conjunto visível.
 */
export const CardLayer = memo(forwardRef<
  HTMLDivElement,
  {
    data: GalaxyData;
    ids: string[];
    heavy: boolean;
    highlightId: string | null;
    editingId: string | null;
    draggingId: string | null;
    editingZettel: Zettel | null;
    autoFocusTitle: boolean;
    editorRef: RefObject<InplaceEditorHandle | null>;
    actions: CardActions;
  }
>(function CardLayer(
  { data, ids, heavy, highlightId, editingId, draggingId, editingZettel, autoFocusTitle, editorRef, actions },
  ref,
) {
  const all = [...ids];
  for (const id of [editingId, draggingId]) if (id && !all.includes(id)) all.push(id);
  return (
    <div ref={ref} className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ width: 0, height: 0 }}>
      {all.map((id) => {
        const idx = data.indexById.get(id);
        if (idx === undefined) return null;
        const editing = id === editingId;
        return (
          <div key={id} className="pointer-events-auto">
            <GalaxyCard
              meta={data.metas[idx]}
              idx={idx}
              x={data.xs[idx]}
              y={data.ys[idx]}
              heavy={heavy}
              highlighted={highlightId === id}
              editing={editing}
              editingZettel={editing ? editingZettel : null}
              autoFocusTitle={editing && autoFocusTitle}
              editorRef={editorRef}
              actions={actions}
            />
          </div>
        );
      })}
    </div>
  );
}));
