'use client';

import { create } from 'zustand';
import type { Zettel, Link } from '@zettelkasten/core';
import type { ZettelController } from '@zettelkasten/core';
import { syncService, serverZettelToLocal } from '../lib/sync'
import { api } from '../lib/api';
import { getNodeColorRules, saveNodeColorRules, type NodeColorRule } from '../lib/graphColors';
import { triggerGraphLayoutWorker } from '../lib/triggerGraphLayout';

interface ZettelStore {
  zettels: Zettel[];
  links: Link[];
  isLoading: boolean;
  controller: ZettelController | null;
  activeTag: string | null;
  graphExcludedTags: string[];
  graphNodeColors: NodeColorRule[];

  setController: (controller: ZettelController) => void;
  setActiveTag: (tag: string | null) => void;
  setGraphExcludedTags: (tags: string[]) => void;
  setGraphNodeColors: (rules: NodeColorRule[]) => void;
  loadAll: () => Promise<void>;
  search: (query: string) => Promise<void>;
  createZettel: (data: Pick<Zettel, 'title' | 'body' | 'tags'>) => Promise<Zettel>;
  updateZettel: (id: string, data: Partial<Pick<Zettel, 'title' | 'body' | 'tags'>>) => Promise<Zettel>;
  deleteZettel: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
}

export const useZettelStore = create<ZettelStore>((set, get) => ({
  zettels: [],
  links: [],
  isLoading: true,
  controller: null,
  activeTag: null,
  graphExcludedTags: [],
  graphNodeColors: getNodeColorRules(),

  setController: (controller) => set({ controller }),
  setActiveTag: (tag) => set({ activeTag: tag }),
  setGraphExcludedTags: (tags) => set({ graphExcludedTags: tags }),
  setGraphNodeColors: (rules) => {
    saveNodeColorRules(rules);
    set({ graphNodeColors: rules });
  },

  loadAll: async () => {
    const { controller } = get();
    if (!controller) return;
    set({ isLoading: true });
    try {
      const [zettels, links] = await Promise.all([
        controller.getAll(),
        controller.getAllLinks(),
      ]);
      set({ zettels, links, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  search: async (query) => {
    const { controller } = get();
    if (!controller) return;
    set({ isLoading: true });

    try {
      if (!query.trim()) {
        const zettels = await controller.getAll();
        set({ zettels, isLoading: false });
        return;
      }

      try {
        const res = await api.get(`/api/zettels?q=${encodeURIComponent(query)}`);
        if (res.ok) {
          const data = await res.json();
          set({ zettels: data.map(serverZettelToLocal), isLoading: false });
          return;
        }
      } catch {
        // offline or error — fall through to local search
      }

      const zettels = await controller.search(query);
      set({ zettels, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  createZettel: async (data) => {
    const { controller, loadAll } = get();
    if (!controller) throw new Error('Controller not initialized');
    const zettel = await controller.create(data);
    await loadAll();
    triggerGraphLayoutWorker();
    // Push to server in background — enqueued if offline
    syncService.push({ op: 'create', payload: zettel }).catch(() => {});
    return zettel;
  },

  updateZettel: async (id, data) => {
    const { controller, loadAll, zettels } = get();
    if (!controller) throw new Error('Controller not initialized');
    const existing = zettels.find((z) => z.id === id);
    const zettel = await controller.update(id, data);
    syncService.push({ op: 'update', payload: zettel }).catch(() => {});
    if (data.title !== undefined && existing && data.title !== existing.title) {
      const rewritten = await controller.rewriteLinks(existing.title, data.title, id);
      for (const z of rewritten) {
        syncService.push({ op: 'update', payload: z }).catch(() => {});
      }
    }
    await loadAll();
    return zettel;
  },

  deleteZettel: async (id) => {
    const { controller, loadAll } = get();
    if (!controller) throw new Error('Controller not initialized');
    await controller.delete(id);
    await loadAll();
    triggerGraphLayoutWorker();
    syncService.push({ op: 'delete', payload: { id } }).catch(() => {});
  },

  clearAll: async () => {
    const { controller } = get();
    if (controller) await controller.clearAll();
    set({ zettels: [] });
  },
}));
