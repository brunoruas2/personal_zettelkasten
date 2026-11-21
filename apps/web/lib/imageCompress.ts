// Compressão de imagem no cliente.
//
// O servidor nunca re-encoda: a stdlib do Go não tem encoder WebP e rasterizar
// no VPS de 500 MB é justamente o que se quer evitar. Então toda a redução
// acontece aqui, antes de qualquer I/O — nada grande chega a tocar o IndexedDB,
// a rede ou o SQLite.

import { binarizeAdaptive, binaryToRgba, rgbaToGray } from '@zettelkasten/core'
import { getSavedCompressionLevel, type CompressionLevel } from './imageCompressLevel'

/** `photo` usa o perfil salvo; `document` binariza (foto de caderno). */
export type CompressionMode = 'photo' | 'document'

export interface CompressOptions {
  mode?: CompressionMode
}

/** Modo documento: teto com folga sob os 512 KB do servidor e degraus do lado maior. */
export const DOCUMENT_MAX_BYTES = 400 * 1024
export const DOCUMENT_DIMENSIONS = [2000, 1600, 1280, 1024, 800]

export interface CompressionProfile {
  /** Lado maior alvo, em px. */
  maxDimension: number
  /** Degraus de qualidade da primeira passada. */
  qualitySteps: number[]
  /** Teto por imagem, em bytes. */
  maxBytes: number
  /** Segunda passada, quando a primeira não cabe no teto. */
  fallbackDimension: number
  fallbackQuality: number
}

/**
 * Os cinco valores andam juntos: um teto maior com a escada de qualidade antiga
 * nunca seria usado, e o fallback só faz sentido relativo ao lado maior do nível.
 * `strong` é o perfil que existia antes da preferência — não mexer.
 *
 * O teto de todo nível fica abaixo dos 512 KB que o servidor aceita no upload
 * (o blob final é exatamente o corpo do POST).
 */
export const COMPRESSION_PROFILES: Record<CompressionLevel, CompressionProfile> = {
  strong: {
    maxDimension: 1200,
    qualitySteps: [0.8, 0.65, 0.5, 0.38],
    maxBytes: 120 * 1024,
    fallbackDimension: 900,
    fallbackQuality: 0.45,
  },
  medium: {
    maxDimension: 1600,
    qualitySteps: [0.85, 0.75, 0.65, 0.5],
    maxBytes: 250 * 1024,
    fallbackDimension: 1200,
    fallbackQuality: 0.5,
  },
  light: {
    maxDimension: 2000,
    qualitySteps: [0.9, 0.82, 0.72, 0.6],
    maxBytes: 400 * 1024,
    fallbackDimension: 1600,
    fallbackQuality: 0.55,
  },
}

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
 * Comprime um arquivo até caber no teto e no lado maior do nível.
 * O nível é lido no momento da chamada, então trocar a preferência vale para a
 * próxima importação sem recarregar.
 * SVG passa direto (é texto, rasterizar só pioraria).
 * GIF animado é rejeitado: o canvas achataria a animação no primeiro frame.
 */
export async function compressImage(
  file: File,
  level: CompressionLevel = getSavedCompressionLevel(),
  options: CompressOptions = {},
): Promise<CompressedImage> {
  const profile = COMPRESSION_PROFILES[level]

  if (file.type === 'image/svg+xml') {
    return compressSvg(file, profile.maxBytes)
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

  if (options.mode === 'document') {
    try {
      return await compressDocument(bitmap)
    } finally {
      bitmap.close()
    }
  }

  try {
    let result = await encodeWithinBudget(bitmap, profile.maxDimension, profile.qualitySteps, profile.maxBytes)
    if (result.blob.size > profile.maxBytes) {
      result = await encodeWithinBudget(
        bitmap,
        profile.fallbackDimension,
        [profile.fallbackQuality],
        profile.maxBytes,
      )
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

/**
 * Foto de caderno: cinza + limiar adaptativo, WebP sem perda (duas cores
 * comprimem muito). Reduz o lado maior em degraus até caber em DOCUMENT_MAX_BYTES.
 */
async function compressDocument(bitmap: ImageBitmap): Promise<CompressedImage> {
  for (const maxDim of DOCUMENT_DIMENSIONS) {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, maxDim)
    const blob = await drawBinarizeEncode(bitmap, width, height)
    if (blob.size <= DOCUMENT_MAX_BYTES) {
      return {
        id: await hashId(blob),
        blob,
        mime: blob.type || 'image/webp',
        width,
        height,
      }
    }
  }
  throw new ImageCompressError(
    'Não foi possível reduzir esta foto o bastante. Tente recortar mais ou fotografar com menos detalhe.',
  )
}

async function drawBinarizeEncode(bitmap: ImageBitmap, width: number, height: number): Promise<Blob> {
  const useOffscreen = typeof OffscreenCanvas !== 'undefined'
  const canvas: OffscreenCanvas | HTMLCanvasElement = useOffscreen
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement('canvas'), { width, height })
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!ctx) throw new ImageCompressError('Canvas indisponível neste navegador.')
  ctx.drawImage(bitmap, 0, 0, width, height)

  const img = ctx.getImageData(0, 0, width, height)
  const bin = binarizeAdaptive(rgbaToGray(img.data, width, height), width, height)
  binaryToRgba(bin, img.data)
  ctx.putImageData(img, 0, 0)

  if (canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: 'image/webp', quality: 1 })
  }
  return new Promise<Blob>((resolve, reject) => {
    ;(canvas as HTMLCanvasElement).toBlob(
      (blob) => (blob ? resolve(blob) : reject(new ImageCompressError('Falha ao codificar a imagem.'))),
      'image/webp',
      1,
    )
  })
}

async function compressSvg(file: File, maxBytes: number): Promise<CompressedImage> {
  if (file.size > maxBytes) {
    throw new ImageCompressError(
      `SVG acima de ${Math.round(maxBytes / 1024)} KB — simplifique o arquivo antes de importar.`,
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
  maxBytes: number,
): Promise<EncodeResult> {
  const { width, height } = fitWithin(bitmap.width, bitmap.height, maxDimension)

  let best: Blob | null = null
  for (const quality of qualities) {
    const blob = await drawAndEncode(bitmap, width, height, quality)
    best = blob
    if (blob.size <= maxBytes) break
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
