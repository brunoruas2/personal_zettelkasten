'use client';

import { create } from 'zustand';
import type { ReviewController, ReviewGrade, ReviewState } from '@zettelkasten/core';
import { DEFAULT_NEW_PER_DAY } from '@zettelkasten/core';
import { pushReview } from '../lib/reviewSync';

interface ReviewStoreState {
  /** Estado por zettelId. Ausência de chave = nunca revisado. */
  states: Record<string, ReviewState>;
  newPerDay: number;
  isLoaded: boolean;
  controller: ReviewController | null;

  setController: (controller: ReviewController) => void;
  setNewPerDay: (n: number) => void;
  loadStates: () => Promise<void>;
  grade: (zettelId: string, grade: ReviewGrade) => Promise<void>;
  setSuspended: (zettelId: string, suspended: boolean) => Promise<void>;
}

export const useReviewStore = create<ReviewStoreState>((set, get) => ({
  states: {},
  newPerDay: DEFAULT_NEW_PER_DAY,
  isLoaded: false,
  controller: null,

  setController: (controller) => set({ controller }),
  setNewPerDay: (n) => set({ newPerDay: n }),

  loadStates: async () => {
    const { controller } = get();
    if (!controller) return;
    const all = await controller.getAll();
    const states: Record<string, ReviewState> = {};
    for (const s of all) states[s.zettelId] = s;
    set({ states, isLoaded: true });
  },

  // Grava local, atualiza a UI e só então empurra para o servidor sem `await`:
  // a avaliação nunca espera a rede. Mesmo padrão de useZettelStore.createZettel.
  grade: async (zettelId, grade) => {
    const { controller } = get();
    if (!controller) return;
    const next = await controller.grade(zettelId, grade, Date.now());
    set((s) => ({ states: { ...s.states, [zettelId]: next } }));
    void pushReview(next).catch(() => {});
  },

  setSuspended: async (zettelId, suspended) => {
    const { controller } = get();
    if (!controller) return;
    const next = await controller.setSuspended(zettelId, suspended, Date.now());
    set((s) => ({ states: { ...s.states, [zettelId]: next } }));
    void pushReview(next).catch(() => {});
  },
}));
