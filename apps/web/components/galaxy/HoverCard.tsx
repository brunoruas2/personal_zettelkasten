'use client';

import type { ZettelMeta } from '@zettelkasten/core';
import { TagChip } from './TagChip';
import type { RelatedItem } from '../../lib/galaxy/related';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function editedAgo(ms: number, now = Date.now()): string {
  const d = Math.max(0, now - ms);
  if (d < HOUR) return 'editado há pouco';
  if (d < DAY) {
    const h = Math.round(d / HOUR);
    return `editado há ${h} hora${h === 1 ? '' : 's'}`;
  }
  if (d < 45 * DAY) {
    const n = Math.round(d / DAY);
    return `editado há ${n} dia${n === 1 ? '' : 's'}`;
  }
  if (d < 365 * DAY) {
    const n = Math.round(d / (30 * DAY));
    return `editado há ${n} ${n === 1 ? 'mês' : 'meses'}`;
  }
  const n = Math.round(d / (365 * DAY));
  return `editado há ${n} ano${n === 1 ? '' : 's'}`;
}

/** Mini card do ponto em hover (ou tocado): metadados e ações, sem corpo. */
export function HoverCard({
  meta,
  degree,
  x,
  y,
  onApproach,
  onEdit,
  onFocus,
  onPointerEnter,
  onPointerLeave,
  onTag,
  activeTag = null,
  related = [],
  onRelated,
}: {
  /** Até 3 relacionados (desktop); vazio no celular. */
  related?: RelatedItem[];
  onRelated?: (id: string) => void;
  meta: ZettelMeta;
  degree: number;
  x: number;
  y: number;
  /** Chip de tag: liga/desliga o filtro de tag da galáxia. */
  onTag?: (tag: string) => void;
  activeTag?: string | null;
  onApproach: () => void;
  onEdit: () => void;
  onFocus: () => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}) {
  return (
    <div
      data-hover-card
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      className="pointer-events-auto absolute z-20 w-64 -translate-x-1/2 rounded-xl border border-white/10 bg-[#0e121a] px-4 py-3 font-geist text-[#e6e9f0] shadow-2xl"
      style={{ left: x, top: y + 14 }}
    >
      <div className="font-newsreader text-base font-medium leading-snug">{meta.title || 'Sem título'}</div>
      {meta.tags.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {meta.tags.map((t) => (
            <TagChip
              key={t}
              tag={t}
              active={activeTag === t}
              onTag={onTag}
              className="rounded-md bg-white/5 px-1.5 py-0.5 text-[11px] text-[#8b93a3]"
            />
          ))}
        </div>
      )}
      <div className="mt-2 text-xs text-[#6f7787]">
        {degree === 0 ? 'avulso' : `${degree} ${degree === 1 ? 'conexão' : 'conexões'}`} · {editedAgo(meta.updatedAt)}
      </div>
      {related.length > 0 && (
        <div className="mt-2.5">
          <div className="text-[11px] text-[#9aa3b2]">Relacionados</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {related.map((r) => (
              <button
                key={r.id}
                type="button"
                title={r.reason}
                onClick={() => onRelated?.(r.id)}
                className="max-w-full truncate rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[11px] text-[#c9cfdb] hover:bg-white/10"
              >
                {r.title || 'Sem título'}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onFocus}
          className="flex-1 rounded-lg border border-white/10 px-2 py-1.5 text-xs text-[#c9cfdb] hover:bg-white/5"
        >
          Focar
        </button>
        <button
          type="button"
          onClick={onApproach}
          className="flex-1 rounded-lg border border-white/10 px-2 py-1.5 text-xs text-[#c9cfdb] hover:bg-white/5"
        >
          Aproximar
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="flex-1 rounded-lg bg-brand px-2 py-1.5 text-xs font-medium text-white hover:opacity-90"
        >
          Editar
        </button>
      </div>
    </div>
  );
}
