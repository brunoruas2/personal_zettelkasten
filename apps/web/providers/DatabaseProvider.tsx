'use client';

import { useEffect, useState } from 'react';
import { ZettelRepository } from '@zettelkasten/db-web';
import { ZettelController } from '@zettelkasten/core';
import type { Link } from '@zettelkasten/core';
import { useZettelStore } from '../store/useZettelStore';
import { useAuth } from './AuthProvider';
import { syncService } from '../lib/sync';
import { api } from '../lib/api';
import { useSyncStore } from '../store/useSyncStore';
import { triggerGraphLayoutWorker } from '../lib/triggerGraphLayout';
import { uploadPending, prefetchImages } from '../lib/imageSync';
const repo = new ZettelRepository();
const controller = new ZettelController(repo);

// The cache name must match the constant in worker/index.ts.
const ROUTES_CACHE = 'zettelkasten-routes-v1';

// Pre-cache every zettel route so the full knowledge base is available offline.
// Uses the Cache API directly from the page context (no SW round-trip needed),
// which makes it simpler and lets callers await completion if desired.
//
// Runs fire-and-forget after every sync so the user doesn't wait for it.
// Skips routes already in cache; ignores network errors (offline, etc.).
function cacheZettelRoutes() {
  if (!('caches' in window)) return;
  const routes = useZettelStore.getState().zettels.map((z) => `/zettel/${z.id}`);
  if (routes.length === 0) return;

  void (async () => {
    try {
      const cache = await caches.open(ROUTES_CACHE);
      const BATCH = 5;
      for (let i = 0; i < routes.length; i += BATCH) {
        await Promise.all(
          routes.slice(i, i + BATCH).map(async (route) => {
            if (await cache.match(route)) return; // already cached
            try {
              const res = await fetch(route);
              if (res.ok) await cache.put(route, res);
            } catch {
              // offline or fetch error — ignore
            }
          }),
        );
      }
    } catch {
      // caches.open() failed (private browsing, quota exceeded) — ignore
    }
  })();
}

// Pull zettels from server + sync links table from server
async function pullAll() {
  await syncService.pull(
    (id) => repo.findById(id),
    (z) => repo.update(z),
    (id) => repo.delete(id),
  );

  // Sync links — pull bypasses _syncLinks(), so we replace the whole table
  const res = await api.get('/api/links');
  if (res.ok) {
    const serverLinks: { source_id: string; target_id: string; type?: string }[] = await res.json();
    const links: Link[] = serverLinks.map((l) =>
      l.type === 'parent-ref'
        ? { sourceId: l.source_id, targetId: l.target_id, type: 'parent-ref' }
        : { sourceId: l.source_id, targetId: l.target_id },
    );
    await repo.replaceAllLinks(links);
  }
}

export function DatabaseProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const { setController, loadAll, setGraphExcludedTags, setGraphNodeColors } = useZettelStore();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const setStatus = useSyncStore((s) => s.setStatus);
  const setSyncNow = useSyncStore((s) => s.setSyncNow);

  // Wire sync service status updates to Zustand
  useEffect(() => {
    return syncService.subscribe(setStatus);
  }, [setStatus]);

  useEffect(() => {
    // Wait for auth check to complete before initialising
    if (authLoading) return;

    // Request persistent storage so iOS doesn't evict IndexedDB under storage pressure
    if ('storage' in navigator && 'persist' in navigator.storage) {
      navigator.storage.persist();
    }

    setController(controller);
    loadAll().then(async () => {
      setReady(true);

      if (!isAuthenticated) return;

      // Load user settings (graph excluded tags, etc.)
      api.get('/api/auth/settings')
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (Array.isArray(data?.graph_excluded_tags)) {
            setGraphExcludedTags(data.graph_excluded_tags);
          }
          if (Array.isArray(data?.graph_node_colors)) {
            setGraphNodeColors(data.graph_node_colors);
          }
        })
        .catch(() => {});

      try {
        // 1. Drain any writes queued while offline (zettels + imagens).
        //    A fila de imagens vive no IndexedDB, não no localStorage: o
        //    zettel_sync_queue é string-only e estouraria com bytes.
        await syncService.drainQueue();
        void uploadPending();

        // 2. Push local IndexedDB data to server if this is the first sync ever
        //    (handles V1 → V2 migration for existing users)
        const migrated = await syncService.migrateIfNeeded(() => repo.findAll());

        // 3. If migration ran, rebuild all links server-side before pulling.
        //    Zettels were sent one-by-one so syncLinks ran with only partial data available
        //    (a link A→B is only created if B already existed when A was processed).
        //    Now that all zettels exist, a full rebuild resolves every wiki link correctly.
        if (migrated) {
          await api.post('/api/zettels/rebuild-links', {});
        }

        // 4. Pull server changes + links
        await pullAll();

        // 5. Refresh in-memory state with merged data
        await loadAll();
        cacheZettelRoutes();
        void prefetchImages();
        triggerGraphLayoutWorker();

        // Register manual sync trigger for UI button
        setSyncNow(async () => {
          try {
            await pullAll();
            await loadAll();
            cacheZettelRoutes();
            void prefetchImages();
            triggerGraphLayoutWorker();
          } catch {
            // Network/auth errors are non-fatal — AuthError already redirects to /login
          }
        });
      } catch {
        // Network/auth errors during init are non-fatal — AuthError already redirects to /login
        // Other errors (e.g. server down) will be retried on next visibility change
      }
    });

    // Reconnect handler: drain queue when coming back online
    const onOnline = () => {
      if (isAuthenticated) {
        syncService.drainQueue().then(() => loadAll()).catch(() => {});
        void uploadPending();
      }
    };
    window.addEventListener('online', onOnline);

    // Visibility handler: pull when user returns to the app (cross-device sync)
    const onVisible = () => {
      if (isAuthenticated && document.visibilityState === 'visible') {
        pullAll()
          .then(() => loadAll())
          .then(() => { cacheZettelRoutes(); void prefetchImages(); triggerGraphLayoutWorker(); })
          .catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    // SW update handler: when a new SW activates after a deploy it clears
    // ROUTES_CACHE (to prevent serving stale HTML with old JS bundle hashes).
    // Re-cache routes immediately so offline navigation keeps working without
    // requiring the user to manually reload.
    const onControllerChange = () => {
      if (isAuthenticated) cacheZettelRoutes();
    };
    navigator.serviceWorker?.addEventListener('controllerchange', onControllerChange);

    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      navigator.serviceWorker?.removeEventListener('controllerchange', onControllerChange);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isAuthenticated]);

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      </div>
    );
  }

  return <>{children}</>;
}
