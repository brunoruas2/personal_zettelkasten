'use client';

import { useMemo } from 'react';
import { useLevelsStore } from '../../store/useLevelsStore';
import { useLinkIndex } from '../../hooks/useLinkIndex';
import { useZettelStore } from '../../store/useZettelStore';
import { ZettelWindow } from './ZettelWindow';
import { ConnectionsColumn } from './ConnectionsColumn';
import { useLevelActions } from './actions';
import { useLevelsEnv } from './LevelsContext';
import { discardIfEmpty } from './newNote';

/**
 * Nível 1 · Foco: um zettel em janela grande, leitura e edição no mesmo lugar.
 * Desktop: coluna "Conexões" ao lado; celular: chips das notas ligadas abaixo.
 */
export function FocusScreen() {
  const focusId = useLevelsStore((s) => s.focusId);
  const editing = useLevelsStore((s) => s.editing);
  const consulted = useLevelsStore((s) => s.consulted);
  const startEdit = useLevelsStore((s) => s.startEdit);
  const stopEdit = useLevelsStore((s) => s.stopEdit);
  const { isMobile, accentOf } = useLevelsEnv();
  const actions = useLevelActions();
  const index = useLinkIndex();
  const zettels = useZettelStore((s) => s.zettels);

  const linkCount = useMemo(() => (focusId ? index.neighbors(focusId).length : 0), [index, focusId]);
  const titles = useMemo(() => new Map(zettels.map((z) => [z.id, z.title])), [zettels]);

  if (!focusId) {
    return (
      <div className="zk-display flex h-full items-center justify-center text-2xl text-zk-dim">
        &gt; nenhum zettel em foco. Crie ou busque uma nota.
      </div>
    );
  }

  const focusEditing = editing === 'focus';

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <ZettelWindow
        id={focusId}
        accent={accentOf(focusId)}
        editing={focusEditing}
        onStartEdit={() => startEdit('focus')}
        onStopEdit={stopEdit}
        onFinished={({ empty }) => void discardIfEmpty(focusId, empty)}
        onOpenLink={(id) => void actions.focus(id)}
        linkCount={linkCount}
        className="min-h-0 flex-1"
        side={isMobile ? undefined : <ConnectionsColumn id={focusId} onOpen={(id) => void actions.openInMemory(id)} />}
      />
      {isMobile && !focusEditing && (
        <div className="flex-none px-1">
          <div className="zk-display px-1 text-[17px] text-zk-dim">&gt; ligadas a esta nota · toque para abrir na memória</div>
          <div className="zk-hscroll flex gap-2 overflow-x-auto">
            {consulted.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => void actions.openInMemory(id)}
                className="flex min-h-[44px] max-w-[200px] flex-none items-center gap-2 border bg-zk-panel px-3 text-left text-[12.5px] text-zk-text"
                style={{ borderColor: accentOf(id) }}
              >
                <span
                  aria-hidden="true"
                  className="h-[9px] w-[9px] flex-none"
                  style={{ background: accentOf(id), boxShadow: `0 0 8px ${accentOf(id)}` }}
                />
                <span className="truncate">{titles.get(id)?.trim() || 'Sem título'}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
