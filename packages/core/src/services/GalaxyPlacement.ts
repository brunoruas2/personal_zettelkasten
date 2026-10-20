import type { Link } from '../models/Link';
import { FOOTPRINT_H, FOOTPRINT_W, footprintsOverlap, type Point } from '../models/GalaxyPosition';

/**
 * Grade espacial com células do tamanho da pegada. Duas pegadas só podem se
 * intersectar se os centros caem em células vizinhas (±1), então `isFree`
 * consulta 9 células, independente do tamanho da base.
 */
export class SpatialGrid {
  private cells = new Map<string, Map<string, Point>>();

  private static key(cx: number, cy: number): string {
    return `${cx},${cy}`;
  }

  private static cellOf(p: Point): [number, number] {
    return [Math.floor(p.x / FOOTPRINT_W), Math.floor(p.y / FOOTPRINT_H)];
  }

  add(id: string, p: Point): void {
    const [cx, cy] = SpatialGrid.cellOf(p);
    const k = SpatialGrid.key(cx, cy);
    let cell = this.cells.get(k);
    if (!cell) {
      cell = new Map();
      this.cells.set(k, cell);
    }
    cell.set(id, { x: p.x, y: p.y });
  }

  remove(id: string, p: Point): void {
    const [cx, cy] = SpatialGrid.cellOf(p);
    const k = SpatialGrid.key(cx, cy);
    const cell = this.cells.get(k);
    if (!cell) return;
    cell.delete(id);
    if (cell.size === 0) this.cells.delete(k);
  }

  /** A pegada centrada em `p` não intersecta nenhuma pegada da grade. */
  isFree(p: Point): boolean {
    const [cx, cy] = SpatialGrid.cellOf(p);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cell = this.cells.get(SpatialGrid.key(cx + dx, cy + dy));
        if (!cell) continue;
        for (const q of cell.values()) {
          if (footprintsOverlap(p, q)) return false;
        }
      }
    }
    return true;
  }
}

// Candidatos em meia pegada: encaixa melhor entre posições que não estão
// alinhadas à grade (as do layout congelado não estão).
const STEP_X = FOOTPRINT_W / 2;
const STEP_Y = FOOTPRINT_H / 2;
const MIN_STEP = Math.min(STEP_X, STEP_Y);
const MAX_RINGS = 20_000;

/**
 * Vaga livre mais próxima de `anchor`, entre os pontos de uma rede de meia
 * pegada centrada nele. Percorre anéis (Chebyshev) e para quando nenhum ponto
 * do próximo anel pode ser mais próximo que a melhor vaga já achada. Empate
 * de distância desempata por `j` e depois `i`, então o resultado é
 * determinístico.
 */
export function placeNear(anchor: Point, grid: SpatialGrid): Point {
  const ax = Math.round(anchor.x);
  const ay = Math.round(anchor.y);
  let best: Point | null = null;
  let bestD = Infinity;
  let bestJ = 0;
  let bestI = 0;

  for (let r = 0; r <= MAX_RINGS; r++) {
    if (best && r * MIN_STEP > Math.sqrt(bestD)) break;
    for (let j = -r; j <= r; j++) {
      for (let i = -r; i <= r; i++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
        const dx = i * STEP_X;
        const dy = j * STEP_Y;
        const d = dx * dx + dy * dy;
        if (d > bestD) continue;
        if (d === bestD && (j > bestJ || (j === bestJ && i > bestI))) continue;
        const p = { x: ax + dx, y: ay + dy };
        if (!grid.isFree(p)) continue;
        best = p;
        bestD = d;
        bestJ = j;
        bestI = i;
      }
    }
  }
  // Só acontece com uma base absurdamente maior que 20k anéis; cai no anel
  // seguinte em vez de devolver uma posição sobreposta.
  return best ?? { x: ax + (MAX_RINGS + 1) * STEP_X, y: ay };
}

/** Vizinhos (sem direção) de cada id. */
export function buildAdjacency(links: Link[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    let s = adj.get(a);
    if (!s) {
      s = new Set();
      adj.set(a, s);
    }
    s.add(b);
  };
  for (const l of links) {
    if (l.sourceId === l.targetId) continue;
    add(l.sourceId, l.targetId);
    add(l.targetId, l.sourceId);
  }
  return adj;
}

/** Centróide dos vizinhos já posicionados, ou a origem. */
export function anchorFor(
  id: string,
  adjacency: Map<string, Set<string>>,
  positions: Map<string, Point>,
): Point {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const nb of adjacency.get(id) ?? []) {
    const p = positions.get(nb);
    if (!p) continue;
    sx += p.x;
    sy += p.y;
    n++;
  }
  return n === 0 ? { x: 0, y: 0 } : { x: sx / n, y: sy / n };
}

/**
 * Posiciona os zettels sem posição, em ordem de `createdAt` crescente (id
 * desempata). Cada um entra na grade e no mapa antes do próximo, então um
 * lote importado e ligado entre si se agrupa. Não altera `positions`; devolve
 * só as novas.
 */
export function placeMissing(
  zettels: { id: string; createdAt: number }[],
  links: Link[],
  positions: Map<string, Point>,
): Map<string, Point> {
  const missing = zettels
    .filter((z) => !positions.has(z.id))
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const placed = new Map<string, Point>();
  if (missing.length === 0) return placed;

  const all = new Map(positions);
  const grid = new SpatialGrid();
  for (const [id, p] of positions) grid.add(id, p);
  const adjacency = buildAdjacency(links);

  for (const z of missing) {
    const p = placeNear(anchorFor(z.id, adjacency, all), grid);
    grid.add(z.id, p);
    all.set(z.id, p);
    placed.set(z.id, p);
  }
  return placed;
}
