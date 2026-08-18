'use client';

import { useCallback } from 'react';

/**
 * Router wrapper that always uses window.location (hard navigation).
 *
 * Next.js soft navigation (router.push) fetches an RSC payload for the target
 * route. If that route has never been visited, there's no cached RSC response,
 * and the fetch fails offline — showing a loading spinner indefinitely.
 *
 * Hard navigation lets the service worker intercept and serve the cached app
 * shell (/), which then renders the correct page from IndexedDB.
 *
 * navigator.onLine is NOT used: iOS Safari reports true even in airplane mode,
 * making it unreliable as an offline gate.
 */
export function useOfflineRouter() {
  const push = useCallback((url: string) => {
    window.location.href = url;
  }, []);

  const replace = useCallback((url: string) => {
    window.location.replace(url);
  }, []);

  return { push, replace };
}
