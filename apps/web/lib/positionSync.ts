import { PositionStore } from '@zettelkasten/db-web'
import {
  placeMissing,
  type Link,
  type Point,
  type PositionRecord,
  type ServerPosition,
  type ZettelMeta,
} from '@zettelkasten/core'
import { api, AuthError } from './api'

export const positionStore = new PositionStore()

const SINCE_KEY = 'zettel_positions_since'
const EPOCH_KEY = 'zettel_galaxy_epoch'
const PUSH_BATCH = 2000

// Avisa a UI (contagem em Settings) quando as posições locais mudam.
const listeners = new Set<() => void>()

export function subscribePositions(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emitChanged(): void {
  listeners.forEach((l) => l())
}

/** De onde vêm zettels e links — o `ZettelController` satisfaz. */
export interface GalaxySource {
  getAll(): Promise<ZettelMeta[]>
  getAllLinks(): Promise<Link[]>
}

function readNum(key: string): number | null {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

function writeNum(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    // localStorage indisponível — o próximo pull só traz mais do que precisa.
  }
}

function removeKey(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // nada a limpar
  }
}

/** Chaves de `localStorage` das posições — o logout as remove. */
export const POSITION_STORAGE_KEYS = [SINCE_KEY, EPOCH_KEY]

const synced = (id: string, x: number, y: number, updatedAt: number): PositionRecord => ({
  id,
  x,
  y,
  updatedAt,
  syncState: 'synced',
  mode: 'lww',
})

/**
 * Alinha a época de layout local com a do servidor. Época diferente = alguém
 * recalculou o layout: as posições locais são descartadas e o cursor do delta
 * zera. Devolve se houve descarte.
 */
export async function ensureEpoch(epoch: number): Promise<boolean> {
  const seen = readNum(EPOCH_KEY)
  writeNum(EPOCH_KEY, epoch)
  if (seen === null || seen === epoch) return false
  await positionStore.clear()
  removeKey(SINCE_KEY)
  emitChanged()
  return true
}

/**
 * Pull delta de posições. O servidor vence quando é estritamente mais novo; um
 * `pending` local mais novo fica e será reenviado. Devolve `false` se não deu
 * para falar com o servidor.
 */
export async function pullPositions(): Promise<boolean> {
  try {
    let since = readNum(SINCE_KEY) ?? 0
    // IndexedDB apagado (evicção, limpeza manual) com o cursor sobrevivendo no
    // localStorage: o delta nunca traria o que já foi baixado antes.
    if (since > 0 && (await positionStore.count()) === 0) since = 0

    let res = await api.get(`/api/positions?since=${since}`)
    if (!res.ok) return false
    let data: { positions: ServerPosition[]; epoch: number; server_time: number } = await res.json()

    if (await ensureEpoch(data.epoch)) {
      res = await api.get('/api/positions?since=0')
      if (!res.ok) return false
      data = await res.json()
    }

    if (data.positions.length > 0) {
      const local = new Map((await positionStore.getAll()).map((r) => [r.id, r]))
      const next: PositionRecord[] = []
      for (const p of data.positions) {
        const cur = local.get(p.id)
        if (cur && cur.syncState === 'pending' && cur.updatedAt >= p.updated_at) continue
        if (cur && cur.syncState === 'synced' && cur.updatedAt === p.updated_at && cur.x === p.x && cur.y === p.y) continue
        if (cur && cur.updatedAt > p.updated_at) continue
        next.push(synced(p.id, p.x, p.y, p.updated_at))
      }
      await positionStore.putMany(next)
      if (next.length > 0) emitChanged()
    }
    writeNum(SINCE_KEY, data.server_time)
    return true
  } catch (err) {
    if (err instanceof AuthError) throw err
    return false
  }
}

let pushing: Promise<void> | null = null

/**
 * Envia as posições pendentes, agrupadas por modo. `kept` = o servidor manteve
 * outra posição (só-se-ausente com conflito, ou LWW mais antigo): o cliente a
 * adota. `skipped` = o zettel ainda não chegou ao servidor (sobe por outra
 * fila): fica pendente para a próxima rodada. Falha de rede ou 5xx também
 * deixa tudo pendente.
 */
export function pushPendingPositions(): Promise<void> {
  if (!pushing) {
    pushing = doPush().finally(() => {
      pushing = null
    })
  }
  return pushing
}

async function doPush(): Promise<void> {
  try {
    const pending = await positionStore.listPending()
    for (const mode of ['if_absent', 'lww'] as const) {
      const ofMode = pending.filter((r) => r.mode === mode)
      for (let i = 0; i < ofMode.length; i += PUSH_BATCH) {
        const chunk = ofMode.slice(i, i + PUSH_BATCH)
        const res = await api.put('/api/positions', {
          mode,
          positions: chunk.map((r) => ({ id: r.id, x: r.x, y: r.y, updated_at: r.updatedAt })),
        })
        if (!res.ok) return
        const body: { kept: ServerPosition[]; skipped: string[] } = await res.json()
        const kept = new Map(body.kept.map((p) => [p.id, p]))
        const skipped = new Set(body.skipped)
        for (const r of chunk) {
          if (skipped.has(r.id)) continue
          const k = kept.get(r.id)
          if (k) await positionStore.replaceIfUnchanged(r.updatedAt, synced(k.id, k.x, k.y, k.updated_at))
          else await positionStore.markSynced(r.id, r.updatedAt)
        }
      }
    }
  } catch (err) {
    if (err instanceof AuthError) throw err
    // rede — fica pendente
  }
}

function runLayoutWorker(ids: string[], links: Link[]): Promise<[string, number, number][]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/galaxyLayout.worker.ts', import.meta.url))
    worker.onmessage = (e: MessageEvent<{ positions: [string, number, number][] }>) => {
      worker.terminate()
      resolve(e.data.positions)
    }
    worker.onerror = (e) => {
      worker.terminate()
      reject(e)
    }
    worker.postMessage({ ids, links })
  })
}

let freezing: Promise<void> | null = null

/**
 * Congela o layout inicial: calcula num Worker e envia tudo de uma vez. O
 * servidor só aceita se a conta ainda não tem nenhuma posição; no 409 outro
 * dispositivo chegou antes, e as posições dele vêm pelo pull.
 */
export function freezeAndInit(source: GalaxySource): Promise<void> {
  if (!freezing) {
    freezing = doFreeze(source).finally(() => {
      freezing = null
    })
  }
  return freezing
}

async function doFreeze(source: GalaxySource): Promise<void> {
  const [zettels, links] = await Promise.all([source.getAll(), source.getAllLinks()])
  if (zettels.length === 0) return
  const computed = await runLayoutWorker(zettels.map((z) => z.id), links)
  const now = Date.now()
  const res = await api.post('/api/positions/init', {
    positions: computed.map(([id, x, y]) => ({ id, x, y, updated_at: now })),
  })
  if (res.status === 409) {
    removeKey(SINCE_KEY)
    await pullPositions()
    return
  }
  if (!res.ok) return
  await positionStore.putMany(computed.map(([id, x, y]) => synced(id, x, y, now)))
  emitChanged()
}

/**
 * Condição do congelamento: online, com zettels, sem nenhuma posição local
 * depois de um pull bem-sucedido (o pull já trouxe as do servidor, se houver).
 */
export async function freezeIfNeeded(source: GalaxySource): Promise<void> {
  if ((await positionStore.count()) > 0) return
  await freezeAndInit(source)
}

let placing: Promise<void> = Promise.resolve()

/**
 * Posiciona os zettels sem posição perto dos vizinhos de link e os envia como
 * só-se-ausente. Só depois que existe um layout congelado (alguma posição
 * local); antes disso quem cuida é o congelamento. Serializado: duas chamadas
 * concorrentes leriam o mesmo estado e posicionariam o mesmo zettel duas vezes.
 */
export function placeMissingAndQueue(source: GalaxySource): Promise<void> {
  placing = placing.then(() => doPlace(source)).catch(() => {})
  return placing
}

async function doPlace(source: GalaxySource): Promise<void> {
  if ((await positionStore.count()) === 0) return
  const [zettels, links, records] = await Promise.all([
    source.getAll(),
    source.getAllLinks(),
    positionStore.getAll(),
  ])
  const positions = new Map<string, Point>(records.map((r) => [r.id, { x: r.x, y: r.y }]))
  const placed = placeMissing(zettels, links, positions)
  if (placed.size === 0) return
  const now = Date.now()
  await positionStore.putMany(
    [...placed].map(([id, p]) => ({ id, x: p.x, y: p.y, updatedAt: now, syncState: 'pending', mode: 'if_absent' })),
  )
  emitChanged()
  void pushPendingPositions()
}

/** Recalcular layout: descarta tudo no servidor, avança a época e congela de novo. */
export async function resetGalaxyLayout(source: GalaxySource): Promise<void> {
  const res = await api.delete('/api/positions')
  if (!res.ok) throw new Error('Não foi possível recalcular o layout.')
  const { epoch }: { epoch: number } = await res.json()
  await ensureEpoch(epoch)
  // ensureEpoch só descarta se já conhecia outra época; aqui o descarte é certo.
  await positionStore.clear()
  removeKey(SINCE_KEY)
  await freezeAndInit(source)
}

/**
 * Posição escolhida pelo usuário (mover um card, criar num lugar): grava como
 * `lww` — vence o posicionamento automático (`if_absent`) e é a última escrita
 * que vale entre aparelhos. `updatedAt` estritamente maior que o anterior,
 * senão o servidor ignoraria a mudança.
 */
export async function setManualPosition(id: string, x: number, y: number): Promise<void> {
  const prev = await positionStore.get(id)
  const updatedAt = Math.max(Date.now(), (prev?.updatedAt ?? 0) + 1)
  await positionStore.putMany([
    { id, x: Math.round(x), y: Math.round(y), updatedAt, syncState: 'pending', mode: 'lww' },
  ])
  emitChanged()
  void pushPendingPositions().catch(() => {})
}
