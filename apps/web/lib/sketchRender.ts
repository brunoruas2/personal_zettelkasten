import { getStroke } from 'perfect-freehand'
import {
  outlineToSvgPath,
  sceneBounds,
  type SketchPoint,
  type SketchScene,
  type Stroke,
} from '@zettelkasten/core'

/** Margem do preview SVG em volta dos traços, em unidades do mundo. */
export const SVG_MARGIN = 16
/** Maior dimensão (px) que o SVG exportado declara em `width`/`height`. */
export const SVG_MAX_DIMENSION = 1600

/**
 * Traços feitos com mouse/toque guardam pressão 0.5 em todos os pontos; só a
 * caneta varia. É daí que sai `simulatePressure` — sem campo extra no formato.
 */
function usesRealPressure(points: readonly SketchPoint[]): boolean {
  for (const p of points) if (p[2] !== 0.5) return true
  return false
}

/**
 * Polígono do outline de um traço. `live` = traço ainda em andamento (a ponta
 * não é finalizada); confirmado usa `last: true`. Os mesmos outlines alimentam o
 * canvas e o preview SVG, então o que se vê no editor é o que fica salvo.
 */
export function strokeOutline(
  stroke: Pick<Stroke, 'points' | 'size'>,
  live = false,
): number[][] {
  return getStroke(stroke.points as unknown as number[][], {
    size: stroke.size,
    thinning: 0.5,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: !usesRealPressure(stroke.points),
    last: !live,
  })
}

// Traços confirmados são imutáveis, então o Path2D nunca invalida: a chave é o
// próprio objeto e some junto com ele quando o traço sai da cena.
const path2dCache = new WeakMap<Stroke, Path2D>()

export function strokePath2D(stroke: Stroke): Path2D {
  let p = path2dCache.get(stroke)
  if (!p) {
    p = new Path2D(outlineToSvgPath(strokeOutline(stroke)))
    path2dCache.set(stroke, p)
  }
  return p
}

/** Path2D do traço em andamento; recalculado a cada frame. */
export function livePath2D(stroke: Pick<Stroke, 'points' | 'size'>): Path2D {
  return new Path2D(outlineToSvgPath(strokeOutline(stroke, true)))
}

export interface SketchSvg {
  svg: string
  width: number
  height: number
}

/**
 * Preview SVG da cena: um `<path>` por traço (os mesmos outlines do canvas),
 * viewBox no bounding box + margem, fundo branco. Sem texto, fonte, estilo, script
 * nem href — não há nada para sanitizar. Cena vazia não gera SVG.
 */
export function sceneToSvg(scene: SketchScene): SketchSvg | null {
  const b = sceneBounds(scene)
  if (!b) return null

  const x = b.minX - SVG_MARGIN
  const y = b.minY - SVG_MARGIN
  const w = b.maxX - b.minX + SVG_MARGIN * 2
  const h = b.maxY - b.minY + SVG_MARGIN * 2
  const k = Math.min(1, SVG_MAX_DIMENSION / Math.max(w, h))
  const width = Math.max(1, Math.round(w * k))
  const height = Math.max(1, Math.round(h * k))
  const n = (v: number) => String(Math.round(v * 100) / 100)

  const paths: string[] = []
  for (const stroke of scene.strokes) {
    const d = outlineToSvgPath(strokeOutline(stroke))
    if (d) paths.push(`<path fill="${stroke.color}" d="${d}"/>`)
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(x)} ${n(y)} ${n(w)} ${n(h)}" width="${width}" height="${height}">` +
    `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="#ffffff"/>` +
    paths.join('') +
    `</svg>`
  return { svg, width, height }
}
