import {
  DEFAULT_STROKE_SIZE,
  MAX_STROKE_SIZE,
  type Bounds,
  type Point2,
  type SketchPoint,
  type Stroke,
} from '../models/Sketch';
import { hitTestStroke, sceneBounds, strokeBounds } from './SketchGeometry';

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Retângulo com os cantos ordenados, a partir de dois pontos em qualquer ordem. */
export function normalizeRect(a: Point2, b: Point2): Bounds {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

/** Algum trecho do segmento cai dentro do retângulo (Liang–Barsky). */
function segmentIntersectsRect(ax: number, ay: number, bx: number, by: number, r: Bounds): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0; // paralelo à aresta: dentro se q >= 0
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return (
    clip(-dx, ax - r.minX) &&
    clip(dx, r.maxX - ax) &&
    clip(-dy, ay - r.minY) &&
    clip(dy, r.maxY - ay)
  );
}

/**
 * O traço é atingido pelo retângulo se a polilinha o TOCA: algum ponto dentro
 * (com meia espessura de folga) ou algum segmento que o cruze. Bounding box
 * inteiro dentro seria restritivo demais para traço à mão livre. Traço de um
 * único ponto é um disco.
 */
export function strokeIntersectsRect(stroke: Stroke, rect: Bounds): boolean {
  const pts = stroke.points;
  if (pts.length === 0) return false;

  const b = strokeBounds(stroke);
  if (b.maxX < rect.minX || b.minX > rect.maxX || b.maxY < rect.minY || b.minY > rect.maxY) {
    return false;
  }

  const half = stroke.size / 2;
  const r: Bounds = {
    minX: rect.minX - half,
    minY: rect.minY - half,
    maxX: rect.maxX + half,
    maxY: rect.maxY + half,
  };
  for (const [x, y] of pts) {
    if (x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY) return true;
  }
  for (let i = 1; i < pts.length; i++) {
    if (segmentIntersectsRect(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], r)) return true;
  }
  return false;
}

/** Ids dos traços atingidos pelo retângulo, na ordem de pintura. */
export function strokesInRect(strokes: readonly Stroke[], rect: Bounds): string[] {
  return strokes.filter((s) => strokeIntersectsRect(s, rect)).map((s) => s.id);
}

/** O traço mais ao topo (o último na ordem de pintura) atingido pelo ponto, ou `null`. */
export function strokeAtPoint(strokes: readonly Stroke[], point: Point2, radius: number): Stroke | null {
  for (let i = strokes.length - 1; i >= 0; i--) {
    if (hitTestStroke(strokes[i], point, radius)) return strokes[i];
  }
  return null;
}

/** Bounding box dos traços selecionados; `null` se a seleção é vazia (ou só tem ids que não existem). */
export function selectionBounds(
  strokes: readonly Stroke[],
  ids: Iterable<string>,
): Bounds | null {
  const set = new Set(ids);
  return sceneBounds(strokes.filter((s) => set.has(s.id)));
}

// ── transformações: puras e imutáveis (devolvem traços novos, mesmo id) ─────

export function translateStrokes(strokes: readonly Stroke[], dx: number, dy: number): Stroke[] {
  return strokes.map((s) => ({
    ...s,
    points: s.points.map(([x, y, p]): SketchPoint => [round1(x + dx), round1(y + dy), p]),
  }));
}

export function recolorStrokes(strokes: readonly Stroke[], color: string): Stroke[] {
  return strokes.map((s) => ({ ...s, color }));
}

export function resizeStrokes(strokes: readonly Stroke[], size: number): Stroke[] {
  const next = Number.isFinite(size) && size > 0 ? Math.min(MAX_STROKE_SIZE, size) : DEFAULT_STROKE_SIZE;
  return strokes.map((s) => ({ ...s, size: next }));
}

/** Cópias deslocadas, com ids novos de `newId`, na mesma ordem relativa. */
export function duplicateStrokes(
  strokes: readonly Stroke[],
  dx: number,
  dy: number,
  newId: () => string,
): Stroke[] {
  return translateStrokes(strokes, dx, dy).map((s) => ({ ...s, id: newId() }));
}
