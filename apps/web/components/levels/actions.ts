'use client';

import { useMemo } from 'react';
import type { Level } from '@zettelkasten/core';
import { useLevelsStore } from '../../store/useLevelsStore';
import { flushActiveEdit } from './ZettelWindow';

/**
 * Ações de navegação que gravam a edição pendente antes de mudar de zettel
 * ou de nível. Estável entre renders (usa o store por `getState`).
 */
export function useLevelActions() {
  return useMemo(() => {
    const st = () => useLevelsStore.getState();
    return {
      /** Troca o foco e recarrega a Memória com os links dele. */
      focus: async (id: string) => {
        await flushActiveEdit();
        st().setFocus(id);
      },
      /** Consulta sem mudar o foco (Memória e Mapa). */
      consult: async (id: string) => {
        await flushActiveEdit();
        st().consult(id);
      },
      /** Consulta e vai ao nível Memória (Conexões do Foco, chips, mapa). */
      openInMemory: async (id: string) => {
        await flushActiveEdit();
        st().consult(id);
        st().go('memory');
      },
      dismiss: async (id: string) => {
        await flushActiveEdit();
        st().dismiss(id);
      },
      go: async (level: Level) => {
        await flushActiveEdit();
        st().go(level);
      },
    };
  }, []);
}
