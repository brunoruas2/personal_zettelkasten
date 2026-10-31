import { api, AuthError } from './api'
import { utf8Length, type Zettel, type ZettelMeta } from '@zettelkasten/core'

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error'

/** Zettel completo do servidor — busca FTS5 e o GET antigo. */
export interface ServerZettel {
  id: string
  user_id: string
  title: string
  body: string
  tags: string[]
  created_at: number
  updated_at: number
  deleted_at: number | null
}

/** Linha do índice (`GET /api/zettels?fields=meta`): sem corpo. */
interface ServerMeta {
  id: string
  title: string
  tags: string[]
  created_at: number
  updated_at: number
  deleted_at: number | null
  body_len: number
}

type SyncOp =
  | { op: 'create'; payload: Zettel }
  | { op: 'update'; payload: Zettel }
  | { op: 'delete'; payload: { id: string } }

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`API ${status}`)
  }
}

/** 4xx (menos 401/408/429) não melhora com retry: sai da fila. */
function isPermanent(err: unknown): boolean {
  if (!(err instanceof HttpError)) return false
  const s = err.status
  return s >= 400 && s < 500 && s !== 401 && s !== 408 && s !== 429
}

const QUEUE_KEY = 'zettel_sync_queue'
const LAST_SYNC_KEY = 'zettel_last_sync_at'

const MIGRATE_BATCH = 50

function serverMetaToLocal(m: ServerMeta): Omit<ZettelMeta, 'bodyAt'> {
  return {
    id: m.id,
    title: m.title,
    tags: m.tags ?? [],
    createdAt: m.created_at,
    updatedAt: m.updated_at,
    bodyLen: m.body_len ?? 0,
  }
}

/**
 * Resultado da busca do servidor como meta — o corpo é descartado, a lista
 * global não guarda corpos. `bodyAt: null` porque a versão local do corpo não
 * é conhecida aqui; quem abre o zettel lê a meta do Dexie.
 */
export function serverZettelToMeta(z: ServerZettel): ZettelMeta {
  return {
    id: z.id,
    title: z.title,
    tags: z.tags ?? [],
    createdAt: z.created_at,
    updatedAt: z.updated_at,
    bodyLen: utf8Length(z.body ?? ''),
    bodyAt: null,
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
      if (isPermanent(err)) {
        console.warn('[sync] operação recusada pelo servidor, descartada', op.op, err)
        return
      }
      this.enqueue(op)
      this.setStatus('offline')
    }
  }

  private createBody(z: Zettel) {
    return {
      id: z.id,
      title: z.title,
      body: z.body,
      tags: z.tags,
      created_at: z.createdAt,
      updated_at: z.updatedAt,
    }
  }

  private async sendOp(op: SyncOp): Promise<void> {
    let res: Response

    if (op.op === 'create') {
      res = await api.post('/api/zettels', this.createBody(op.payload))
    } else if (op.op === 'update') {
      const z = op.payload
      res = await api.put(`/api/zettels/${z.id}`, {
        title: z.title,
        body: z.body,
        tags: z.tags,
        updated_at: z.updatedAt,
      })
      // 404: o servidor ainda não conhece o zettel (create não passou) — cria.
      // Se foi apagado lá, o POST volta 409 e a operação é descartada.
      if (res.status === 404) res = await api.post('/api/zettels', this.createBody(z))
    } else {
      res = await api.delete(`/api/zettels/${op.payload.id}`)
      if (res.status === 404) return // already gone — ignore
    }

    if (!res.ok) throw new HttpError(res.status)
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
        if (isPermanent(err)) {
          console.warn('[sync] operação recusada pelo servidor, descartada', op.op, err)
          continue
        }
        remaining.push(op)
      }
    }
    this.saveQueue(remaining)
    this.setStatus(remaining.length === 0 ? 'synced' : 'error')
  }

  // --- Pull: server → local (delta by updated_at) ---
  //
  // Só o índice (fields=meta): os corpos vêm depois, pelo downloader de
  // `bodySync.ts`. Servidor vence quando server.updated_at > local.updatedAt
  // (edições offline mais novas são preservadas). Uma meta mais nova deixa o
  // corpo local desatualizado (bodyAt < updatedAt) sem apagá-lo: continua
  // legível offline até o novo chegar.

  async pull(
    getLocalFn: (id: string) => Promise<ZettelMeta | null>,
    upsertMetaFn: (metas: Omit<ZettelMeta, 'bodyAt'>[]) => Promise<void>,
    deleteFn: (id: string) => Promise<void>,
  ): Promise<void> {
    const since = Number(localStorage.getItem(LAST_SYNC_KEY) ?? '0')
    this.setStatus('syncing')

    try {
      const res = await api.get(`/api/zettels?since=${since}&fields=meta`)
      if (!res.ok) {
        this.setStatus('error')
        return
      }

      const serverMetas: ServerMeta[] = await res.json()
      const newer: Omit<ZettelMeta, 'bodyAt'>[] = []

      for (const sm of serverMetas) {
        if (sm.deleted_at != null) {
          await deleteFn(sm.id)
        } else {
          const local = await getLocalFn(sm.id)
          // Only overwrite if server version is strictly newer than local
          if (!local || sm.updated_at > local.updatedAt) newer.push(serverMetaToLocal(sm))
        }
      }
      await upsertMetaFn(newer)

      localStorage.setItem(LAST_SYNC_KEY, String(Date.now()))
      this.setStatus('synced')
    } catch (err) {
      if (err instanceof AuthError) return
      this.setStatus(navigator.onLine ? 'error' : 'offline')
    }
  }

  // --- First-time migration: push all existing IndexedDB data to server ---
  // Called on first login. Skipped on subsequent sessions (LAST_SYNC_KEY is set).
  // Corpos lidos em lotes por id — nunca a base inteira no heap.

  // Returns true if migration actually ran (i.e. there were local zettels to upload).
  async migrateIfNeeded(source: {
    getAll(): Promise<ZettelMeta[]>
    getBodies(ids: string[]): Promise<Map<string, string>>
  }): Promise<boolean> {
    if (localStorage.getItem(LAST_SYNC_KEY) !== null) return false

    const metas = await source.getAll()
    if (metas.length === 0) {
      localStorage.setItem(LAST_SYNC_KEY, '0')
      return false
    }

    this.setStatus('syncing')
    const failed: Zettel[] = []

    for (let i = 0; i < metas.length; i += MIGRATE_BATCH) {
      const batch = metas.slice(i, i + MIGRATE_BATCH)
      const bodies = await source.getBodies(batch.map((m) => m.id))
      for (const m of batch) {
        const z: Zettel = { ...m, body: bodies.get(m.id) ?? '' }
        try {
          await this.sendOp({ op: 'create', payload: z })
        } catch (err) {
          if (err instanceof AuthError) return false
          failed.push(z)
        }
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
