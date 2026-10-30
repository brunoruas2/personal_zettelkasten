'use client';

import { useEffect, useRef } from 'react';
import { backStep, type Level, type LevelsState } from '@zettelkasten/core';
import { useZettelStore } from '../../store/useZettelStore';
import { levelsSnapshot, useLevelsStore } from '../../store/useLevelsStore';
import { getRecentIds } from '../../lib/recentZettels';

const LEVELS: Level[] = ['focus', 'memory', 'map'];

/** Quantas entradas de histórico o estado atual "deve" ter empilhadas. */
function depthOf(s: LevelsState): number {
  return (s.level === 'map' ? 2 : s.level === 'memory' ? 1 : 0) + (s.editing ? 1 : 0);
}

/** Grava `?z=` e `?v=` em `/` sem empilhar histórico (spec: level-navigation). */
function writeUrl(s: LevelsState): void {
  const params = new URLSearchParams();
  if (s.focusId) params.set('z', s.focusId);
  if (s.level !== 'focus') params.set('v', s.level);
  const qs = params.toString();
  window.history.replaceState(window.history.state, '', qs ? `/?${qs}` : '/');
}

/**
 * Liga o store de níveis ao app:
 *  - na primeira vez com o índice pronto, escolhe o foco (`?z=`, depois o
 *    último visitado, depois o mais recente) e o nível (`?v=`);
 *  - espelha foco e nível na URL;
 *  - voltar do sistema encerra a edição, depois volta de nível, e só então
 *    sai do app (uma entrada de histórico por degrau de profundidade);
 *  - poda ids apagados quando o índice muda.
 */
export function useLevelsSync(): void {
  const zettels = useZettelStore((s) => s.zettels);
  const isLoading = useZettelStore((s) => s.isLoading);
  const booted = useRef(false);

  // Foco inicial.
  useEffect(() => {
    if (booted.current || isLoading || zettels.length === 0) return;
    booted.current = true;
    const ids = new Set(zettels.map((z) => z.id));
    const params = new URLSearchParams(window.location.search);
    const z = params.get('z');
    const v = params.get('v') as Level | null;
    const recent = getRecentIds().find((id) => ids.has(id));
    const newest = [...zettels].sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id;
    const first = (z && ids.has(z) ? z : null) ?? recent ?? newest ?? null;
    if (!first) return;
    const { setFocus, go } = useLevelsStore.getState();
    setFocus(first);
    if (v && LEVELS.includes(v) && v !== 'focus') go(v);
  }, [zettels, isLoading]);

  // Índice mudou: tira o que foi apagado.
  useEffect(() => {
    if (booted.current) useLevelsStore.getState().prune();
  }, [zettels]);

  // URL + histórico.
  useEffect(() => {
    let pushed = 0;
    let ignore = 0;

    const sync = () => {
      const s = levelsSnapshot();
      writeUrl(s);
      const d = depthOf(s);
      if (d > pushed) {
        for (let i = pushed; i < d; i++) window.history.pushState({ zkLevels: true }, '', window.location.href);
        pushed = d;
      } else if (d < pushed) {
        const n = pushed - d;
        pushed = d;
        ignore += 1; // um `go(-n)` dispara um único popstate
        window.history.go(-n);
      }
    };

    const onPop = () => {
      if (ignore > 0) {
        ignore -= 1;
        return;
      }
      if (pushed === 0) return;
      pushed -= 1;
      const { state } = backStep(levelsSnapshot());
      useLevelsStore.getState().apply(state);
    };

    const unsub = useLevelsStore.subscribe(sync);
    window.addEventListener('popstate', onPop);
    return () => {
      unsub();
      window.removeEventListener('popstate', onPop);
    };
  }, []);
}
