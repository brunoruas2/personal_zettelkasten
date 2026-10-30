'use client';

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { useZettelStore } from '../../store/useZettelStore';
import { useGalaxyData, type GalaxyData } from '../galaxy/useGalaxyData';

/** Cor padrão de janela/bolinha sem cluster configurado (ciano do tema). */
export const DEFAULT_ACCENT = '#19f2ff';
/** Janela em edição. */
export const EDIT_ACCENT = '#ffb000';

/**
 * O que as telas dos níveis compartilham: dados do mapa (posições, cores de
 * cluster), cor por zettel, resolução de `[[título]]` e se o aparelho é
 * celular. Montado uma vez em `Levels`.
 */
export interface LevelsEnv {
  data: GalaxyData;
  /** Cor do cluster do zettel (ou o ciano do tema). */
  accentOf: (id: string) => string;
  /** `[[título]]` → id, sem caixa (mesma regra do `findByTitle`). */
  resolveTitle: (title: string) => string | undefined;
  isMobile: boolean;
  /** `[[novo]]` no editor: cria o zettel; a posição sai do posicionamento automático. */
  createLinked: (title: string) => Promise<void>;
}

const Ctx = createContext<LevelsEnv | null>(null);

export function useLevelsEnv(): LevelsEnv {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLevelsEnv fora de <LevelsEnvProvider>');
  return v;
}

const MOBILE_QUERY = '(pointer: coarse), (max-width: 1023px)';

function subscribeMobile(cb: () => void): () => void {
  const mq = window.matchMedia(MOBILE_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

/** Celular = toque ou viewport estreito (mesma regra de `isMobileDevice` da galáxia). */
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribeMobile,
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  );
}

export function LevelsEnvProvider({ children }: { children: ReactNode }) {
  const data = useGalaxyData();
  const isMobile = useIsMobile();
  const createZettel = useZettelStore((s) => s.createZettel);

  const idByTitle = useMemo(() => {
    const zs = useZettelStore.getState().zettels;
    const m = new Map<string, string>();
    for (const z of zs) {
      const k = z.title.trim().toLowerCase();
      if (!m.has(k)) m.set(k, z.id);
    }
    return m;
    // `data.metas` muda junto com o índice; os não posicionados entram pelo store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const accentOf = useCallback(
    (id: string) => {
      const idx = data.indexById.get(id);
      return (idx !== undefined ? data.nebula[idx] : null) ?? DEFAULT_ACCENT;
    },
    [data],
  );

  const resolveTitle = useCallback((title: string) => idByTitle.get(title.trim().toLowerCase()), [idByTitle]);

  const createLinked = useCallback(
    async (title: string) => {
      await createZettel({ title, body: '', tags: [] });
    },
    [createZettel],
  );

  const value = useMemo<LevelsEnv>(
    () => ({ data, accentOf, resolveTitle, isMobile, createLinked }),
    [data, accentOf, resolveTitle, isMobile, createLinked],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
