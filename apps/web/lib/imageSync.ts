import { ImageStore, type ImageRecord } from '@zettelkasten/db-web'
import { api, AuthError } from './api'
import { compressImage, type CompressedImage } from './imageCompress'

export const imageStore = new ImageStore()

const PREFETCH_KEY = 'zettel_image_prefetch'
const PREFETCH_BATCH = 3

export interface ImageManifestEntry {
  id: string
  mime: string
  width: number
  height: number
  byte_len: number
  created_at: number
}

/**
 * Comprime e grava localmente, já disparando o upload.
 * O registro nasce `pending`; só vira `synced` quando o servidor confirma.
 */
export async function importImage(file: File): Promise<CompressedImage> {
  const compressed = await compressImage(file)

  await imageStore.put({
    id: compressed.id,
    blob: compressed.blob,
    mime: compressed.mime,
    width: compressed.width,
    height: compressed.height,
    byteLen: compressed.blob.size,
    createdAt: Date.now(),
    syncState: 'pending',
  })

  await uploadOne(compressed.id)
  return compressed
}

/** Envia um pendente. Silencioso em falha — fica na fila para a próxima rodada. */
async function uploadOne(id: string): Promise<boolean> {
  const record = await imageStore.get(id)
  if (!record || record.syncState === 'synced') return true

  try {
    const res = await api.postBinary(`/api/images/${id}`, record.blob, record.mime, {
      'X-Image-Width': String(record.width),
      'X-Image-Height': String(record.height),
    })
    if (!res.ok) return false
    await imageStore.markSynced(id)
    return true
  } catch (err) {
    if (err instanceof AuthError) throw err
    return false
  }
}

/** Drena a fila de uploads pendentes. */
export async function uploadPending(): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return

  let pending: ImageRecord[]
  try {
    pending = await imageStore.listPending()
  } catch {
    return
  }

  for (const record of pending) {
    try {
      await uploadOne(record.id)
    } catch {
      return // AuthError: sessão morreu, não adianta insistir
    }
  }
}

/** Busca um blob no servidor e grava localmente. */
export async function fetchImage(id: string): Promise<Blob | null> {
  try {
    const res = await api.get(`/api/images/${id}`)
    if (!res.ok) return null
    const blob = await res.blob()
    await imageStore.put({
      id,
      blob,
      mime: blob.type || 'image/webp',
      width: 0,
      height: 0,
      byteLen: blob.size,
      createdAt: Date.now(),
      syncState: 'synced',
    })
    return blob
  } catch {
    return null
  }
}

export function isPrefetchEnabled(): boolean {
  if (typeof localStorage === 'undefined') return true
  return localStorage.getItem(PREFETCH_KEY) !== '0'
}

export function setPrefetchEnabled(enabled: boolean): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(PREFETCH_KEY, enabled ? '1' : '0')
}

/**
 * Baixa em background as imagens que faltam localmente, para que um zettel
 * nunca visitado neste device abra offline com imagem.
 * Mesmo padrão fire-and-forget do cacheZettelRoutes: falha é silenciosa.
 */
export async function prefetchImages(): Promise<void> {
  if (!isPrefetchEnabled()) return

  const conn = (navigator as { connection?: { saveData?: boolean } }).connection
  if (conn?.saveData) return

  try {
    const res = await api.get('/api/images/manifest')
    if (!res.ok) return
    const { images } = (await res.json()) as { images: ImageManifestEntry[] }
    if (!Array.isArray(images)) return

    const localIds = new Set(await imageStore.listIds())
    const missing = images.filter((m) => !localIds.has(m.id))

    for (let i = 0; i < missing.length; i += PREFETCH_BATCH) {
      await Promise.all(missing.slice(i, i + PREFETCH_BATCH).map((m) => fetchImage(m.id)))
    }
  } catch {
    // silencioso — prefetch nunca deve interromper a inicialização
  }
}
