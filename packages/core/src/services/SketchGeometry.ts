import {
  MAX_ZOOM,
  MIN_ZOOM,
  type Bounds,
  type Point2,
  type SketchScene,
  type Stroke,
  type Viewport,
} from '../models/Sketch';

/** Bounding box de um traço, com meia espessura de folga de cada lado. */
export function strokeBounds(stroke: Stroke): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of stroke.points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const half = stroke.size / 2;
  return { minX: minX - half, minY: minY - half, maxX: maxX + half, maxY: maxY + half };
}

/** Bounding box da cena (ou de uma lista de traços); `null` quando está vazia. */
export function sceneBounds(source: SketchScene | Stroke[]): Bounds | null {
  const strokes = Array.isArray(source) ? source : source.strokes;
  let out: Bounds | null = null;
  for (const s of strokes) {
    if (s.points.length === 0) continue;
    const b = strokeBounds(s);
    out = out
      ? {
          minX: Math.min(out.minX, b.minX),
          minY: Math.min(out.minY, b.minY),
          maxX: Math.max(out.maxX, b.maxX),
          maxY: Math.max(out.maxY, b.maxY),
        }
      : b;
  }
  return out;
}

export function screenToWorld(vp: Viewport, p: Point2): Point2 {
  return { x: (p.x - vp.tx) / vp.scale, y: (p.y - vp.ty) / vp.scale };
}

export function worldToScreen(vp: Viewport, p: Point2): Point2 {
  return { x: p.x * vp.scale + vp.tx, y: p.y * vp.scale + vp.ty };
}

export function clampScale(scale: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

/**
 * Zoom multiplicativo ancorado num ponto da tela: o ponto do mundo que estava sob
 * `anchor` continua sob `anchor`. O fator é aplicado e depois limitado a 0,25–8.
 */
export function zoomAt(vp: Viewport, factor: number, anchor: Point2): Viewport {
  const scale = clampScale(vp.scale * factor);
  const wx = (anchor.x - vp.tx) / vp.scale;
  const wy = (anchor.y - vp.ty) / vp.scale;
  return { scale, tx: anchor.x - wx * scale, ty: anchor.y - wy * scale };
}

/**
 * Viewport de maior zoom em que o bounding box mais `padding` de cada lado cabe em
 * `size`, limitado a 0,25–8, com o bounding box centralizado. Sem bounding box
 * (cena vazia) volta a 100% na origem.
 */
export function fitViewport(
  bounds: Bounds | null,
  size: { width: number; height: number },
  padding: number,
): Viewport {
  if (!bounds || size.width <= 0 || size.height <= 0) return { scale: 1, tx: 0, ty: 0 };
  const bw = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const bh = Math.max(bounds.maxY - bounds.minY, 1e-6);
  const availW = Math.max(1, size.width - padding * 2);
  const availH = Math.max(1, size.height - padding * 2);
  const scale = clampScale(Math.min(availW / bw, availH / bh));
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { scale, tx: size.width / 2 - cx * scale, ty: size.height / 2 - cy * scale };
}

/** Distância de um ponto a um segmento. */
export function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * O traço é atingido se algum ponto da polilinha está a `size/2 + radius` ou menos
 * do ponto. Traço de um ponto só é um disco. O bounding box serve de pré-filtro.
 */
export function hitTestStroke(stroke: Stroke, point: Point2, radius: number): boolean {
  if (stroke.points.length === 0) return false;
  const b = strokeBounds(stroke);
  if (
    point.x < b.minX - radius ||
    point.x > b.maxX + radius ||
    point.y < b.minY - radius ||
    point.y > b.maxY + radius
  ) {
    return false;
  }
  const limit = stroke.size / 2 + radius;
  const pts = stroke.points;
  if (pts.length === 1) return Math.hypot(point.x - pts[0][0], point.y - pts[0][1]) <= limit;
  for (let i = 1; i < pts.length; i++) {
    if (distToSegment(point.x, point.y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) <= limit) {
      return true;
    }
  }
  return false;
}

/** Traços atingidos pela borracha em `point`. */
export function eraseAt(strokes: readonly Stroke[], point: Point2, radius: number): Stroke[] {
  return strokes.filter((s) => hitTestStroke(s, point, radius));
}
