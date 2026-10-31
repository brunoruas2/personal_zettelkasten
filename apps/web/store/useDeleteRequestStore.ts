'use client';

import { create } from 'zustand';

/** Pedido de exclusão do ZK//OS: o `Levels` mostra a confirmação do id pedido. */
export const useDeleteRequestStore = create<{
  id: string | null;
  request: (id: string) => void;
  clear: () => void;
}>((set) => ({
  id: null,
  request: (id) => set({ id }),
  clear: () => set({ id: null }),
}));
