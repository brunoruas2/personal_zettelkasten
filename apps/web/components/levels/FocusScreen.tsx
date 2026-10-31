'use client';

import { useMemo } from 'react';
import { useLevelsStore } from '../../store/useLevelsStore';
import { useLinkIndex } from '../../hooks/useLinkIndex';
import { ZettelWindow } from './ZettelWindow';
import { ConnectionsColumn } from './ConnectionsColumn';
import { useLevelActions } from './actions';
import { useLevelsEnv } from './LevelsContext';
import { discardIfEmpty } from './newNote';

/**
 * Nível 1 · Foco: um zettel em janela grande, leitura e edição no mesmo lugar.
 * Desktop: coluna "Conexões" ao lado; celular: só o zettel (conexões na Memória).
 */
export function FocusScreen() {
  const focusId = useLevelsStore((s) => s.focusId);
  const editing = useLevelsStore((s) => s.editing);
  const startEdit = useLevelsStore((s) => s.startEdit);
  const stopEdit = useLevelsStore((s) => s.stopEdit);
  const { isMobile, accentOf } = useLevelsEnv();
  const actions = useLevelActions();
  const index = useLinkIndex();

  const linkCount = useMemo(() => (focusId ? index.neighbors(focusId).length : 0), [index, focusId]);

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
        compact={isMobile}
        className="min-h-0 flex-1"
        actions={
          focusEditing ? undefined : isMobile ? (
            <button type="button" className="zk-btn-danger" onClick={() => void actions.requestDelete(focusId)}>
              APAGAR
            </button>
          ) : (
            <div className="flex flex-none justify-end gap-2 border-t border-zk-line p-2">
              <button type="button" className="zk-btn-danger" onClick={() => void actions.requestDelete(focusId)}>
                APAGAR
              </button>
            </div>
          )
        }
        side={isMobile ? undefined : <ConnectionsColumn id={focusId} onOpen={(id) => void actions.openInMemory(id)} />}
      />
    </div>
  );
}
