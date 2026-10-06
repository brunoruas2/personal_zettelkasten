import {
  DEFAULT_COLOR,
  DEFAULT_STROKE_SIZE,
  LEGACY_SCENE_TYPE,
  MAX_COORD,
  MAX_POINTS_PER_STROKE,
  MAX_STROKE_SIZE,
  MAX_STROKES,
  SKETCH_TYPE,
  SKETCH_VERSION,
  type SketchPoint,
  type SketchScene,
  type Stroke,
} from '../models/Sketch';

export type ParsedScene =
  | { kind: 'scene'; scene: SketchScene }
  | { kind: 'legacy' }
  | { kind: 'error'; reason: 'invalid-json' | 'unknown-type' | 'bad-version' | 'future-version' | 'bad-strokes' };

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function emptyScene(): SketchScene {
  return { type: SKETCH_TYPE, version: SKETCH_VERSION, strokes: [] };
}

function normalizePoint(raw: unknown): SketchPoint | null {
  if (!Array.isArray(raw)) return null;
  const [x, y, p] = raw;
  if (!isNum(x) || !isNum(y) || Math.abs(x) > MAX_COORD || Math.abs(y) > MAX_COORD) return null;
  // Pressão ausente ou inválida vira 0.5 (mouse/toque, que o renderer simula).
  const pressure = isNum(p) ? Math.min(1, Math.max(0, p)) : 0.5;
  return [round1(x), round1(y), round2(pressure)];
}

function normalizeStroke(raw: unknown, index: number): Stroke | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (s.tool !== 'pen') return null;
  if (!Array.isArray(s.points)) return null;

  const points: SketchPoint[] = [];
  for (const rawPoint of s.points) {
    if (points.length >= MAX_POINTS_PER_STROKE) break;
    const p = normalizePoint(rawPoint);
    if (p) points.push(p);
  }
  if (points.length === 0) return null;

  const size = isNum(s.size) && s.size > 0 ? Math.min(MAX_STROKE_SIZE, s.size) : DEFAULT_STROKE_SIZE;
  return {
    id: typeof s.id === 'string' && s.id ? s.id : `s${index}`,
    tool: 'pen',
    color: typeof s.color === 'string' && COLOR_RE.test(s.color) ? s.color.toLowerCase() : DEFAULT_COLOR,
    size,
    points,
  };
}

/**
 * Lê e normaliza uma cena. Rejeita JSON inválido, tipo desconhecido e versão
 * futura (em vez de adivinhar um formato que não conhece); devolve `legacy` para
 * cenas do Excalidraw, que o editor não abre.
 */
export function parseSketchScene(json: string): ParsedScene {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { kind: 'error', reason: 'invalid-json' };
  }
  if (!data || typeof data !== 'object') return { kind: 'error', reason: 'invalid-json' };
  const d = data as Record<string, unknown>;

  if (d.type === LEGACY_SCENE_TYPE) return { kind: 'legacy' };
  if (d.type !== SKETCH_TYPE) return { kind: 'error', reason: 'unknown-type' };
  if (!isNum(d.version) || d.version < 1) return { kind: 'error', reason: 'bad-version' };
  if (d.version > SKETCH_VERSION) return { kind: 'error', reason: 'future-version' };
  if (!Array.isArray(d.strokes)) return { kind: 'error', reason: 'bad-strokes' };

  const strokes: Stroke[] = [];
  d.strokes.forEach((raw, i) => {
    if (strokes.length >= MAX_STROKES) return;
    const stroke = normalizeStroke(raw, i);
    if (stroke) strokes.push(stroke);
  });
  return { kind: 'scene', scene: { type: SKETCH_TYPE, version: SKETCH_VERSION, strokes } };
}

/** JSON da cena, já normalizado (coordenadas a 1 casa, pressão a 2). */
export function serializeSketchScene(scene: SketchScene): string {
  const strokes = scene.strokes.map((s) => ({
    id: s.id,
    tool: s.tool,
    color: s.color,
    size: s.size,
    points: s.points.map(([x, y, p]) => [round1(x), round1(y), round2(p)]),
  }));
  return JSON.stringify({ type: SKETCH_TYPE, version: SKETCH_VERSION, strokes });
}

/** Id curto de traço; não precisa ser global, só único dentro da cena. */
export function newStrokeId(): string {
  return Math.random().toString(36).slice(2, 10).padEnd(8, '0');
}
