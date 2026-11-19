'use client';

import { useMemo } from 'react';
import { summarizeLevels, trailProgress, type LevelGroup } from '@zettelkasten/core';
import { useLevelsStore, type MaturityFilter } from '../../store/useLevelsStore';
import { useTypesStore } from '../../store/useTypesStore';
import { useZettelStore } from '../../store/useZettelStore';
import { useLevelsEnv } from './LevelsContext';

/** Pedido para abrir o painel de tipos (o `Levels` escuta). */
export const OPEN_TYPES_EVENT = 'zk:open-types';

const sameFilter = (a: MaturityFilter | null, typeId: string, levelKey: string | null) =>
  !!a && a.typeId === typeId && a.levelKey === levelKey;

/**
 * Caixa de maturidade do Mapa (ZK//OS): quantos zettels há em cada nível, só dos
 * tipos que contam no progresso das trilhas, e o progresso da trilha em foco.
 * Clicar num nível esmaece no mapa o que não casa (filtro só de UI). Os níveis
 * usam o emoji e o rótulo do tipo; a cor do nível nunca é ciano, âmbar nem
 * magenta (essas são do agente, da edição e do perigo). Texto por
 * `--zk-read-scale`, como o resto do ZK//OS.
 */
export function MaturityHud() {
  const { isMobile } = useLevelsEnv();
  const typeById = useTypesStore((s) => s.typeById);
  const assignments = useTypesStore((s) => s.assignments);
  const links = useZettelStore((s) => s.links);
  const focusId = useLevelsStore((s) => s.focusId);
  const filter = useLevelsStore((s) => s.maturityFilter);
  const setFilter = useLevelsStore((s) => s.setMaturityFilter);

  const base = useMemo(
    () => summarizeLevels(assignments.keys(), assignments, typeById, { includeEmptyTypes: true }),
    [assignments, typeById],
  );
  const trail = useMemo(
    () => (focusId ? trailProgress(links, focusId, assignments, typeById) : null),
    [links, focusId, assignments, typeById],
  );

  const toggle = (typeId: string, levelKey: string | null) => setFilter(sameFilter(filter, typeId, levelKey) ? null : { typeId, levelKey });
  const text = 'zk-display text-[length:calc(19px*var(--zk-read-scale,1))]';

  const chip = (key: string, label: string, aria: string, count: number, typeId: string, levelKey: string | null, clickable = true) => {
    const active = sameFilter(filter, typeId, levelKey);
    const cls = `${text} flex items-center gap-1 px-2 leading-none`;
    const style = {
      minHeight: isMobile ? 44 : 28,
      border: `1px solid ${active ? '#ffffff' : 'var(--zk-line-strong)'}`,
      background: active ? 'rgba(255,255,255,0.18)' : 'transparent',
      color: '#cfe9ee',
    } as const;
    if (!clickable) {
      return (
        <span key={key} className={cls} style={{ ...style, minHeight: undefined, border: '1px solid var(--zk-line)' }} aria-label={aria}>
          {label} <b>{count}</b>
        </span>
      );
    }
    return (
      <button key={key} type="button" aria-pressed={active} aria-label={aria} title={aria} onClick={() => toggle(typeId, levelKey)} className={cls} style={style}>
        {label} <b>{count}</b>
      </button>
    );
  };

  const groupRows = (groups: LevelGroup[], clickable: boolean) =>
    groups.map((g) => (
      <div key={g.type.id} className="mt-1">
        <div className={`${text} flex items-baseline justify-between gap-2`} style={{ color: g.type.color }}>
          <span className="truncate">
            {g.type.icon} {g.type.name}
          </span>
          <span className="flex-none text-zk-dim">{g.total}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap gap-1">
          {g.levels.length === 0
            ? chip(`${g.type.id}-all`, 'todos', `${g.type.name}: ${g.total}`, g.total, g.type.id, null, clickable)
            : g.levels.map((l) =>
                chip(`${g.type.id}-${l.key}`, l.emoji || l.label, `${l.label}: ${l.count}`, l.count, g.type.id, l.key, clickable),
              )}
          {g.noLevel > 0 && chip(`${g.type.id}-none`, 'sem nível', `Sem nível: ${g.noLevel}`, g.noLevel, g.type.id, '', clickable)}
        </div>
      </div>
    ));

  const hasCounting = base.groups.length > 0;
  const trailVisible = !!trail && trail.total > 0;

  return (
    <div
      className="absolute bottom-2 right-2 z-10 max-h-[60%] w-[min(320px,70%)] overflow-y-auto border border-zk-line bg-zk-panel p-2"
      role="region"
      aria-label="Maturidade"
      data-testid="maturity-hud"
    >
      <div className={`${text} flex items-center justify-between gap-2 text-zk-dim`}>
        <span>&gt; MATURIDADE</span>
        {filter && (
          <button
            type="button"
            onClick={() => setFilter(null)}
            className={`${text} px-1`}
            style={{ minHeight: isMobile ? 44 : undefined, color: '#cfe9ee', textDecoration: 'underline' }}
          >
            limpar
          </button>
        )}
      </div>

      {!hasCounting && (
        <div className={`${text} mt-1 text-zk-dim`}>
          <p className="m-0">Nenhum tipo de conteúdo cadastrado.</p>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event(OPEN_TYPES_EVENT))}
            className={`${text} mt-1 px-2`}
            style={{ minHeight: isMobile ? 44 : 28, border: '1px solid var(--zk-line-strong)', color: '#cfe9ee' }}
          >
            cadastrar tipos
          </button>
        </div>
      )}

      {hasCounting && groupRows(base.groups, true)}

      {trailVisible && trail && (
        <div className="mt-2 border-t border-zk-line pt-1">
          <div className={`${text} text-zk-dim`}>&gt; EM FOCO · {trail.total}</div>
          {groupRows(trail.groups, false)}
        </div>
      )}
    </div>
  );
}
