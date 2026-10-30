'use client';

import { useMemo } from 'react';
import { useLevelsStore } from '../../store/useLevelsStore';
import { useZettelStore } from '../../store/useZettelStore';
import { NeonButton, TitleBar, Win } from '../zkos';
import { ConnectionMap } from './ConnectionMap';
import { useLevelActions } from './actions';
import { DEFAULT_ACCENT, useLevelsEnv } from './LevelsContext';

/**
 * Nível 3 · Mapa. Tocar numa bolinha consulta o zettel (entra na Memória e vira
 * o ativo) sem trocar o foco. No celular, uma faixa embaixo mostra o
 * selecionado e leva à Memória.
 */
export function MapScreen() {
  const activeId = useLevelsStore((s) => s.activeId);
  const { isMobile, accentOf } = useLevelsEnv();
  const actions = useLevelActions();
  const zettels = useZettelStore((s) => s.zettels);
  const activeTitle = useMemo(() => {
    if (!activeId) return null;
    return zettels.find((z) => z.id === activeId)?.title.trim() || 'Sem título';
  }, [zettels, activeId]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <Win accent={DEFAULT_ACCENT} label="Mapa de conexões" className="min-h-0 flex-1">
        <TitleBar>MAPA_CONEXOES.EXE</TitleBar>
        <div className="min-h-0 flex-1">
          <ConnectionMap onSelect={(id) => void actions.consult(id)} />
        </div>
      </Win>
      {isMobile && (
        <div className="flex flex-none items-center gap-3 border border-dashed bg-zk-panel px-3 py-2" style={{ borderColor: '#2a6f80' }}>
          <p className="zk-display m-0 min-w-0 flex-1 text-xl leading-tight text-zk-dim">
            &gt; selecionado:
            <br />
            <span className="block truncate" style={{ color: activeId ? accentOf(activeId) : '#cfe9ee' }}>
              {activeTitle ?? 'nenhum'}
            </span>
          </p>
          <NeonButton variant="hot" disabled={!activeId} onClick={() => void actions.go('memory')} className="flex-none">
            VER NA MEMÓRIA
          </NeonButton>
        </div>
      )}
    </div>
  );
}
