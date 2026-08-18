import { create } from 'zustand'
import type { SyncStatus } from '../lib/sync'

interface SyncStore {
  status: SyncStatus
  setStatus: (s: SyncStatus) => void
  syncNow: (() => Promise<void>) | null
  setSyncNow: (fn: () => Promise<void>) => void
}

export const useSyncStore = create<SyncStore>((set) => ({
  status: 'idle',
  setStatus: (status) => set({ status }),
  syncNow: null,
  setSyncNow: (fn) => set({ syncNow: fn }),
}))
