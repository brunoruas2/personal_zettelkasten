import { DrawingStore } from '@zettelkasten/db-web'
import {
  DRAWING_LIMIT_LABEL,
  MAX_DRAWING_BYTES,
  serverDrawingToRecord,
  type DrawingManifestEntry,
  type DrawingRecord,
  type ServerDrawing,
} from '@zettelkasten/core'
import { api, AuthError } from './api'

export const drawingStore = new DrawingStore()

const PULL_BATCH = 3

export type DrawingUploadCause = 'quota' | 'too_large' | 'invalid' | 'unknown'

const UPLOAD_ERROR_MESSAGES: Record<DrawingUploadCause, string> = {
  quota: 'Sua cota de desenhos está esgotada. O desenho ficou salvo só neste aparelho.',
  too_large: `Este desenho passa de ${DRAWING_LIMIT_LABEL} e não pôde ser sincronizado. Ele ficou salvo só neste aparelho.`,
  invalid: 'O servidor não aceitou este desenho. Ele ficou salvo só neste aparelho.',
  unknown: 'Não foi possível sincronizar o desenho com o servidor. Ele ficou salvo só neste aparelho.',
}

/** Aviso de um desenho já `rejected` cuja causa não se sabe mais (ex.: ao reabrir o editor). */
export const DRAWING_REJECTED_MESSAGE = 'O servidor não aceitou este desenho. Ele está salvo só neste aparelho.'

/** Recusa permanente do servidor: re-tentar não muda o resultado. */
export class DrawingUploadError extends Error {
  readonly cause: DrawingUploadCause

  constructor(cause: DrawingUploadCause) {
    super(UPLOAD_ERROR_MESSAGES[cause])
    this.name = 'DrawingUploadError'
    this.cause = cause
  }
}

/** O desenho passa do teto e nem chega a ser gravado. */
export class DrawingTooLargeError extends Error {
  constructor() {
    super(`O desenho passa de ${DRAWING_LIMIT_LABEL}. Simplifique a cena ou divida em dois desenhos.`)
    this.name = 'DrawingTooLargeError'
  }
}

// --- "gravando" — bloqueia o salvar do zettel (mesma ideia de pendingImages) ---

let busyCount = 0
const busyListeners = new Set<() => void>()

function setBusy(delta: number): void {
  busyCount += delta
  busyListeners.forEach((l) => l())
}

export function subscribeDrawingsBusy(listener: () => void): () => void {
  busyListeners.add(listener)
  return () => busyListeners.delete(listener)
}

export function getDrawingsBusy(): boolean {
  return busyCount > 0
}

// --- mudanças — o DrawingBlock recarrega o preview quando o desenho é salvo/baixado ---

const changeListeners = new Map<string, Set<() => void>>()

export function subscribeDrawing(id: string, listener: () => void): () => void {
  let set = changeListeners.get(id)
  if (!set) {
    set = new Set()
    changeListeners.set(id, set)
  }
  set.add(listener)
  return () => {
    set.delete(listener)
    if (set.size === 0) changeListeners.delete(id)
  }
}

export function emitDrawingChanged(id: string): void {
  changeListeners.get(id)?.forEach((l) => l())
}

// --- helpers ---

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length
}

/** Estado local de um desenho vazio, recém-criado pelo `/desenho`: nada a enviar. */
export function emptyDrawingRecord(id: string, now = Date.now()): DrawingRecord {
  return {
    id,
    scene: '',
    svg: '',
    byteLen: 0,
    width: 0,
    height: 0,
    createdAt: now,
    updatedAt: now,
    syncState: 'synced',
  }
}

export interface SaveDrawingInput {
  id: string
  scene: string
  svg: string
  width: number
  height: number
}

/**
 * Grava cena e preview na mesma escrita do Dexie (nunca um sem o outro) com
 * `syncState = pending`. **Não** espera o servidor: o upload é do agendador
 * (`scheduleDrawingUpload`). Local-first — o desenho fica salvo mesmo offline.
 */
export async function saveDrawingLocal(input: SaveDrawingInput): Promise<DrawingRecord> {
  // O SVG do editor (sceneToSvg) só tem <rect> e <path>: nada a sanitizar antes de gravar.
  const svg = input.svg
  const byteLen = byteLength(input.scene) + byteLength(svg)
  if (byteLen > MAX_DRAWING_BYTES) throw new DrawingTooLargeError()

  setBusy(1)
  let record: DrawingRecord
  try {
    const prev = await drawingStore.get(input.id)
    const now = Date.now()
    record = {
      id: input.id,
      scene: input.scene,
      svg,
      byteLen,
      width: Math.round(input.width),
      height: Math.round(input.height),
      createdAt: prev?.createdAt ?? now,
      // Estritamente maior que o anterior: o servidor só aceita updated_at maior.
      updatedAt: Math.max(now, (prev?.updatedAt ?? 0) + 1),
      syncState: 'pending',
    }
    await drawingStore.put(record)
  } finally {
    setBusy(-1)
  }
  emitDrawingChanged(input.id)
  return record
}

// --- agendador de upload — no máximo um envio a cada UPLOAD_INTERVAL_MS por desenho ---

export const UPLOAD_INTERVAL_MS = 15_000

export type DrawingUploadStatus =
  | { kind: 'synced' }
  | { kind: 'pending' }
  | { kind: 'rejected'; message: string }

/** Resultado de um envio pelo agendador; `auth` = sem sessão (nenhum outro vai passar). */
type UploadOutcome = 'synced' | 'pending' | 'rejected' | 'auth'

interface UploadSlot {
  /** Upload em voo (no máximo um por id). */
  running: Promise<UploadOutcome> | null
  /** Houve gravação depois do último envio começar: precisa de mais um. */
  again: boolean
  /** Fim da janela de espera atual. */
  timer: ReturnType<typeof setTimeout> | null
  /** Quando o último envio começou (para a janela). */
  lastStart: number
}

const uploadSlots = new Map<string, UploadSlot>()
const uploadListeners = new Map<string, Set<(s: DrawingUploadStatus) => void>>()

export function subscribeDrawingUpload(id: string, listener: (s: DrawingUploadStatus) => void): () => void {
  let set = uploadListeners.get(id)
  if (!set) {
    set = new Set()
    uploadListeners.set(id, set)
  }
  set.add(listener)
  return () => {
    set.delete(listener)
    if (set.size === 0) uploadListeners.delete(id)
  }
}

function emitUpload(id: string, status: DrawingUploadStatus): void {
  uploadListeners.get(id)?.forEach((l) => l(status))
}

function slotFor(id: string): UploadSlot {
  let slot = uploadSlots.get(id)
  if (!slot) {
    slot = { running: null, again: false, timer: null, lastStart: 0 }
    uploadSlots.set(id, slot)
  }
  return slot
}

/** Envia um desenho pelo agendador: serializa com qualquer outro envio do mesmo id. */
function runUpload(id: string): Promise<UploadOutcome> {
  const slot = slotFor(id)
  if (slot.running) {
    slot.again = true
    return slot.running
  }
  slot.lastStart = Date.now()
  slot.again = false
  const run = async (): Promise<UploadOutcome> => {
    let outcome: UploadOutcome
    try {
      const ok = await uploadOne(id)
      // `markSynced` só marca a versão enviada: edição durante o envio continua `pending`.
      // `uploadOne` também devolve `true` sem enviar quando o registro já era `rejected`.
      const record = ok ? await drawingStore.get(id) : undefined
      if (record?.syncState === 'rejected') {
        outcome = 'rejected'
        emitUpload(id, { kind: 'rejected', message: DRAWING_REJECTED_MESSAGE })
      } else {
        outcome = ok && record?.syncState !== 'pending' ? 'synced' : 'pending'
        emitUpload(id, { kind: outcome === 'synced' ? 'synced' : 'pending' })
      }
    } catch (err) {
      if (err instanceof DrawingUploadError) {
        outcome = 'rejected'
        emitUpload(id, { kind: 'rejected', message: err.message })
      } else {
        outcome = 'auth' // AuthError: fica na fila para depois do login
        emitUpload(id, { kind: 'pending' })
      }
    } finally {
      slot.running = null
    }
    if (slot.again) scheduleDrawingUpload(id)
    return outcome
  }
  slot.running = run()
  return slot.running
}

/**
 * Agenda o upload de um desenho recém-gravado. Dentro da janela de
 * `UPLOAD_INTERVAL_MS` desde o último envio, só espera o fim dela; com
 * `immediate` (fechar o editor) envia já. Falha de rede deixa `pending` sem
 * reagendar — o laço de `online`/`drainQueue` cobre.
 */
export function scheduleDrawingUpload(id: string, opts: { immediate?: boolean } = {}): void {
  const slot = slotFor(id)
  if (slot.running) {
    slot.again = true
    return
  }
  const wait = opts.immediate ? 0 : Math.max(0, slot.lastStart + UPLOAD_INTERVAL_MS - Date.now())
  if (slot.timer) {
    if (!opts.immediate) return
    clearTimeout(slot.timer)
  }
  slot.timer = setTimeout(() => {
    slot.timer = null
    void runUpload(id)
  }, wait)
}

async function uploadCause(res: Response): Promise<DrawingUploadCause> {
  if (res.status === 413) {
    let error = ''
    try {
      const body = await res.json()
      error = typeof body?.error === 'string' ? body.error : ''
    } catch {
      return 'unknown'
    }
    // A causa só escolhe a mensagem; quem decide re-tentar é a família do status.
    return error.includes('quota') ? 'quota' : 'too_large'
  }
  return res.status === 400 ? 'invalid' : 'unknown'
}

/**
 * Envia um pendente. Falha transitória (rede, 5xx) é silenciosa e o registro
 * fica na fila; recusa permanente (4xx) marca `rejected` e lança.
 *
 * 401 fica de fora: `api.ts` já o converte em `AuthError` depois do refresh.
 * 404/405 também ficam de fora — nossa rota nunca responde isso, então é um
 * servidor que ainda não conhece `/api/drawings` (cliente novo, servidor velho).
 */
async function uploadOne(id: string): Promise<boolean> {
  const record = await drawingStore.get(id)
  if (!record) return true
  if (record.syncState === 'synced' || record.syncState === 'rejected') return true
  if (!record.scene) return true

  try {
    const res = await api.put(`/api/drawings/${id}`, {
      scene: record.scene,
      svg: record.svg,
      width: record.width,
      height: record.height,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    })
    if (!res.ok) {
      if (res.status >= 400 && res.status < 500 && res.status !== 404 && res.status !== 405) {
        const cause = await uploadCause(res)
        await drawingStore.markRejected(id)
        throw new DrawingUploadError(cause)
      }
      return false
    }
    await drawingStore.markSynced(id, record.updatedAt)
    return true
  } catch (err) {
    if (err instanceof AuthError || err instanceof DrawingUploadError) throw err
    return false
  }
}

/** Drena a fila de uploads pendentes. */
export async function uploadPendingDrawings(): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return

  let pending: DrawingRecord[]
  try {
    pending = await drawingStore.listPending()
  } catch {
    return
  }

  for (const record of pending) {
    // Pelo agendador: nunca dois envios do mesmo id em voo. Recusa permanente já
    // foi marcada `rejected`; segue a fila. Só falta de sessão interrompe —
    // sem ela, nenhum dos próximos vai passar.
    if ((await runUpload(record.id)) === 'auth') return
  }
}

/** Quantos desenhos o servidor recusou de vez. Consultado por /settings. */
export async function countRejectedDrawings(): Promise<number> {
  try {
    return await drawingStore.countRejected()
  } catch {
    return 0
  }
}

/** Busca um desenho no servidor e grava localmente. */
export async function fetchDrawing(id: string): Promise<DrawingRecord | null> {
  try {
    const res = await api.get(`/api/drawings/${id}`)
    if (!res.ok) return null
    const record = serverDrawingToRecord((await res.json()) as ServerDrawing)
    // Uma edição local feita durante o download vence: só grava se ainda não há registro.
    const local = await drawingStore.get(id)
    if (local) return local
    await drawingStore.put(record)
    emitDrawingChanged(id)
    return record
  } catch {
    return null
  }
}

/**
 * Pull por manifesto: baixa só o que não existe localmente ou é mais novo no
 * servidor, sem sobrescrever uma alteração local `pending` mais nova. Falha é
 * silenciosa — o desenho aparece na próxima sincronização.
 */
export async function pullDrawings(): Promise<void> {
  try {
    const res = await api.get('/api/drawings/manifest')
    if (!res.ok) return
    const { drawings } = (await res.json()) as { drawings: DrawingManifestEntry[] }
    if (!Array.isArray(drawings)) return

    const wanted: DrawingManifestEntry[] = []
    for (const entry of drawings) {
      const local = await drawingStore.get(entry.id)
      if (!local) {
        wanted.push(entry)
      } else if (local.syncState === 'pending' && local.updatedAt >= entry.updated_at) {
        continue
      } else if (entry.updated_at > local.updatedAt) {
        wanted.push(entry)
      }
    }

    for (let i = 0; i < wanted.length; i += PULL_BATCH) {
      await Promise.all(
        wanted.slice(i, i + PULL_BATCH).map(async (entry) => {
          try {
            const r = await api.get(`/api/drawings/${entry.id}`)
            if (!r.ok) return
            const record = serverDrawingToRecord((await r.json()) as ServerDrawing)
            const local = await drawingStore.get(entry.id)
            if (local && local.syncState === 'pending' && local.updatedAt >= record.updatedAt) return
            await drawingStore.put(record)
            emitDrawingChanged(entry.id)
          } catch {
            // silencioso — o próximo pull tenta de novo
          }
        }),
      )
    }
  } catch {
    // silencioso — pull de desenhos nunca deve interromper a inicialização
  }
}
