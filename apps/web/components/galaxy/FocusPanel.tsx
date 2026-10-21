'use client';

import { useEffect, useRef } from 'react';
import type { ZettelMeta } from '@zettelkasten/core';

export interface FocusItem {
  meta: ZettelMeta;
  depth: number;
}

/** Dados do foco compartilhados pelo painel da galáxia e pela leitura em tela cheia. */
export interface FocusView {
  root: ZettelMeta;
  items: FocusItem[];
  /** Alcançáveis visíveis, antes do filtro de níveis. */
  total: number;
  /** Nível efetivo (`'all'` quando cobre a subárvore inteira). */
  depth: number | 'all';
  maxDepth: number;
  onDepthChange: (depth: number | 'all') => void;
}

/** Raiz, contagem e seletor de níveis; "Sair" só quando há `onExit`. */
export function FocusHeader({
  root,
  items,
  total,
  depth,
  maxDepth,
  onDepthChange,
  onExit,
}: FocusView & { onExit?: () => void }) {
  const shown = depth === 'all' ? maxDepth : depth;
  const canLess = shown > 1;
  const canMore = depth !== 'all';
  const stepBtn =
    'flex h-6 w-6 items-center justify-center rounded-md border border-white/10 text-[#c9cfdb] hover:bg-white/5 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent';
  return (
    <div className="flex items-start justify-between gap-2 border-b border-white/10 px-4 py-3">
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-[#6f7787]">Foco</div>
        <div className="truncate font-newsreader text-lg">{root.title || 'Sem título'}</div>
        <div className="mt-0.5 text-xs text-[#8b93a3]">
          {items.length === total
            ? `${total} zettel${total === 1 ? '' : 's'} alcançáve${total === 1 ? 'l' : 'is'}`
            : `${items.length} de ${total} zettels`}
          {onExit && ' · o resto da galáxia está oculto'}
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-xs text-[#8b93a3]">
          <span className="mr-0.5">Níveis</span>
          <button
            type="button"
            aria-label="Menos níveis"
            disabled={!canLess}
            onClick={() => onDepthChange(shown - 1)}
            className={stepBtn}
          >
            −
          </button>
          <span className="w-5 text-center tabular-nums text-[#e6e9f0]">{shown}</span>
          <button
            type="button"
            aria-label="Mais níveis"
            disabled={!canMore}
            onClick={() => onDepthChange(shown + 1)}
            className={stepBtn}
          >
            +
          </button>
          <button
            type="button"
            disabled={maxDepth === 0}
            aria-pressed={depth === 'all'}
            onClick={() => onDepthChange('all')}
            className={`ml-1 rounded-md border px-2 py-0.5 disabled:opacity-30 ${
              depth === 'all'
                ? 'border-brand/60 bg-brand/15 text-brand-light'
                : 'border-white/10 text-[#c9cfdb] hover:bg-white/5'
            }`}
          >
            Todos
          </button>
        </div>
      </div>
      {onExit && (
        <button
          type="button"
          onClick={onExit}
          className="shrink-0 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-[#c9cfdb] hover:bg-white/5"
        >
          Sair <span className="text-[#6f7787]">Esc</span>
        </button>
      )}
    </div>
  );
}

/** Itens em ordem de árvore; `activeId` fica destacado e visível na rolagem. */
export function FocusList({
  items,
  activeId,
  onPick,
  className,
}: {
  items: FocusItem[];
  activeId?: string;
  onPick: (id: string) => void;
  className?: string;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);
  return (
    <ul className={className}>
      {items.map(({ meta, depth }) => {
        const active = meta.id === activeId;
        return (
          <li key={meta.id}>
            <button
              ref={active ? activeRef : undefined}
              type="button"
              aria-current={active || undefined}
              onClick={() => onPick(meta.id)}
              className={`flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm ${
                active ? 'bg-brand/15 text-brand-light' : 'hover:bg-white/5'
              }`}
              style={{ paddingLeft: 16 + Math.min(depth, 6) * 12 }}
            >
              <span className="min-w-0 flex-1 truncate">{meta.title || 'Sem título'}</span>
              <span className="shrink-0 text-[11px] tabular-nums text-[#6f7787]">{depth}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Lista do modo foco: raiz, contagem e os alcançáveis em ordem de árvore com
 * a profundidade. Lateral direita no desktop, gaveta inferior no celular.
 */
export function FocusPanel({
  onPick,
  onExit,
  ...view
}: FocusView & {
  onPick: (id: string) => void;
  onExit: () => void;
}) {
  return (
    <aside className="absolute inset-x-0 bottom-0 z-30 max-h-[45vh] overflow-hidden border-t border-white/10 bg-[#0e121a]/95 font-geist text-[#e6e9f0] shadow-2xl lg:inset-x-auto lg:bottom-auto lg:right-4 lg:top-20 lg:max-h-[calc(100vh-7rem)] lg:w-72 lg:rounded-2xl lg:border">
      <FocusHeader {...view} onExit={onExit} />
      <FocusList
        items={view.items}
        onPick={onPick}
        className="max-h-[calc(45vh-5rem)] overflow-y-auto py-1 lg:max-h-[calc(100vh-14rem)]"
      />
    </aside>
  );
}
