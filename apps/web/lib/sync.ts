import { api, AuthError } from './api'
import type { Zettel } from '@zettelkasten/core'

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error'

interface ServerZettel {
  id: string
  user_id: string
  title: string
  body: string
  tags: string[]
  created_at: number
  updated_at: number
  deleted_at: number | null
}

type SyncOp =
  | { op: 'create'; payload: Zettel }
  | { op: 'update'; payload: Zettel }
  | { op: 'delete'; payload: { id: string } }

const QUEUE_KEY = 'zettel_sync_queue'
const LAST_SYNC_KEY = 'zettel_last_sync_at'

export function serverZettelToLocal(z: ServerZettel): Zettel {
  return {
    id: z.id,
    title: z.title,
    body: z.body,
    tags: z.tags ?? [],
    createdAt: z.created_at,
    updatedAt: z.updated_at,
  }
}

class SyncService {
  private listeners: Set<(s: SyncStatus) => void> = new Set()
  private _status: SyncStatus = 'idle'

  get status(): SyncStatus {
    return this._status
  }

  subscribe(cb: (s: SyncStatus) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private setStatus(s: SyncStatus) {
    this._status = s
    this.listeners.forEach((cb) => cb(s))
  }

  // --- Offline queue (localStorage) ---

  private getQueue(): SyncOp[] {
    try {
      return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]')
    } catch {
      return []
    }
  }

  private saveQueue(q: SyncOp[]) {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q))
  }

  private enqueue(op: SyncOp) {
    const q = this.getQueue()
    q.push(op)
    this.saveQueue(q)
  }

  // --- Push: local write → server (fire-and-forget from store) ---

  async push(op: SyncOp): Promise<void> {
    if (!navigator.onLine) {
      this.enqueue(op)
      this.setStatus('offline')
      return
    }
    try {
      await this.sendOp(op)
    } catch (err) {
      if (err instanceof AuthError) throw err
      this.enqueue(op)
      this.setStatus('offline')
    }
  }

  private async sendOp(op: SyncOp): Promise<void> {
    let res: Response

    if (op.op === 'create') {
      const z = op.payload
      res = await api.post('/api/zettels', {
        id: z.id,
        title: z.title,
        body: z.body,
        tags: z.tags,
        created_at: z.createdAt,
        updated_at: z.updatedAt,
      })
    } else if (op.op === 'update') {
      const z = op.payload
      res = await api.put(`/api/zettels/${z.id}`, {
        title: z.title,
        body: z.body,
        tags: z.tags,
        updated_at: z.updatedAt,
      })
      if (res.status === 404) return // deleted on server — ignore
    } else {
      res = await api.delete(`/api/zettels/${op.payload.id}`)
      if (res.status === 404) return // already gone — ignore
    }

    if (!res.ok) throw new Error(`API ${res.status}`)
  }

  // Drain pending offline queue when connection is restored
  async drainQueue(): Promise<void> {
    const queue = this.getQueue()
    if (queue.length === 0) return

    this.setStatus('syncing')
    const remaining: SyncOp[] = []
    for (const op of queue) {
      try {
        await this.sendOp(op)
      } catch (err) {
        if (err instanceof AuthError) {
          this.setStatus('error')
          return
        }
        remaining.push(op)
      }
    }
    this.saveQueue(remaining)
    this.setStatus(remaining.length === 0 ? 'synced' : 'error')
  }

  // --- Pull: server → local (delta by updated_at) ---
  //
  // Strategy: server wins when server.updatedAt > local.updatedAt
  // (local offline edits are preserved when they're newer)

  async pull(
    getLocalFn: (id: string) => Promise<Zettel | null>,
    upsertFn: (z: Zettel) => Promise<void>,
    deleteFn: (id: string) => Promise<void>,
  ): Promise<void> {
    const since = Number(localStorage.getItem(LAST_SYNC_KEY) ?? '0')
    this.setStatus('syncing')

    try {
      const res = await api.get(`/api/zettels?since=${since}`)
      if (!res.ok) {
        this.setStatus('error')
        return
      }

      const serverZettels: ServerZettel[] = await res.json()

      for (const sz of serverZettels) {
        if (sz.deleted_at != null) {
          await deleteFn(sz.id)
        } else {
          const local = await getLocalFn(sz.id)
          // Only overwrite if server version is strictly newer than local
          if (!local || sz.updated_at > local.updatedAt) {
            await upsertFn(serverZettelToLocal(sz))
          }
        }
      }

      localStorage.setItem(LAST_SYNC_KEY, String(Date.now()))
      this.setStatus('synced')
    } catch (err) {
      if (err instanceof AuthError) return
      this.setStatus(navigator.onLine ? 'error' : 'offline')
    }
  }

  // --- First-time migration: push all existing IndexedDB data to server ---
  // Called on first login. Skipped on subsequent sessions (LAST_SYNC_KEY is set).

  // Returns true if migration actually ran (i.e. there were local zettels to upload).
  async migrateIfNeeded(getAllFn: () => Promise<Zettel[]>): Promise<boolean> {
    if (localStorage.getItem(LAST_SYNC_KEY) !== null) return false

    const zettels = await getAllFn()
    if (zettels.length === 0) {
      localStorage.setItem(LAST_SYNC_KEY, '0')
      return false
    }

    this.setStatus('syncing')
    const failed: Zettel[] = []

    for (const z of zettels) {
      try {
        await this.sendOp({ op: 'create', payload: z })
      } catch (err) {
        if (err instanceof AuthError) return false
        failed.push(z)
      }
    }

    if (failed.length === 0) {
      localStorage.setItem(LAST_SYNC_KEY, String(Date.now()))
      this.setStatus('synced')
    } else {
      // Queue the ones that failed; mark sync timestamp as 0 so next pull fetches everything
      failed.forEach((z) => this.enqueue({ op: 'create', payload: z }))
      localStorage.setItem(LAST_SYNC_KEY, '0')
      this.setStatus('error')
    }

    return true
  }
}

export const syncService = new SyncService()
