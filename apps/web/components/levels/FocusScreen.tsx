'use client';

import { EraserButton } from './EraserButton';
import { PdfButton } from './PdfButton';
import { useEffect, useMemo, useRef } from 'react';
import { useLevelsStore } from '../../store/useLevelsStore';
import { useZettelStore } from '../../store/useZettelStore';
import { useLinkIndex } from '../../hooks/useLinkIndex';
import { ZettelWindow } from './ZettelWindow';
import { ConnectionsColumn } from './ConnectionsColumn';
import { useLevelActions } from './actions';
import { useLevelsEnv } from './LevelsContext';
import { discardIfEmpty } from './newNote';

/**
 * Nível 1 · Foco: um zettel em janela grande, leitura e edição no mesmo lugar.
 * Desktop: coluna "Conexões" ao lado; celular: só o zettel (conexões na Mesa).
 */
export function FocusScreen() {
  const focusId = useLevelsStore((s) => s.focusId);
  const editing = useLevelsStore((s) => s.editing);
  const startEdit = useLevelsStore((s) => s.startEdit);
  const stopEdit = useLevelsStore((s) => s.stopEdit);
  const { isMobile, accentOf } = useLevelsEnv();
  const actions = useLevelActions();
  const index = useLinkIndex();

  const trail = useLevelsStore((s) => s.trail);
  const linkCount = useMemo(() => (focusId ? index.neighbors(focusId).length : 0), [index, focusId]);
  // O foco atual é sempre o último da trilha; o anterior é para onde "Voltar" vai.
  const prevId = trail.length > 1 ? trail[trail.length - 2] : null;

  // Folha de papel (desktop): não há "Concluir", então o zettel novo deixado
  // vazio é descartado quando o foco troca. As actions gravam antes de trocar,
  // então o índice já reflete o editor. Mudar de nível não descarta (puxaria de
  // volta ao Foco).
  const lastFocusRef = useRef(focusId);
  useEffect(() => {
    const prev = lastFocusRef.current;
    lastFocusRef.current = focusId;
    if (isMobile || !prev || prev === focusId) return;
    const meta = useZettelStore.getState().zettels.find((z) => z.id === prev);
    if (!meta) return;
    const empty = meta.title.trim() === '' && meta.bodyLen === 0 && meta.tags.length === 0;
    void discardIfEmpty(prev, empty);
  }, [focusId, isMobile]);

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
        alwaysEdit={!isMobile}
        onStartEdit={() => startEdit('focus')}
        onStopEdit={stopEdit}
        onFinished={({ empty }) => void discardIfEmpty(focusId, empty)}
        onOpenLink={(id) => void actions.focus(id)}
        onBack={prevId ? () => void actions.focus(prevId) : undefined}
        linkCount={linkCount}
        compact={isMobile}
        className="min-h-0 flex-1"
        menuActions={
          isMobile
            ? [
                { label: 'Exportar PDF', onClick: () => void actions.requestExport(focusId) },
                { label: 'Apagar', onClick: () => void actions.requestDelete(focusId), danger: true },
              ]
            : undefined
        }
        actions={
          focusEditing || isMobile ? undefined : (
            <div className="flex flex-none justify-end gap-2 border-t border-zk-line p-2">
              <PdfButton onClick={() => void actions.requestExport(focusId)} />
              <EraserButton onClick={() => void actions.requestDelete(focusId)} />
            </div>
          )
        }
        side={isMobile ? undefined : <ConnectionsColumn id={focusId} onOpen={(id) => void actions.focus(id)} />}
      />
    </div>
  );
}
