// Compressão de imagem no cliente.
//
// O servidor nunca re-encoda: a stdlib do Go não tem encoder WebP e rasterizar
// no VPS de 500 MB é justamente o que se quer evitar. Então toda a redução
// acontece aqui, antes de qualquer I/O — nada grande chega a tocar o IndexedDB,
// a rede ou o SQLite.

/** Lado maior alvo, em px. */
export const MAX_DIMENSION = 1200

/** Segunda passada, quando a primeira não cabe no teto. */
const FALLBACK_DIMENSION = 900

/** Teto por imagem, em bytes. */
export const MAX_BYTES = 120 * 1024

/** Degraus de qualidade da primeira passada. */
const QUALITY_STEPS = [0.8, 0.65, 0.5, 0.38]

const FALLBACK_QUALITY = 0.45

/** Tamanho do id: sha256 do conteúdo truncado em 128 bits. */
export const IMAGE_ID_LENGTH = 32

export interface CompressedImage {
  id: string
  blob: Blob
  mime: string
  width: number
  height: number
}

export class ImageCompressError extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = 'ImageCompressError'
  }
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/')
}

/**
 * Comprime um arquivo até caber em MAX_BYTES e MAX_DIMENSION.
 * SVG passa direto (é texto, rasterizar só pioraria).
 * GIF animado é rejeitado: o canvas achataria a animação no primeiro frame.
 */
export async function compressImage(file: File): Promise<CompressedImage> {
  if (file.type === 'image/svg+xml') {
    return compressSvg(file)
  }

  if (file.type === 'image/gif' && (await isAnimatedGif(file))) {
    throw new ImageCompressError(
      'GIF animado não é suportado — a conversão achataria a animação no primeiro frame.',
    )
  }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new ImageCompressError('Não foi possível ler esta imagem.')
  }

  try {
    let result = await encodeWithinBudget(bitmap, MAX_DIMENSION, QUALITY_STEPS)
    if (result.blob.size > MAX_BYTES) {
      result = await encodeWithinBudget(bitmap, FALLBACK_DIMENSION, [FALLBACK_QUALITY])
    }

    const id = await hashId(result.blob)
    return {
      id,
      blob: result.blob,
      // Safari antigo devolve PNG/JPEG quando não sabe encodar WebP — o tipo
      // real do blob manda, senão gravaríamos um mime mentiroso.
      mime: result.blob.type || 'image/webp',
      width: result.width,
      height: result.height,
    }
  } finally {
    bitmap.close()
  }
}

async function compressSvg(file: File): Promise<CompressedImage> {
  if (file.size > MAX_BYTES) {
    throw new ImageCompressError(
      `SVG acima de ${Math.round(MAX_BYTES / 1024)} KB — simplifique o arquivo antes de importar.`,
    )
  }
  const blob = new Blob([await file.arrayBuffer()], { type: 'image/svg+xml' })
  return {
    id: await hashId(blob),
    blob,
    mime: 'image/svg+xml',
    width: 0,
    height: 0,
  }
}

interface EncodeResult {
  blob: Blob
  width: number
  height: number
}

async function encodeWithinBudget(
  bitmap: ImageBitmap,
  maxDimension: number,
  qualities: number[],
): Promise<EncodeResult> {
  const { width, height } = fitWithin(bitmap.width, bitmap.height, maxDimension)

  let best: Blob | null = null
  for (const quality of qualities) {
    const blob = await drawAndEncode(bitmap, width, height, quality)
    best = blob
    if (blob.size <= MAX_BYTES) break
  }

  return { blob: best!, width, height }
}

/** Escala para caber no lado maior. Nunca amplia. */
function fitWithin(width: number, height: number, max: number) {
  const longest = Math.max(width, height)
  if (longest <= max) return { width, height }
  const ratio = max / longest
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  }
}

async function drawAndEncode(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  quality: number,
): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new ImageCompressError('Canvas indisponível neste navegador.')
    ctx.drawImage(bitmap, 0, 0, width, height)
    return canvas.convertToBlob({ type: 'image/webp', quality })
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new ImageCompressError('Canvas indisponível neste navegador.')
  ctx.drawImage(bitmap, 0, 0, width, height)

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new ImageCompressError('Falha ao codificar a imagem.'))),
      'image/webp',
      quality,
    )
  })
}

/** id = sha256(bytes) truncado — content-addressing dá dedup e ETag de graça. */
export async function hashId(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, IMAGE_ID_LENGTH)
}

/**
 * Detecta GIF animado procurando um segundo Graphic Control Extension
 * (0x21 0xF9) no arquivo.
 */
async function isAnimatedGif(file: File): Promise<boolean> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let frames = 0
  for (let i = 0; i < bytes.length - 1; i++) {
    if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9) {
      frames++
      if (frames > 1) return true
    }
  }
  return false
}
