'use client';

import { useMemo } from 'react';
import type { ZettelMeta } from '@zettelkasten/core';
import { useZettelStore } from '../../store/useZettelStore';
import { useLinkIndex } from '../../hooks/useLinkIndex';
import { useLevelsEnv } from './LevelsContext';

/** "Liga a" e "Citada por" de um zettel (tags excluídas do mapa ficam de fora). */
export function ConnectionLists({ id, onOpen }: { id: string; onOpen: (id: string) => void }) {
  const index = useLinkIndex();
  const excluded = useZettelStore((s) => s.graphExcludedTags);
  const { accentOf } = useLevelsEnv();

  const { outs, ins } = useMemo(() => {
    const ex = new Set(excluded);
    const keep = (z: ZettelMeta) => ex.size === 0 || !z.tags.some((t) => ex.has(t));
    return { outs: index.outgoing(id).filter(keep), ins: index.incoming(id).filter(keep) };
  }, [index, id, excluded]);

  const row = (z: ZettelMeta) => (
    <button key={z.id} type="button" className="zk-row text-[13.5px] leading-snug" onClick={() => onOpen(z.id)}>
      <span
        aria-hidden="true"
        className="h-[10px] w-[10px] flex-none"
        style={{ background: accentOf(z.id) }}
      />
      <span className="min-w-0">{z.title.trim() || 'Sem título'}</span>
    </button>
  );

  return (
    <>
      <div className="zk-display mt-1 text-xl text-zk-dim">LIGA A · {outs.length}</div>
      {outs.map(row)}
      <div className="zk-display mt-2 text-xl text-zk-dim">CITADA POR · {ins.length}</div>
      {ins.map(row)}
    </>
  );
}

/** Coluna "Conexões" da janela de Foco (desktop): liga a / citada por. */
export function ConnectionsColumn({ id, onOpen }: { id: string; onOpen: (id: string) => void }) {
  return (
    <aside
      aria-label="Conexões"
      className="flex w-[340px] flex-none flex-col gap-2 overflow-y-auto border-l border-zk-line bg-zk-panel p-[18px]"
    >
      <div className="zk-display text-2xl tracking-wider text-zk-amber">// CONEXÕES</div>
      <ConnectionLists id={id} onOpen={onOpen} />
      <div className="flex-1" />
      <p className="zk-display m-0 border border-dashed border-zk-line p-[10px] text-[19px] leading-tight text-zk-dim" style={{ borderColor: '#2a6f80' }}>
        &gt; todas já estão abertas na memória. Abaixe para ver no mapa.
      </p>
    </aside>
  );
}
