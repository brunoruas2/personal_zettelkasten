'use client';

import { useMemo } from 'react';
import type { Level } from '@zettelkasten/core';
import { useLevelsStore } from '../../store/useLevelsStore';
import { useZettelStore } from '../../store/useZettelStore';
import { useDeleteRequestStore } from '../../store/useDeleteRequestStore';
import { useExportRequestStore } from '../../store/useExportRequestStore';
import { flushActiveEdit } from './ZettelWindow';

/**
 * Ações de navegação que gravam a edição pendente antes de mudar de zettel
 * ou de nível. Estável entre renders (usa o store por `getState`).
 */
export function useLevelActions() {
  return useMemo(() => {
    const st = () => useLevelsStore.getState();
    return {
      /** Troca o foco e recarrega a Mesa com os links dele. */
      focus: async (id: string) => {
        await flushActiveEdit();
        st().setFocus(id);
      },
      /** Consulta sem mudar o foco (Mesa e Mapa). */
      consult: async (id: string) => {
        await flushActiveEdit();
        st().consult(id);
      },
      /** Consulta e vai ao nível Mesa (Conexões do Foco, chips, mapa). */
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
      /** Grava a edição pendente e abre a confirmação de exclusão. */
      requestDelete: async (id: string) => {
        await flushActiveEdit();
        if (st().editing) st().stopEdit();
        useDeleteRequestStore.getState().request(id);
      },
      /** Grava a edição pendente e abre o modal de escopo do PDF. */
      requestExport: async (id: string) => {
        await flushActiveEdit();
        if (st().editing) st().stopEdit();
        useExportRequestStore.getState().request(id);
      },
    };
  }, []);
}

/**
 * Apaga o zettel e ajusta os níveis: o foco apagado passa ao anterior da
 * trilha; o de Mesa sai das consultas. O resto (ids órfãos) o
 * `useLevelsSync` poda quando o índice muda.
 */
export async function deleteFromLevels(id: string): Promise<void> {
  const lv = useLevelsStore.getState();
  if (lv.focusId === id) {
    const prev = [...lv.trail].reverse().find((x) => x !== id);
    if (prev) lv.setFocus(prev);
  }
  lv.dismiss(id);
  await useZettelStore.getState().deleteZettel(id);
}
