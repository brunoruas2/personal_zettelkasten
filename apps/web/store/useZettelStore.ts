'use client';

import { create } from 'zustand';
import type { Zettel, ZettelMeta, Link } from '@zettelkasten/core';
import type { ZettelController } from '@zettelkasten/core';
import { syncService } from '../lib/sync'
import { searchZettels } from '../lib/searchZettels';
import { getNodeColorRules, saveNodeColorRules, type NodeColorRule } from '../lib/graphColors';
import { placeMissingAndQueue, positionStore, setManualPosition } from '../lib/positionSync';
import { downloadBodies } from '../lib/bodySync';
import { clearBodyCache, invalidateBody, setCachedBody } from '../lib/bodyCache';

interface ZettelStore {
  /** Índice: metadados de todos os zettels, sem corpo (ver lib/bodyCache). */
  zettels: ZettelMeta[];
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
  /** `position`: lugar escolhido na galáxia (gravado como manual antes do posicionamento automático). */
  createZettel: (
    data: Pick<Zettel, 'title' | 'body' | 'tags'>,
    opts?: { position?: { x: number; y: number } },
  ) => Promise<Zettel>;
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
      const zettels = await searchZettels(controller, query);
      set({ zettels, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  createZettel: async (data, opts) => {
    const { controller, loadAll } = get();
    if (!controller) throw new Error('Controller not initialized');
    const zettel = await controller.create(data);
    setCachedBody(zettel.id, zettel.body, zettel.bodyLen);
    // Antes do placeMissingAndQueue: com a posição já gravada, o automático
    // não mexe nela.
    if (opts?.position) await setManualPosition(zettel.id, opts.position.x, opts.position.y);
    await loadAll();
    // Vaga na galáxia perto dos vizinhos de link — vale offline (fica pendente).
    void placeMissingAndQueue(controller);
    // Push to server in background — enqueued if offline
    syncService.push({ op: 'create', payload: zettel }).catch(() => {});
    return zettel;
  },

  updateZettel: async (id, data) => {
    const { controller, loadAll } = get();
    if (!controller) throw new Error('Controller not initialized');
    // Da base, não da lista global: a busca da sidebar substitui a lista.
    const existing = await controller.getById(id);
    const zettel = await controller.update(id, data);
    setCachedBody(zettel.id, zettel.body, zettel.bodyLen);
    syncService.push({ op: 'update', payload: zettel }).catch(() => {});
    // Título anterior vazio (zettel recém-criado): nenhum `[[ ]]` aponta para ele.
    if (data.title !== undefined && existing && existing.title.trim() !== '' && data.title !== existing.title) {
      // Corpos desatualizados não são reescritos (apagaria a versão de outro
      // aparelho): com rede, baixa-os antes para a reescrita alcançar todos.
      if (navigator.onLine) await downloadBodies().catch(() => {});
      const { rewritten, skippedStale } = await controller.rewriteLinks(existing.title, data.title, id);
      for (const z of rewritten) {
        invalidateBody(z.id);
        syncService.push({ op: 'update', payload: z }).catch(() => {});
      }
      if (skippedStale.length > 0) {
        console.warn(`[rename] ${skippedStale.length} zettel(s) com corpo desatualizado não tiveram [[${existing.title}]] reescrito`);
      }
    }
    await loadAll();
    return zettel;
  },

  deleteZettel: async (id) => {
    const { controller, loadAll } = get();
    if (!controller) throw new Error('Controller not initialized');
    await controller.delete(id);
    await positionStore.delete(id);
    invalidateBody(id);
    await loadAll();
    syncService.push({ op: 'delete', payload: { id } }).catch(() => {});
  },

  clearAll: async () => {
    const { controller } = get();
    if (controller) await controller.clearAll();
    clearBodyCache();
    set({ zettels: [] });
  },
}));
