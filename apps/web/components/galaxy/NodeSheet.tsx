'use client';

import { useEffect, useRef, useState } from 'react';
import type { ZettelMeta } from '@zettelkasten/core';
import { TagChip } from './TagChip';
import { LinksFooter } from './LinksFooter';
import { editedAgo } from './HoverCard';
import type { RelatedItem } from '../../lib/galaxy/related';

/** Arrastar a alça além disto fecha a folha. */
const DISMISS_PX = 80;

/**
 * Folha inferior do nó tocado no celular (no lugar do mini card flutuante, que
 * cobria o próprio nó e não mostrava ligações). Não é overlay: a galáxia por
 * cima segue recebendo pan/pinça/toque; só a alça captura ponteiro, e só
 * durante o arrasto. A altura medida vai para o `Galaxy`, que tira o nó de
 * baixo dela.
 */
export function NodeSheet({
  meta,
  degree,
  related,
  activeTag = null,
  onTag,
  onNavigate,
  onApproach,
  onEdit,
  onFocus,
  onClose,
  onHeight,
}: {
  meta: ZettelMeta;
  degree: number;
  related: RelatedItem[];
  activeTag?: string | null;
  onTag?: (tag: string) => void;
  /** Chip de conexão ou relacionado: salta até o zettel. */
  onNavigate: (id: string) => void;
  onApproach: () => void;
  onEdit: () => void;
  onFocus: () => void;
  onClose: () => void;
  /** Altura atual da folha em px (0 ao desmontar). */
  onHeight: (h: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [dy, setDy] = useState(0);
  const dragRef = useRef<{ y0: number } | null>(null);
  /** O último gesto foi um arrasto: o `click` que o segue não fecha a folha. */
  const draggedRef = useRef(false);
  const onHeightRef = useRef(onHeight);
  onHeightRef.current = onHeight;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => onHeightRef.current(el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => {
      ro.disconnect();
      onHeightRef.current(0);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const action = 'flex min-h-11 flex-1 items-center justify-center rounded-xl px-3 text-sm';

  return (
    <div
      ref={ref}
      data-node-sheet
      role="dialog"
      aria-label={`Zettel ${meta.title || 'sem título'}`}
      className="dark absolute inset-x-0 bottom-0 z-[35] flex max-h-[60vh] flex-col rounded-t-2xl border-t border-white/10 bg-[#0e121a] font-geist text-[#e6e9f0] shadow-2xl"
      style={{
        transform: dy ? `translateY(${dy}px)` : undefined,
        transition: dragRef.current ? 'none' : 'transform 160ms ease-out',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <button
        type="button"
        aria-label="Arrastar para baixo para fechar"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          dragRef.current = { y0: e.clientY };
          draggedRef.current = false;
        }}
        onPointerMove={(e) => {
          if (!dragRef.current) return;
          const d = e.clientY - dragRef.current.y0;
          if (Math.abs(d) > 6) draggedRef.current = true;
          setDy(Math.max(0, d));
        }}
        onPointerUp={(e) => {
          const moved = dragRef.current ? e.clientY - dragRef.current.y0 : 0;
          dragRef.current = null;
          if (moved > DISMISS_PX) onClose();
          else setDy(0);
        }}
        onPointerCancel={() => {
          dragRef.current = null;
          setDy(0);
        }}
        onClick={(e) => {
          // Toque simples na alça (sem arrasto) também fecha.
          if (!draggedRef.current) onClose();
        }}
        className="flex min-h-11 w-full shrink-0 touch-none items-center justify-center"
      >
        <span className="h-1 w-10 rounded-full bg-white/20" />
      </button>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-3">
        <div className="font-newsreader text-xl font-medium leading-snug text-[#f5f3ff]">{meta.title || 'Sem título'}</div>
        <div className="mt-1 text-xs text-[#9aa3b2]">
          {degree === 0 ? 'avulso' : `${degree} ${degree === 1 ? 'conexão' : 'conexões'}`} · {editedAgo(meta.updatedAt)}
        </div>
        {meta.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {meta.tags.map((t) => (
              <TagChip
                key={t}
                tag={t}
                active={activeTag === t}
                onTag={onTag}
                className="min-h-8 rounded-md bg-white/5 px-2 py-1 text-xs text-[#aab2c0]"
              />
            ))}
          </div>
        )}
        {related.length > 0 && (
          <div className="mt-3">
            <div className="text-[11px] text-[#9aa3b2]">Relacionados</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {related.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  title={r.reason}
                  onClick={() => onNavigate(r.id)}
                  className="min-h-11 max-w-full truncate rounded-md border border-white/10 bg-white/5 px-2.5 text-xs text-[#c9cfdb]"
                >
                  {r.title || 'Sem título'}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <LinksFooter id={meta.id} onNavigate={onNavigate} touch className="shrink-0 !px-5" />

      <div className="flex shrink-0 gap-2 px-5 pb-3 pt-2">
        <button type="button" onClick={onFocus} className={`${action} border border-white/10 text-[#c9cfdb]`}>
          Focar
        </button>
        <button type="button" onClick={onApproach} className={`${action} border border-white/10 text-[#c9cfdb]`}>
          Aproximar
        </button>
        <button type="button" onClick={onEdit} className={`${action} bg-brand font-medium text-white`}>
          Editar
        </button>
      </div>
    </div>
  );
}
