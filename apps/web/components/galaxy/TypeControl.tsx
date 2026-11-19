'use client';

import { useTypesStore, useZettelType } from '../../store/useTypesStore';
import { assign } from '../../lib/typeSync';

/**
 * Tipo e nível de um zettel na galáxia: selo no card e seletor da edição.
 * Equivale ao `components/levels/TypeControl.tsx` do ZK//OS, no visual da
 * galáxia. Escolher só grava a atribuição: o corpo e o `updated_at` do zettel
 * não mudam. A cor do selo é a do tipo (paleta fechada, sem as cores reservadas).
 */

/** Selo "📘 Conteúdo · 💾 Testado" na cor do tipo. Sem tipo, não mostra nada. */
export function GalaxyTypeBadge({ id, className = '' }: { id: string; className?: string }) {
  const info = useZettelType(id);
  if (!info) return null;
  const { type, level } = info;
  return (
    <span
      data-testid="type-badge"
      className={`inline-flex max-w-full items-center gap-1 truncate rounded-md border px-1.5 py-0.5 text-[11px] ${className}`}
      style={{ color: type.color, borderColor: `${type.color}66`, backgroundColor: `${type.color}14` }}
    >
      <span aria-hidden>{type.icon}</span>
      {type.name}
      {level && (
        <>
          <span aria-hidden className="opacity-60">·</span>
          {level.emoji ? <span aria-hidden>{level.emoji}</span> : null}
          {level.label}
        </>
      )}
    </span>
  );
}

const select =
  'max-w-[11rem] rounded-md border border-white/15 bg-[#0e121a] px-2 py-1 text-xs text-[#e6e9f0] outline-none focus:border-white/40';

/** Seletor de tipo e (se o tipo tem escada) de nível. Some se não há tipo cadastrado. */
export function GalaxyTypePicker({ id }: { id: string }) {
  const types = useTypesStore((s) => s.types);
  const info = useZettelType(id);
  if (types.length === 0) return null;
  const type = info?.type ?? null;
  const level = info?.level ?? null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Tipo do zettel">
      <select className={select} aria-label="Tipo" value={type?.id ?? ''} onChange={(e) => void assign(id, e.target.value || null)}>
        <option value="">Sem tipo</option>
        {types.map((t) => (
          <option key={t.id} value={t.id}>
            {t.icon} {t.name}
          </option>
        ))}
      </select>
      {type && type.levels.length > 0 && (
        <select
          className={select}
          aria-label="Nível"
          value={level?.key ?? ''}
          onChange={(e) => void assign(id, type.id, e.target.value || null)}
        >
          <option value="">Sem nível</option>
          {type.levels.map((l) => (
            <option key={l.key} value={l.key}>
              {l.emoji ? `${l.emoji} ` : ''}
              {l.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
