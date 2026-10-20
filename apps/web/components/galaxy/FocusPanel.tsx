'use client';

import type { ZettelMeta } from '@zettelkasten/core';

export interface FocusItem {
  meta: ZettelMeta;
  depth: number;
}

/**
 * Lista do modo foco: raiz, contagem e os alcançáveis em ordem de árvore com
 * a profundidade. Lateral direita no desktop, gaveta inferior no celular.
 */
export function FocusPanel({
  root,
  items,
  onPick,
  onExit,
}: {
  root: ZettelMeta;
  items: FocusItem[];
  onPick: (id: string) => void;
  onExit: () => void;
}) {
  return (
    <aside className="absolute inset-x-0 bottom-0 z-30 max-h-[45vh] overflow-hidden border-t border-white/10 bg-[#0e121a]/95 font-geist text-[#e6e9f0] shadow-2xl lg:inset-x-auto lg:bottom-auto lg:right-4 lg:top-20 lg:max-h-[calc(100vh-7rem)] lg:w-72 lg:rounded-2xl lg:border">
      <div className="flex items-start justify-between gap-2 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-[#6f7787]">Foco</div>
          <div className="truncate font-newsreader text-lg">{root.title || 'Sem título'}</div>
          <div className="mt-0.5 text-xs text-[#8b93a3]">
            {items.length} zettel{items.length === 1 ? '' : 's'} alcançáve{items.length === 1 ? 'l' : 'is'} · o resto da galáxia está oculto
          </div>
        </div>
        <button
          type="button"
          onClick={onExit}
          className="shrink-0 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-[#c9cfdb] hover:bg-white/5"
        >
          Sair <span className="text-[#6f7787]">Esc</span>
        </button>
      </div>
      <ul className="max-h-[calc(45vh-5rem)] overflow-y-auto py-1 lg:max-h-[calc(100vh-14rem)]">
        {items.map(({ meta, depth }) => (
          <li key={meta.id}>
            <button
              type="button"
              onClick={() => onPick(meta.id)}
              className="flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm hover:bg-white/5"
              style={{ paddingLeft: 16 + Math.min(depth, 6) * 12 }}
            >
              <span className="min-w-0 flex-1 truncate">{meta.title || 'Sem título'}</span>
              <span className="shrink-0 text-[11px] tabular-nums text-[#6f7787]">{depth}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
