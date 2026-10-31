'use client';

import { useMemo, useState } from 'react';
import { useLevelsStore } from '../../store/useLevelsStore';
import { useLinkIndex } from '../../hooks/useLinkIndex';
import { useZettelStore } from '../../store/useZettelStore';
import { NeonButton, TitleBar, Win } from '../zkos';
import { ZettelWindow } from './ZettelWindow';
import { useLevelActions } from './actions';
import { useLevelsEnv } from './LevelsContext';
import { zkCode } from './format';
import { ConnectionLists } from './ConnectionsColumn';
import { editedAgo } from '../galaxy/HoverCard';

/** Desktop: nomes dos zettels abertos na Memória; clicar torna o zettel ativo. */
export function MemoryList() {
  const consulted = useLevelsStore((s) => s.consulted);
  const activeId = useLevelsStore((s) => s.activeId);
  const { accentOf } = useLevelsEnv();
  const actions = useLevelActions();
  const zettels = useZettelStore((s) => s.zettels);
  const titles = useMemo(() => new Map(zettels.map((z) => [z.id, z.title])), [zettels]);
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="zk-display flex-none px-1 text-[22px] tracking-wider text-zk-amber">
        // ABERTAS NA MEMÓRIA · {consulted.length}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1">
        {consulted.map((id) => {
          const on = id === activeId;
          const color = accentOf(id);
          return (
            <button
              key={id}
              type="button"
              onClick={() => void actions.consult(id)}
              aria-pressed={on}
              className="zk-display min-h-[36px] flex-none truncate border px-3 text-left text-[19px]"
              style={{ borderColor: color, background: on ? color : '#070b14', color: on ? '#04060b' : '#cfe9ee' }}
            >
              {titles.get(id)?.trim() || `Sem título (${zkCode(id)})`}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Celular: tudo sobre as conexões do zettel em foco, recolhível. */
function MobileConnections({ focusId, onOpen }: { focusId: string; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const index = useLinkIndex();
  const zettels = useZettelStore((s) => s.zettels);
  const meta = useMemo(() => zettels.find((z) => z.id === focusId), [zettels, focusId]);
  const count = index.neighbors(focusId).length;
  return (
    <div className="flex-none border border-zk-line bg-zk-panel">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="zk-display flex min-h-[44px] w-full items-center justify-between px-3 text-left text-xl text-zk-amber"
      >
        <span>
          // CONEXÕES · {count}
          {meta ? ` · ${zkCode(focusId)} · ${editedAgo(meta.updatedAt)}` : ''}
        </span>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="flex max-h-[40vh] flex-col gap-2 overflow-y-auto px-3 pb-3">
          <ConnectionLists id={focusId} onOpen={onOpen} />
        </div>
      )}
    </div>
  );
}

/**
 * Nível 2 · Memória: zettels consultados. Um em leitura/edição (o ativo) e os
 * demais como janelas compactas (desktop) ou abas (celular).
 */
export function MemoryScreen() {
  const consulted = useLevelsStore((s) => s.consulted);
  const activeId = useLevelsStore((s) => s.activeId);
  const focusId = useLevelsStore((s) => s.focusId);
  const editing = useLevelsStore((s) => s.editing);
  const startEdit = useLevelsStore((s) => s.startEdit);
  const stopEdit = useLevelsStore((s) => s.stopEdit);
  const { isMobile, accentOf } = useLevelsEnv();
  const actions = useLevelActions();
  const index = useLinkIndex();
  const zettels = useZettelStore((s) => s.zettels);
  const titles = useMemo(() => new Map(zettels.map((z) => [z.id, z.title])), [zettels]);

  const memEditing = editing === 'memory';

  const header = (
    <div className="zk-display flex-none px-1 text-[22px] tracking-wider text-zk-amber">
      // ABERTAS NA MEMÓRIA · {consulted.length}
    </div>
  );

  if (!activeId) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-2">
        {isMobile && header}
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
          <button type="button" className="zk-btn-danger" onClick={() => void actions.requestDelete(activeId)}>
            APAGAR
          </button>
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
        {focusId && !memEditing && <MobileConnections focusId={focusId} onOpen={(id) => void actions.consult(id)} />}
        {active}
      </div>
    );
  }

  return <div className="flex h-full min-h-0 flex-col">{active}</div>;
}
