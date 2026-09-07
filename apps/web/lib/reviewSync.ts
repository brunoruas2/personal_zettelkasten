import { api, AuthError } from './api'
import type { ReviewState } from '@zettelkasten/core'
import type { ReviewStore } from '@zettelkasten/db-web'

interface ServerReview {
  zettel_id: string
  due_at: number
  interval_days: number
  ease: number
  reps: number
  lapses: number
  last_reviewed_at: number
  suspended: boolean
  updated_at: number
}

/**
 * Fila offline de avaliações. É um objeto indexado por zettelId, não um array:
 * avaliar o mesmo zettel três vezes sem rede deixa uma entrada com o estado mais
 * recente, e não três envios em sequência. O `zettel_sync_queue` é o oposto —
 * log de operações, em que a ordem importa.
 *
 * Colapsar é seguro porque o endpoint é upsert idempotente com last-write-wins
 * resolvido no SQL do servidor.
 */
const REVIEW_QUEUE_KEY = 'zettel_review_queue'

type ReviewQueueMap = Record<string, ReviewState>

function serverToLocal(r: ServerReview): ReviewState {
  return {
    zettelId: r.zettel_id,
    dueAt: r.due_at,
    intervalDays: r.interval_days,
    ease: r.ease,
    reps: r.reps,
    lapses: r.lapses,
    lastReviewedAt: r.last_reviewed_at,
    suspended: !!r.suspended,
    updatedAt: r.updated_at,
  }
}

function localToBody(state: ReviewState) {
  return {
    due_at: state.dueAt,
    interval_days: state.intervalDays,
    ease: state.ease,
    reps: state.reps,
    lapses: state.lapses,
    last_reviewed_at: state.lastReviewedAt,
    suspended: state.suspended,
    updated_at: state.updatedAt,
  }
}

function getQueue(): ReviewQueueMap {
  try {
    return JSON.parse(localStorage.getItem(REVIEW_QUEUE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function saveQueue(q: ReviewQueueMap) {
  try {
    localStorage.setItem(REVIEW_QUEUE_KEY, JSON.stringify(q))
  } catch {
    // Sem espaço: a avaliação já está no IndexedDB, então o pior caso é o
    // servidor ficar para trás até a próxima avaliação do mesmo zettel.
  }
}

function enqueue(state: ReviewState) {
  const q = getQueue()
  q[state.zettelId] = state
  saveQueue(q)
}

export function clearReviewQueue() {
  try {
    localStorage.removeItem(REVIEW_QUEUE_KEY)
  } catch {
    // ignore
  }
}

async function send(state: ReviewState): Promise<void> {
  const res = await api.put(`/api/reviews/${state.zettelId}`, localToBody(state))
  // Um 404 aqui significa servidor antigo, sem as rotas de revisão: tratar como
  // falha mantém a avaliação na fila até o servidor subir de versão.
  if (!res.ok) throw new Error(`review push failed: ${res.status}`)
}

/** Envia uma avaliação; guarda na fila se falhar ou se estiver offline. */
export async function pushReview(state: ReviewState): Promise<void> {
  if (!navigator.onLine) {
    enqueue(state)
    return
  }
  try {
    await send(state)
  } catch (err) {
    if (err instanceof AuthError) throw err
    enqueue(state)
  }
}

/** Esvazia a fila. Uma entrada só sai depois de o servidor confirmar. */
export async function drainReviewQueue(): Promise<void> {
  const q = getQueue()
  const ids = Object.keys(q)
  if (ids.length === 0) return

  for (const id of ids) {
    try {
      await send(q[id])
      delete q[id]
    } catch (err) {
      if (err instanceof AuthError) throw err
      break // rede caiu de novo: o resto fica para a próxima
    }
  }
  saveQueue(q)
}

/**
 * Traz os estados do servidor e mescla com os locais, prevalecendo o mais
 * recente. Roda dentro do `pullAll()`, junto do sync integral dos links.
 */
export async function pullReviews(store: ReviewStore): Promise<void> {
  const res = await api.get('/api/reviews')
  if (!res.ok) return
  const remote: ServerReview[] = await res.json()
  if (!Array.isArray(remote)) return

  const local = new Map((await store.findAll()).map((s) => [s.zettelId, s]))
  const toWrite: ReviewState[] = []

  for (const raw of remote) {
    const incoming = serverToLocal(raw)
    const current = local.get(incoming.zettelId)
    if (!current || incoming.updatedAt > current.updatedAt) {
      toWrite.push(incoming)
    }
  }

  if (toWrite.length > 0) await store.putMany(toWrite)
}
