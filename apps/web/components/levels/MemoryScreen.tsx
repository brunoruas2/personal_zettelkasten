'use client';

import { useMemo } from 'react';
import { useLevelsStore } from '../../store/useLevelsStore';
import { useLinkIndex } from '../../hooks/useLinkIndex';
import { useZettelStore } from '../../store/useZettelStore';
import { useZettelBody } from '../../hooks/useZettelBody';
import { NeonButton, TitleBar, Win } from '../zkos';
import { ZettelWindow } from './ZettelWindow';
import { useLevelActions } from './actions';
import { useLevelsEnv } from './LevelsContext';
import { zkCode } from './format';

/** Primeiros caracteres do corpo, sem a sintaxe de `[[link]]`. */
function preview(body: string): string {
  return body.replace(/\[\[\^?([^\]|]+)(?:\|[^\]]*)?\]\]/g, '$1').replace(/\s+/g, ' ').trim().slice(0, 180);
}

/** Janela compacta (desktop): título na cor do cluster e um trecho do corpo. */
export function CompactWindow({ id, onPick }: { id: string; onPick: (id: string) => void }) {
  const { accentOf } = useLevelsEnv();
  const zettels = useZettelStore((s) => s.zettels);
  const title = useMemo(() => zettels.find((z) => z.id === id)?.title.trim() || 'Sem título', [zettels, id]);
  const { body } = useZettelBody(id);
  return (
    <button
      type="button"
      onClick={() => onPick(id)}
      className="zk-win zk-win-enter flex-none cursor-pointer p-0 text-left text-zk-text"
      style={{ ['--zk-accent' as string]: accentOf(id), height: 128, overflow: 'hidden' }}
      aria-label={`Abrir ${title} na memória`}
    >
      <span className="zk-titlebar" style={{ fontSize: 19, minHeight: 26 }}>
        <span className="truncate">{title}</span>
      </span>
      <span className="line-clamp-5 block px-[10px] py-2 text-[11.5px] leading-relaxed" style={{ color: '#9cc3cf' }}>
        {preview(body)}
      </span>
    </button>
  );
}

/**
 * Nível 2 · Memória: zettels consultados. Um em leitura/edição (o ativo) e os
 * demais como janelas compactas (desktop) ou abas (celular).
 */
export function MemoryScreen() {
  const consulted = useLevelsStore((s) => s.consulted);
  const activeId = useLevelsStore((s) => s.activeId);
  const editing = useLevelsStore((s) => s.editing);
  const startEdit = useLevelsStore((s) => s.startEdit);
  const stopEdit = useLevelsStore((s) => s.stopEdit);
  const { isMobile, accentOf } = useLevelsEnv();
  const actions = useLevelActions();
  const index = useLinkIndex();
  const zettels = useZettelStore((s) => s.zettels);
  const titles = useMemo(() => new Map(zettels.map((z) => [z.id, z.title])), [zettels]);

  const others = consulted.filter((id) => id !== activeId);
  const memEditing = editing === 'memory';

  const header = (
    <div className="zk-display zk-glow flex-none px-1 text-[22px] tracking-wider text-zk-amber">
      // ABERTAS NA MEMÓRIA · {consulted.length}
    </div>
  );

  if (!activeId) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-2">
        {header}
        <Win accent="#19f2ff" className="min-h-0 flex-1" label="Memória vazia">
          <TitleBar>MEMÓRIA — VAZIA</TitleBar>
          <p className="zk-display m-0 p-6 text-2xl text-zk-dim">
            &gt; nada aberto. Toque numa bolinha do mapa ou numa conexão do foco.
          </p>
        </Win>
      </div>
    );
  }

  const active = (
    <ZettelWindow
      id={activeId}
      accent={accentOf(activeId)}
      editing={memEditing}
      onStartEdit={() => startEdit('memory')}
      onStopEdit={stopEdit}
      onOpenLink={(id) => void actions.consult(id)}
      linkCount={index.neighbors(activeId).length}
      titleSuffix="LEITURA"
      className="min-h-0 min-w-0 flex-1"
      actions={
        <div className="flex flex-none gap-2 border-t border-zk-line p-2">
          <NeonButton variant="hot" className="flex-1" onClick={() => void actions.focus(activeId)}>
            ABRIR EM FOCO ▲
          </NeonButton>
          <NeonButton onClick={() => startEdit('memory')}>EDITAR</NeonButton>
          <NeonButton onClick={() => void actions.dismiss(activeId)}>FECHAR</NeonButton>
        </div>
      }
    />
  );

  if (isMobile) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-1">
        {header}
        <div className="zk-hscroll flex flex-none gap-2 overflow-x-auto px-1">
          {consulted.map((id) => {
            const on = id === activeId;
            const color = accentOf(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => void actions.consult(id)}
                aria-pressed={on}
                className="zk-display min-h-[44px] max-w-[170px] flex-none truncate border px-3 text-[19px]"
                style={{ borderColor: color, background: on ? color : '#070b14', color: on ? '#04060b' : '#cfe9ee' }}
              >
                {titles.get(id)?.trim() || `Sem título (${zkCode(id)})`}
              </button>
            );
          })}
        </div>
        {active}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {header}
      <div className="flex min-h-0 flex-1 gap-4">
        {active}
        <div className="flex w-[208px] flex-none flex-col gap-3 overflow-y-auto pb-3 pr-1">
          {others.map((id) => (
            <CompactWindow key={id} id={id} onPick={(pid) => void actions.consult(pid)} />
          ))}
        </div>
      </div>
    </div>
  );
}
