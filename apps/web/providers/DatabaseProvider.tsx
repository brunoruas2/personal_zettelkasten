'use client';

import { useEffect, useState } from 'react';
import type { Link } from '@zettelkasten/core';
import { useZettelStore } from '../store/useZettelStore';
import { useAuth } from './AuthProvider';
import { syncService } from '../lib/sync';
import { api } from '../lib/api';
import { useSyncStore } from '../store/useSyncStore';
import { uploadPending, prefetchImages } from '../lib/imageSync';
import { uploadPendingDrawings, pullDrawings } from '../lib/drawingSync';
import {
  freezeIfNeeded,
  placeMissingAndQueue,
  positionStore,
  pullPositions,
  pushPendingPositions,
} from '../lib/positionSync';
import { repo, controller } from '../lib/repo';
import { downloadBodies, refreshBodies } from '../lib/bodySync';
import { startRealtime, type RealtimeEvent } from '../lib/realtime';
import { useAgentActivityStore, type AgentChange } from '../store/useAgentActivityStore';
import { invalidateBody } from '../lib/bodyCache';
import { deferIfDrawing } from '../lib/drawingFocus';
import { dropAssignment, pullTypesAndAssignments, pushPendingTypes } from '../lib/typeSync';
import { initTypesStore } from '../store/useTypesStore';

// Pull zettels from server + sync links table from server. Devolve se o pull
// de posições falou com o servidor — o congelamento do layout depende disso.
async function pullAll(): Promise<boolean> {
  await syncService.pull(
    (id) => repo.findById(id),
    (metas) => repo.upsertMeta(metas),
    async (id) => {
      await repo.delete(id);
      await positionStore.delete(id);
      await dropAssignment(id);
      invalidateBody(id);
    },
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

  // Desenhos: pull por manifesto (silencioso; nunca interrompe a sincronização).
  await pullDrawings();

  // Tipos e atribuições (silencioso, como os desenhos): depois dos zettels,
  // para o delete de zettel já ter levado a atribuição junto.
  await pullTypesAndAssignments();

  // Posições da galáxia: depois dos zettels, para o delete de zettel já ter
  // levado a posição junto.
  return pullPositions();
}

// Depois do pull e do loadAll: congela o layout se a conta ainda não tem
// nenhuma posição (só com o pull de posições bem-sucedido, ou seja, online),
// posiciona quem chegou sem posição e envia os pendentes.
async function syncGalaxy(positionsPulled: boolean) {
  if (positionsPulled) await freezeIfNeeded(controller);
  await placeMissingAndQueue(controller);
  await pushPendingPositions();
}

// Tempo real: um lote de eventos de GET /api/events vira um ciclo de
// sincronização (o pull continua sendo a fonte da verdade — o evento só
// antecipa o gatilho). Os corpos dos ids citados vêm antes da varredura geral,
// e o que o agente mexeu vai para o destaque/toast. Ciclos em série.
let realtimeChain: Promise<void> = Promise.resolve();

function runRealtimeCycle(events: RealtimeEvent[], loadAll: () => Promise<void>): Promise<void> {
  realtimeChain = realtimeChain.then(async () => {
    const titleOf = (list: { id: string; title: string }[]) => new Map(list.map((z) => [z.id, z.title]));
    const before = titleOf(useZettelStore.getState().zettels);
    const pulled = await pullAll();
    await loadAll();

    const zettelEvents = events.filter((e) => e.kind === 'zettel');
    const upserted = [...new Set(zettelEvents.filter((e) => e.op === 'upsert').flatMap((e) => e.ids ?? []))];
    await refreshBodies(upserted).catch(() => {});
    void prefetchImages();
    void syncGalaxy(pulled).catch(() => {});
    void downloadBodies().catch(() => {});

    const after = titleOf(useZettelStore.getState().zettels);
    const changes: AgentChange[] = [];
    for (const e of zettelEvents) {
      if (e.source !== 'agent') continue;
      for (const id of e.ids ?? []) {
        if (e.op === 'delete') changes.push({ id, op: 'delete', title: before.get(id) ?? '' });
        else changes.push({ id, op: before.has(id) ? 'update' : 'create', title: after.get(id) ?? '' });
      }
    }
    useAgentActivityStore.getState().record(changes);
  }).catch(() => {});
  return realtimeChain;
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

    // Fila offline da revisão espaçada, removida do app. Apagada no boot, e não
    // só no logout, para não sobrar em dispositivo que nunca desloga.
    try {
      localStorage.removeItem('zettel_review_queue');
    } catch {
      // localStorage indisponível (modo privado, bloqueio) — nada a limpar.
    }

    setController(controller);
    const stopTypes = initTypesStore();
    let disposed = false;
    let stopRealtime: (() => void) | null = null;
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
        void uploadPendingDrawings();
        void pushPendingPositions();
        void pushPendingTypes().catch(() => {});

        // 2. Push local IndexedDB data to server if this is the first sync ever
        //    (handles V1 → V2 migration for existing users)
        const migrated = await syncService.migrateIfNeeded(controller);

        // 3. If migration ran, rebuild all links server-side before pulling.
        //    Zettels were sent one-by-one so syncLinks ran with only partial data available
        //    (a link A→B is only created if B already existed when A was processed).
        //    Now that all zettels exist, a full rebuild resolves every wiki link correctly.
        if (migrated) {
          await api.post('/api/zettels/rebuild-links', {});
        }

        // 4. Pull server changes + links
        const positionsPulled = await pullAll();

        // 5. Refresh in-memory state with merged data
        await loadAll();
        void prefetchImages();
        void syncGalaxy(positionsPulled).catch(() => {});
        void downloadBodies().catch(() => {});

        // Register manual sync trigger for UI button
        const runSync = async () => {
          try {
            const pulled = await pullAll();
            await loadAll();
            void prefetchImages();
            void syncGalaxy(pulled).catch(() => {});
            void downloadBodies().catch(() => {});
          } catch {
            // Network/auth errors are non-fatal — AuthError already redirects to /login
          }
        };
        // Com o editor de desenho aberto, adia para o fechamento (modo desenho).
        setSyncNow(async () => deferIfDrawing('sync-now', () => void runSync()));

        // Tempo real: só depois da primeira sincronização. Queda + volta com a
        // aba visível = ciclo completo (pode ter perdido eventos).
        if (!disposed) {
          stopRealtime = startRealtime({
            onBatch: (events, reconnected) => {
              deferIfDrawing('realtime', () => {
                const full = reconnected || events.some((e) => e.kind === 'resync');
                const list = full ? events.filter((e) => e.kind !== 'resync') : events;
                // Só mudou tipo ou nível: puxa tipos e atribuições, sem refazer
                // o pull de zettels nem baixar corpos.
                if (!full && list.length > 0 && list.every((e) => e.kind === 'type')) {
                  void pullTypesAndAssignments().catch(() => {});
                  return;
                }
                void runRealtimeCycle(list, loadAll);
              });
            },
          });
        }
      } catch {
        // Network/auth errors during init are non-fatal — AuthError already redirects to /login
        // Other errors (e.g. server down) will be retried on next visibility change
      }
    });

    // Reconnect handler: drain queue when coming back online
    const onOnline = () => {
      if (!isAuthenticated) return;
      // Modo desenho: espera o editor de desenho fechar.
      deferIfDrawing('online-cycle', () => {
        syncService.drainQueue().then(() => loadAll()).catch(() => {});
        void uploadPending();
        void uploadPendingDrawings();
        void pushPendingPositions().catch(() => {});
        void pushPendingTypes().catch(() => {});
        void downloadBodies().catch(() => {});
      });
    };
    window.addEventListener('online', onOnline);

    // Visibility handler: pull when user returns to the app (cross-device sync)
    const onVisible = () => {
      if (!isAuthenticated || document.visibilityState !== 'visible') return;
      // Modo desenho: espera o editor de desenho fechar.
      deferIfDrawing('visible-cycle', () => {
        pullAll()
          .then(async (pulled) => {
            await loadAll();
            void prefetchImages();
            void syncGalaxy(pulled).catch(() => {});
            void downloadBodies().catch(() => {});
          })
          .catch(() => {});
      });
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      disposed = true;
      stopTypes();
      stopRealtime?.();
      useAgentActivityStore.getState().clear();
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
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
