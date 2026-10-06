/**
 * Cena de um desenho à mão livre (`zk-sketch`). Formato JSON guardado em
 * `DrawingRecord.scene`; o preview SVG sai dos mesmos traços. Tudo aqui é puro:
 * nada de DOM, nem da lib de outline (que mora em apps/web).
 */

export const SKETCH_TYPE = 'zk-sketch';
export const SKETCH_VERSION = 1;

/** Cena do editor antigo (Excalidraw): só o preview SVG vale, o editor não a abre. */
export const LEGACY_SCENE_TYPE = 'excalidraw';

export const MAX_STROKES = 5000;
export const MAX_POINTS_PER_STROKE = 20000;
export const MAX_COORD = 1_000_000;
export const MAX_STROKE_SIZE = 64;
export const DEFAULT_STROKE_SIZE = 4;
export const DEFAULT_COLOR = '#1e1e1e';

export const SKETCH_COLORS = [
  '#1e1e1e', // preto
  '#e03131', // vermelho
  '#2f9e44', // verde
  '#1971c2', // azul
  '#f08c00', // laranja
  '#9c36b5', // roxo
] as const;

/** Espessuras em unidades do mundo (px de CSS com zoom 1). */
export const SKETCH_SIZES = [2, 4, 8] as const;

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 8;

/** [x, y, pressão] — x/y no espaço do mundo, pressão em [0, 1]. */
export type SketchPoint = [number, number, number];

export interface Stroke {
  id: string;
  tool: 'pen';
  color: string;
  size: number;
  points: SketchPoint[];
}

export interface SketchScene {
  type: typeof SKETCH_TYPE;
  version: typeof SKETCH_VERSION;
  strokes: Stroke[];
}

/** Tela = mundo × scale + (tx, ty). */
export interface Viewport {
  scale: number;
  tx: number;
  ty: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Point2 {
  x: number;
  y: number;
}
