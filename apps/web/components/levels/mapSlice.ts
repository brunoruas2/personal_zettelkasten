import type { GalaxyData } from '../galaxy/useGalaxyData';

/** Teto do recorte usado para enquadrar o botão FOCO. */
export const SLICE_CAP = 400;

export interface MapSlice {
  /** Índices (em `GalaxyData`) das bolinhas desenhadas por inteiro. */
  list: number[];
  mask: Uint8Array;
}

/**
 * Vizinhança do foco: BFS a partir do foco e dos consultados, parando no teto.
 * Sem sementes na base (foco oculto, sem posição), cai nos zettels mais
 * ligados. Serve só ao enquadramento da câmera; o mapa desenha tudo.
 */
export function computeSlice(data: GalaxyData, seeds: number[], cap = SLICE_CAP): MapSlice {
  const mask = new Uint8Array(data.count);
  const list: number[] = [];
  const queue: number[] = [];
  const push = (i: number) => {
    if (mask[i] || list.length >= cap) return;
    mask[i] = 1;
    list.push(i);
    queue.push(i);
  };
  for (const s of seeds) push(s);
  if (list.length === 0) {
    for (const i of data.labelOrder) {
      push(i);
      if (list.length >= cap) break;
    }
    return { list, mask };
  }
  for (let q = 0; q < queue.length && list.length < cap; q++) {
    for (const n of data.adjacency[queue[q]]) {
      push(n);
      if (list.length >= cap) break;
    }
  }
  return { list, mask };
}

/** Todos os zettels posicionados e visíveis: é o que o mapa desenha. */
export function allSlice(data: GalaxyData): MapSlice {
  const mask = new Uint8Array(data.count).fill(1);
  const list = Array.from({ length: data.count }, (_, i) => i);
  return { list, mask };
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundsOf(data: GalaxyData, indices: number[]): Box | null {
  if (indices.length === 0) return null;
  let b: Box | null = null;
  for (const i of indices) {
    const x = data.xs[i];
    const y = data.ys[i];
    if (!b) b = { minX: x, minY: y, maxX: x, maxY: y };
    else {
      if (x < b.minX) b.minX = x;
      if (y < b.minY) b.minY = y;
      if (x > b.maxX) b.maxX = x;
      if (y > b.maxY) b.maxY = y;
    }
  }
  return b;
}

export interface View {
  cx: number;
  cy: number;
  scale: number;
}

const MIN_SCALE = 0.0004;
const MAX_SCALE = 1.2;

export function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

/** Câmera que enquadra `box` com margem em px; nunca ultrapassa 0,5 (bolinhas próximas não explodem). */
export function fitView(box: Box | null, w: number, h: number, margin = 70): View {
  if (!box || w <= 0 || h <= 0) return { cx: 0, cy: 0, scale: 0.2 };
  const bw = Math.max(1, box.maxX - box.minX);
  const bh = Math.max(1, box.maxY - box.minY);
  const scale = clampScale(Math.min(0.5, (w - margin * 2) / bw, (h - margin * 2) / bh));
  return { cx: (box.minX + box.maxX) / 2, cy: (box.minY + box.maxY) / 2, scale };
}
