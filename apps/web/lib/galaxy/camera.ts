/**
 * Câmera da galáxia: `(x, y)` é o ponto do mundo no centro do viewport e
 * `scale` é px de tela por unidade de mundo. O teto acima de 1 prepara o zoom
 * de leitura dos cards (change galaxy-cards).
 */
export interface Camera {
  x: number;
  y: number;
  scale: number;
}

export const MAX_SCALE = 1.5;
const ABSOLUTE_MIN_SCALE = 0.0005;
const STORAGE_KEY = 'zettel_galaxy_camera';

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function worldToScreen(cam: Camera, w: number, h: number, wx: number, wy: number): [number, number] {
  return [(wx - cam.x) * cam.scale + w / 2, (wy - cam.y) * cam.scale + h / 2];
}

export function screenToWorld(cam: Camera, w: number, h: number, sx: number, sy: number): [number, number] {
  return [(sx - w / 2) / cam.scale + cam.x, (sy - h / 2) / cam.scale + cam.y];
}

export function clampScale(scale: number, minScale: number): number {
  return Math.min(MAX_SCALE, Math.max(minScale, scale));
}

/** Zoom ancorado: o ponto do mundo sob (sx, sy) continua sob (sx, sy). */
export function zoomAt(cam: Camera, w: number, h: number, sx: number, sy: number, factor: number, minScale: number): Camera {
  const scale = clampScale(cam.scale * factor, minScale);
  const [wx, wy] = screenToWorld(cam, w, h, sx, sy);
  return {
    scale,
    x: wx - (sx - w / 2) / scale,
    y: wy - (sy - h / 2) / scale,
  };
}

/** Câmera que enquadra o bbox com margem (px de tela). */
export function fitBox(box: BBox, w: number, h: number, margin = 80): Camera {
  const bw = Math.max(1, box.maxX - box.minX);
  const bh = Math.max(1, box.maxY - box.minY);
  const scale = Math.min(MAX_SCALE, Math.max(ABSOLUTE_MIN_SCALE, Math.min((w - margin * 2) / bw, (h - margin * 2) / bh)));
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2, scale };
}

/** Menor zoom permitido: metade do "Ver tudo", para sobrar folga ao redor. */
export function minScaleFor(box: BBox | null, w: number, h: number): number {
  if (!box || w === 0 || h === 0) return ABSOLUTE_MIN_SCALE;
  return Math.max(ABSOLUTE_MIN_SCALE, fitBox(box, w, h).scale / 2);
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function loadCamera(): Camera | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Camera;
    if ([c.x, c.y, c.scale].every((n) => typeof n === 'number' && Number.isFinite(n)) && c.scale > 0) return c;
  } catch {
    // indisponível ou corrompido — começa em "Ver tudo"
  }
  return null;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Grava com debounce: a câmera muda a cada frame durante pan/zoom. */
export function saveCamera(cam: Camera): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: cam.x, y: cam.y, scale: cam.scale }));
    } catch {
      // sem persistência — vale só nesta sessão
    }
  }, 500);
}
