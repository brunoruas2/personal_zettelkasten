'use client';

import { create } from 'zustand';
import {
  consult,
  dismiss,
  focusOn,
  goLevel,
  initialLevels,
  pruneMissing,
  startEditing,
  stopEditing,
  type EditingIn,
  type Level,
  type LevelsState,
  type ZettelMeta,
} from '@zettelkasten/core';
import { useZettelStore } from './useZettelStore';
import { pushRecent } from '../lib/recentZettels';

/**
 * Estado da navegação em três níveis (Foco, Memória, Mapa). A lógica das
 * transições é pura e mora em `@zettelkasten/core` (`Levels.ts`, testada);
 * este store só a aplica sobre o índice e os links do app.
 */
interface LevelsActions {
  /** Define o foco, carrega os links dele na Memória e volta ao nível Foco. */
  setFocus: (id: string) => void;
  consult: (id: string) => void;
  dismiss: (id: string) => void;
  go: (level: Level) => void;
  startEdit: (where: EditingIn) => void;
  stopEdit: () => void;
  /** Aplica um estado inteiro (voltar do sistema). */
  apply: (state: LevelsState) => void;
  /** Descarta ids que sumiram do índice (apagados em outro aparelho). */
  prune: () => void;
}

/** Índice por id, refeito só quando o array do store muda. */
const indexCache = new WeakMap<ZettelMeta[], Map<string, ZettelMeta>>();
export function indexById(zettels: ZettelMeta[]): Map<string, ZettelMeta> {
  let m = indexCache.get(zettels);
  if (!m) {
    m = new Map(zettels.map((z) => [z.id, z]));
    indexCache.set(zettels, m);
  }
  return m;
}

/** Existe no índice e não tem tag excluída da visão. */
function isVisibleFn(): (id: string) => boolean {
  const { zettels, graphExcludedTags } = useZettelStore.getState();
  const byId = indexById(zettels);
  const excluded = new Set(graphExcludedTags);
  return (id) => {
    const z = byId.get(id);
    if (!z) return false;
    return excluded.size === 0 || !z.tags.some((t) => excluded.has(t));
  };
}

export const useLevelsStore = create<LevelsState & LevelsActions>((set, get) => ({
  ...initialLevels,

  setFocus: (id) => {
    const { links } = useZettelStore.getState();
    pushRecent(id);
    set(focusOn(get(), id, links, isVisibleFn()));
  },
  consult: (id) => set(consult(get(), id)),
  dismiss: (id) => set(dismiss(get(), id)),
  go: (level) => set(goLevel(get(), level)),
  startEdit: (where) => set(startEditing(get(), where)),
  stopEdit: () => set(stopEditing(get())),
  apply: (state) => set(state),
  prune: () => {
    const byId = indexById(useZettelStore.getState().zettels);
    set(pruneMissing(get(), (id) => byId.has(id)));
  },
}));

/** Foto só do estado (sem as ações), para as funções puras do core. */
export function levelsSnapshot(): LevelsState {
  const { level, focusId, consulted, activeId, editing, trail } = useLevelsStore.getState();
  return { level, focusId, consulted, activeId, editing, trail };
}
