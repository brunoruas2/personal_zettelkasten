'use client'

import React from 'react'
import { createPortal } from 'react-dom'
import { binarizeAdaptive, binaryToRgba, rgbaToGray } from '@zettelkasten/core'
import type { CompressionMode } from '../lib/imageCompress'

/** Marca a raiz do modal (portal no body), como o `data-drawing-modal`. */
export const PHOTO_CROP_ATTR = 'data-photo-crop-modal'

const HANDLE = 44 // alvo de toque, px de tela
const MIN_CROP = 48 // lado mínimo do recorte, px de tela
const OUTPUT_MAX = 3000 // lado maior do arquivo recortado (a compressão reduz depois)
const PREVIEW_MAX = 900

interface Props {
  file: File
  onCancel: () => void
  onConfirm: (file: File, mode: CompressionMode) => void
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

type Drag =
  | { kind: 'corner'; cx: 0 | 1; cy: 0 | 1 }
  | { kind: 'move'; dx: number; dy: number }

/** Dimensões do bitmap depois de girar `rot` × 90°. */
function rotatedSize(bw: number, bh: number, rot: number) {
  return rot % 2 === 0 ? { w: bw, h: bh } : { w: bh, h: bw }
}

/** Desenha o bitmap girado com origem em (dx, dy) e escala `s`. */
function drawRotated(
  ctx: CanvasRenderingContext2D,
  bmp: ImageBitmap,
  rot: number,
  dx: number,
  dy: number,
  s: number,
) {
  const { w: rw, h: rh } = rotatedSize(bmp.width, bmp.height, rot)
  ctx.save()
  ctx.translate(dx, dy)
  ctx.scale(s, s)
  if (rot === 1) {
    ctx.translate(rw, 0)
    ctx.rotate(Math.PI / 2)
  } else if (rot === 2) {
    ctx.translate(rw, rh)
    ctx.rotate(Math.PI)
  } else if (rot === 3) {
    ctx.translate(0, rh)
    ctx.rotate(Math.PI * 1.5)
  }
  ctx.drawImage(bmp, 0, 0)
  ctx.restore()
}

export function PhotoCropModal({ file, onCancel, onConfirm }: Props) {
  const areaRef = React.useRef<HTMLDivElement>(null)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const [bitmap, setBitmap] = React.useState<ImageBitmap | null>(null)
  const [loadError, setLoadError] = React.useState(false)
  const [rot, setRot] = React.useState(0)
  const [mode, setMode] = React.useState<CompressionMode>('document')
  const [binCanvas, setBinCanvas] = React.useState<HTMLCanvasElement | null>(null)
  const [size, setSize] = React.useState({ w: 0, h: 0 })
  // Recorte em px da imagem girada.
  const [crop, setCrop] = React.useState<Rect | null>(null)
  const dragRef = React.useRef<Drag | null>(null)

  // Carrega respeitando a orientação EXIF (foto de iPhone em pé).
  React.useEffect(() => {
    let cancelled = false
    let bmp: ImageBitmap | null = null
    createImageBitmap(file, { imageOrientation: 'from-image' })
      .then((b) => {
        if (cancelled) return b.close()
        bmp = b
        setBitmap(b)
        setCrop({ x: 0, y: 0, w: b.width, h: b.height })
      })
      .catch(() => !cancelled && setLoadError(true))
    return () => {
      cancelled = true
      bmp?.close()
    }
  }, [file])

  // Trava rolagem do fundo e mede a área útil.
  React.useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const el = areaRef.current
    const measure = () => el && setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    if (el) ro.observe(el)
    return () => {
      document.body.style.overflow = prev
      ro.disconnect()
    }
  }, [])

  const rs = bitmap ? rotatedSize(bitmap.width, bitmap.height, rot) : { w: 1, h: 1 }
  // px de tela por px de imagem, e deslocamento que centraliza.
  const scale = Math.min(size.w / rs.w, size.h / rs.h) || 1
  const ox = (size.w - rs.w * scale) / 2
  const oy = (size.h - rs.h * scale) / 2

  // Imagem inteira girada e binarizada, uma vez por bitmap/giro (não por recorte).
  React.useEffect(() => {
    setBinCanvas(null)
    if (!bitmap) return
    const { w: rw, h: rh } = rotatedSize(bitmap.width, bitmap.height, rot)
    const s = Math.min(1, PREVIEW_MAX / Math.max(rw, rh))
    const w = Math.max(1, Math.round(rw * s))
    const h = Math.max(1, Math.round(rh * s))
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    drawRotated(ctx, bitmap, rot, 0, 0, s)
    const img = ctx.getImageData(0, 0, w, h)
    binaryToRgba(binarizeAdaptive(rgbaToGray(img.data, w, h), w, h), img.data)
    ctx.putImageData(img, 0, 0)
    setBinCanvas(c)
  }, [bitmap, rot])

  // Pintura.
  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !bitmap || !crop || size.w === 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(size.w * dpr)
    canvas.height = Math.round(size.h * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.w, size.h)

    const cx = ox + crop.x * scale
    const cy = oy + crop.y * scale
    const cw = crop.w * scale
    const ch = crop.h * scale

    if (mode === 'document' && binCanvas) {
      ctx.drawImage(binCanvas, ox, oy, rs.w * scale, rs.h * scale)
    } else {
      drawRotated(ctx, bitmap, rot, ox, oy, scale)
    }
    // Escurece fora do recorte.
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillRect(ox, oy, rs.w * scale, cy - oy)
    ctx.fillRect(ox, cy + ch, rs.w * scale, oy + rs.h * scale - (cy + ch))
    ctx.fillRect(ox, cy, cx - ox, ch)
    ctx.fillRect(cx + cw, cy, ox + rs.w * scale - (cx + cw), ch)

    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    ctx.strokeRect(cx, cy, cw, ch)
    ctx.fillStyle = '#fff'
    for (const [px, py] of [[cx, cy], [cx + cw, cy], [cx, cy + ch], [cx + cw, cy + ch]]) {
      ctx.fillRect(px - 7, py - 7, 14, 14)
    }
  }, [bitmap, crop, rot, mode, binCanvas, size, scale, ox, oy, rs.w, rs.h])

  const toImage = (clientX: number, clientY: number) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return { x: (clientX - r.left - ox) / scale, y: (clientY - r.top - oy) / scale }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (!crop) return
    const r = canvasRef.current!.getBoundingClientRect()
    const px = e.clientX - r.left
    const py = e.clientY - r.top
    const left = ox + crop.x * scale
    const top = oy + crop.y * scale
    const right = left + crop.w * scale
    const bottom = top + crop.h * scale

    let best: { cx: 0 | 1; cy: 0 | 1; d: number } | null = null
    for (const cx of [0, 1] as const)
      for (const cy of [0, 1] as const) {
        const d = Math.hypot(px - (cx ? right : left), py - (cy ? bottom : top))
        if (d <= HANDLE && (!best || d < best.d)) best = { cx, cy, d }
      }
    if (best) dragRef.current = { kind: 'corner', cx: best.cx, cy: best.cy }
    else if (px > left && px < right && py > top && py < bottom) {
      const p = toImage(e.clientX, e.clientY)
      dragRef.current = { kind: 'move', dx: p.x - crop.x, dy: p.y - crop.y }
    } else return
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag || !crop) return
    const p = toImage(e.clientX, e.clientY)
    const minSide = MIN_CROP / scale
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
    if (drag.kind === 'move') {
      setCrop({
        ...crop,
        x: clamp(p.x - drag.dx, 0, rs.w - crop.w),
        y: clamp(p.y - drag.dy, 0, rs.h - crop.h),
      })
      return
    }
    let { x, y, w, h } = crop
    if (drag.cx === 0) {
      const nx = clamp(p.x, 0, x + w - minSide)
      w += x - nx
      x = nx
    } else {
      w = clamp(p.x - x, minSide, rs.w - x)
    }
    if (drag.cy === 0) {
      const ny = clamp(p.y, 0, y + h - minSide)
      h += y - ny
      y = ny
    } else {
      h = clamp(p.y - y, minSide, rs.h - y)
    }
    setCrop({ x, y, w, h })
  }

  const onPointerUp = () => {
    dragRef.current = null
  }

  const rotate = () => {
    if (!bitmap) return
    const next = (rot + 1) % 4
    const n = rotatedSize(bitmap.width, bitmap.height, next)
    setRot(next)
    setCrop({ x: 0, y: 0, w: n.w, h: n.h })
  }

  const confirm = () => {
    if (!bitmap || !crop) return
    const s = Math.min(1, OUTPUT_MAX / Math.max(crop.w, crop.h))
    const w = Math.max(1, Math.round(crop.w * s))
    const h = Math.max(1, Math.round(crop.h * s))
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')
    if (!ctx) return onCancel()
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    drawRotated(ctx, bitmap, rot, -crop.x * s, -crop.y * s, s)
    c.toBlob(
      (blob) => {
        if (!blob) return onCancel()
        onConfirm(new File([blob], 'foto.jpg', { type: 'image/jpeg' }), mode)
      },
      'image/jpeg',
      0.95,
    )
  }

  const btn =
    'flex h-11 min-w-11 items-center justify-center rounded-xl px-3 text-sm font-semibold text-white bg-white/10 active:bg-white/20'
  const on = 'bg-white text-black'

  return createPortal(
    <div
      {...{ [PHOTO_CROP_ATTR]: '' }}
      role="dialog"
      aria-label="Recortar foto"
      className="fixed inset-0 z-[200] flex flex-col bg-black"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onCancel()
        }
      }}
    >
      <div ref={areaRef} className="relative min-h-0 flex-1">
        {loadError ? (
          <p className="p-6 text-center text-sm text-white">Não foi possível ler esta foto.</p>
        ) : (
          <canvas
            ref={canvasRef}
            className="absolute inset-0 h-full w-full"
            style={{ touchAction: 'none' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        )}
      </div>

      <div
        className="flex flex-wrap items-center justify-center gap-2 px-3 pt-3"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        <button type="button" className={btn} onClick={rotate} aria-label="Girar 90 graus">
          ⟳ Girar
        </button>
        <button
          type="button"
          className={`${btn} ${mode === 'document' ? on : ''}`}
          onClick={() => setMode('document')}
          aria-pressed={mode === 'document'}
        >
          Documento P&amp;B
        </button>
        <button
          type="button"
          className={`${btn} ${mode === 'photo' ? on : ''}`}
          onClick={() => setMode('photo')}
          aria-pressed={mode === 'photo'}
        >
          Foto
        </button>
        <div className="flex w-full justify-end gap-2 pt-1">
          <button type="button" className={btn} onClick={onCancel}>
            Cancelar
          </button>
          <button
            type="button"
            className={`${btn} bg-white text-black`}
            onClick={confirm}
            disabled={!bitmap || !crop}
          >
            Usar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
