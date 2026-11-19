'use client';

import { useTypesStore, useZettelType } from '../../store/useTypesStore';
import { assign } from '../../lib/typeSync';

/**
 * Tipo e nível de um zettel no ZK//OS: o selo na barra de título e o seletor
 * da janela. Escolher aqui só grava a atribuição (tabela própria): o corpo e o
 * `updated_at` do zettel não mudam, então nada é salvo nem baixado de novo.
 * O texto escala com `--zk-read-scale` (classes `zk-type-*` em `zkos.css`).
 */

/** Selo para a barra de título: "📘 CONTEÚDO · 💾 TESTADO". Sem tipo, não mostra nada. */
export function TypeStamp({ id }: { id: string }) {
  const info = useZettelType(id);
  if (!info) return null;
  const { type, level } = info;
  return (
    <span className="zk-type-stamp" style={{ color: type.color }} data-testid="type-stamp">
      {' · '}
      {type.icon} {type.name.toUpperCase()}
      {level && (
        <>
          {' · '}
          {level.emoji ? `${level.emoji} ` : ''}
          {level.label.toUpperCase()}
        </>
      )}
    </span>
  );
}

/** Seletor de tipo e, quando o tipo tem escada, de nível. Some se não há tipo cadastrado. */
export function TypePicker({ id }: { id: string }) {
  const types = useTypesStore((s) => s.types);
  const info = useZettelType(id);
  if (types.length === 0) return null;
  const type = info?.type ?? null;
  const level = info?.level ?? null;

  return (
    <div className="flex flex-none flex-wrap items-center gap-1" role="group" aria-label="Tipo do zettel">
      <select
        className="zk-type-select"
        aria-label="Tipo"
        value={type?.id ?? ''}
        onChange={(e) => void assign(id, e.target.value || null)}
      >
        <option value="">Sem tipo</option>
        {types.map((t) => (
          <option key={t.id} value={t.id}>
            {t.icon} {t.name}
          </option>
        ))}
      </select>
      {type && type.levels.length > 0 && (
        <select
          className="zk-type-select"
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
