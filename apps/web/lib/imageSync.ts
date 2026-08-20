import { ImageStore, type ImageRecord } from '@zettelkasten/db-web'
import { api, AuthError } from './api'
import { compressImage, type CompressedImage } from './imageCompress'

export const imageStore = new ImageStore()

const PREFETCH_KEY = 'zettel_image_prefetch'
const PREFETCH_BATCH = 3

export type ImageUploadCause = 'quota' | 'too_large' | 'invalid' | 'unknown'

const UPLOAD_ERROR_MESSAGES: Record<ImageUploadCause, string> = {
  quota: 'Sua cota de imagens está esgotada. Apague imagens antigas ou peça mais espaço antes de enviar esta.',
  too_large: 'Esta imagem passa de 512 KB mesmo depois da compressão e não pôde ser enviada.',
  invalid: 'O servidor não aceitou este arquivo de imagem.',
  unknown: 'Não foi possível enviar a imagem para o servidor.',
}

/** Recusa permanente do servidor: re-tentar não muda o resultado. */
export class ImageUploadError extends Error {
  readonly cause: ImageUploadCause

  constructor(cause: ImageUploadCause) {
    super(UPLOAD_ERROR_MESSAGES[cause])
    this.name = 'ImageUploadError'
    this.cause = cause
  }
}

/**
 * A causa sai do corpo da resposta, mas quem decide se vale re-tentar é a
 * família do status — casar string de backend para decisão de controle quebra
 * silenciosamente quando alguém reescreve um `jsonError`.
 */
async function uploadCause(res: Response): Promise<ImageUploadCause> {
  let error = ''
  try {
    const body = await res.json()
    error = typeof body?.error === 'string' ? body.error : ''
  } catch {
    return 'unknown'
  }
  if (error.includes('quota')) return 'quota'
  if (error.includes('512 KB')) return 'too_large'
  if (error.includes('format') || error.includes('hash') || error.includes('empty')) return 'invalid'
  return 'unknown'
}

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
 *
 * Lança `ImageUploadError` se o servidor recusar de forma permanente — o
 * chamador não deve inserir a referência `zk:img/` no corpo nesse caso, ou o
 * zettel apontaria para bytes que só existem neste aparelho.
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

/**
 * Envia um pendente. Falha transitória (rede, 5xx) é silenciosa e o registro
 * fica na fila; recusa permanente (4xx) marca `rejected` e lança.
 *
 * 401 fica de fora da classificação: `api.ts` já o converte em `AuthError`
 * depois de tentar o refresh, e depois do login a mesma imagem sobe normalmente
 * — marcá-la `rejected` seria perda de dado.
 */
async function uploadOne(id: string): Promise<boolean> {
  const record = await imageStore.get(id)
  if (!record || record.syncState === 'synced' || record.syncState === 'rejected') return true

  try {
    const res = await api.postBinary(`/api/images/${id}`, record.blob, record.mime, {
      'X-Image-Width': String(record.width),
      'X-Image-Height': String(record.height),
    })
    if (!res.ok) {
      if (res.status >= 400 && res.status < 500) {
        const cause = await uploadCause(res)
        await imageStore.markRejected(id)
        throw new ImageUploadError(cause)
      }
      return false
    }
    await imageStore.markSynced(id)
    return true
  } catch (err) {
    if (err instanceof AuthError || err instanceof ImageUploadError) throw err
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
    } catch (err) {
      // Recusa permanente já foi marcada `rejected`; segue a fila. Só AuthError
      // interrompe — sem sessão, nenhuma das próximas vai passar.
      if (err instanceof ImageUploadError) continue
      return
    }
  }
}

/** Quantas imagens o servidor recusou de vez. Consultado por /settings. */
export async function countRejectedImages(): Promise<number> {
  try {
    return await imageStore.countRejected()
  } catch {
    return 0
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
