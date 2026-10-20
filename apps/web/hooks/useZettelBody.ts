'use client';

import { useEffect, useState } from 'react';
import { getCachedBody, setCachedBody, subscribeBody } from '../lib/bodyCache';
import { isBodyMissing, loadZettel } from '../lib/bodySync';

export type BodyStatus = 'loading' | 'ready' | 'stale' | 'missing';

/**
 * Corpo de um zettel para exibição: cache LRU, senão IndexedDB (buscando no
 * servidor se estiver desatualizado e houver rede). `stale` = há um corpo, mas
 * de uma versão anterior; `missing` = nada baixado neste aparelho.
 */
export function useZettelBody(id: string | null): { body: string; status: BodyStatus } {
  const [state, setState] = useState<{ body: string; status: BodyStatus }>(() => {
    const cached = id ? getCachedBody(id) : undefined;
    return cached !== undefined ? { body: cached, status: 'ready' } : { body: '', status: 'loading' };
  });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!id) return;
    return subscribeBody(id, () => setVersion((v) => v + 1));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const cached = getCachedBody(id);
    if (cached !== undefined) {
      setState({ body: cached, status: 'ready' });
      return;
    }
    let cancelled = false;
    setState((s) => (s.status === 'loading' ? s : { body: s.body, status: 'loading' }));
    void loadZettel(id).then(({ zettel, stale }) => {
      if (cancelled) return;
      if (!zettel || isBodyMissing(zettel)) {
        setState({ body: '', status: 'missing' });
      } else if (stale) {
        setState({ body: zettel.body, status: 'stale' });
      } else {
        setCachedBody(id, zettel.body, zettel.bodyLen);
        setState({ body: zettel.body, status: 'ready' });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [id, version]);

  return state;
}
