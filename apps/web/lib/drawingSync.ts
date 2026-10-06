import { DrawingStore } from '@zettelkasten/db-web'
import {
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
  too_large: 'Este desenho passa de 2 MB e não pôde ser sincronizado. Ele ficou salvo só neste aparelho.',
  invalid: 'O servidor não aceitou este desenho. Ele ficou salvo só neste aparelho.',
  unknown: 'Não foi possível sincronizar o desenho com o servidor. Ele ficou salvo só neste aparelho.',
}

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
    super('O desenho passa de 2 MB. Simplifique a cena ou divida em dois desenhos.')
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

/**
 * O servidor recusa SVG que busque recurso externo. O `exportToSvg` do Excalidraw
 * embute as fontes como data URL, mas se o fetch da fonte falhar pode deixar a
 * URL original no `@font-face` — aqui ela vira `url()` vazio em vez de derrubar
 * o upload inteiro.
 */
export function sanitizeSvgForStorage(svg: string): string {
  return svg
    .replace(/@import[^;]*;?/gi, '')
    .replace(/url\(\s*(['"]?)\s*(?:https?:)?\/\/[^)]*\)/gi, 'url()')
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

export type SaveDrawingResult =
  | { record: DrawingRecord; sync: 'synced' | 'pending' }
  | { record: DrawingRecord; sync: 'rejected'; error: DrawingUploadError }

/**
 * Grava cena e preview na mesma escrita do Dexie (nunca um sem o outro) com
 * `syncState = pending` e já tenta o upload. Local-first: o desenho fica salvo
 * mesmo que o servidor recuse — nesse caso o resultado traz o erro para a UI.
 */
export async function saveDrawing(input: SaveDrawingInput): Promise<SaveDrawingResult> {
  const svg = sanitizeSvgForStorage(input.svg)
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

  try {
    const ok = await uploadOne(input.id)
    return { record, sync: ok ? 'synced' : 'pending' }
  } catch (err) {
    if (err instanceof DrawingUploadError) return { record, sync: 'rejected', error: err }
    // AuthError e afins: fica na fila para depois do login.
    return { record, sync: 'pending' }
  }
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
    try {
      await uploadOne(record.id)
    } catch (err) {
      // Recusa permanente já foi marcada `rejected`; segue a fila. Só AuthError
      // interrompe — sem sessão, nenhum dos próximos vai passar.
      if (err instanceof DrawingUploadError) continue
      return
    }
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
