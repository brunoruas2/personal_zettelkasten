'use client';

import { create } from 'zustand';

/** Pedido de exportação PDF do ZK//OS: o `Levels` mostra o modal de escopo do id pedido. */
export const useExportRequestStore = create<{
  id: string | null;
  request: (id: string) => void;
  clear: () => void;
}>((set) => ({
  id: null,
  request: (id) => set({ id }),
  clear: () => set({ id: null }),
}));
