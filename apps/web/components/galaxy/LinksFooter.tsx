'use client';

import { useState } from 'react';
import { useLinkIndex } from '../../hooks/useLinkIndex';
import { TOUCH_TARGET } from '../../lib/galaxy/touch';

const MAX_CHIPS = 6;

function Row({
  label,
  items,
  onNavigate,
  compact,
  touch,
}: {
  label: string;
  items: { id: string; title: string }[];
  onNavigate: (id: string) => void;
  compact: boolean;
  touch: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;
  const shown = expanded ? items : items.slice(0, MAX_CHIPS);
  const hidden = items.length - shown.length;
  return (
    <div className={`flex items-center gap-1.5 ${compact ? 'flex-nowrap overflow-hidden' : 'flex-wrap'}`}>
      <span className="shrink-0 text-[11px] text-[#9aa3b2]">
        {label} · {items.length}
      </span>
      {shown.map((it) => (
        <button
          key={it.id}
          type="button"
          data-no-pan
          aria-label={`${label}: ${it.title || 'Sem título'}`}
          onClick={() => onNavigate(it.id)}
          className={`max-w-[12rem] shrink-0 truncate rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[12px] text-[#c9cfdb] hover:bg-white/10 ${touch ? TOUCH_TARGET : ''}`}
        >
          {it.title || 'Sem título'}
        </button>
      ))}
      {hidden > 0 && (
        <button
          type="button"
          data-no-pan
          onClick={() => setExpanded(true)}
          className={`shrink-0 rounded-md px-1.5 py-0.5 text-[12px] text-[#9aa3b2] hover:bg-white/5 ${touch ? TOUCH_TARGET : ''}`}
        >
          +{hidden}
        </button>
      )}
    </div>
  );
}

/**
 * Rodapé "Liga a / Referenciado por" do zettel `id`. Some sem nenhum link.
 * `compact` (editor): uma linha por grupo, sem quebra, para não competir com a escrita.
 */
export function LinksFooter({
  id,
  onNavigate,
  compact = false,
  touch = false,
  className = '',
}: {
  id: string;
  onNavigate: (id: string) => void;
  compact?: boolean;
  /** Fora de card (folha, leitor, editor em tela cheia): chips com alvo de 44 px em aparelhos de toque. */
  touch?: boolean;
  className?: string;
}) {
  const index = useLinkIndex();
  const out = index.outgoing(id).map((z) => ({ id: z.id, title: z.title }));
  const inc = index.incoming(id).map((z) => ({ id: z.id, title: z.title }));
  if (out.length === 0 && inc.length === 0) return null;
  return (
    <div
      data-no-pan
      className={`flex flex-col gap-1.5 border-t border-white/[0.06] ${compact ? 'px-4 py-1.5' : 'px-6 py-2.5'} ${className}`}
    >
      <Row label="Liga a" items={out} onNavigate={onNavigate} compact={compact} touch={touch} />
      <Row label="Referenciado por" items={inc} onNavigate={onNavigate} compact={compact} touch={touch} />
    </div>
  );
}
