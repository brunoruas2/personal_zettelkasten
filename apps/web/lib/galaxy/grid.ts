/**
 * Grade espacial dos pontos da galáxia, para culling e hit test. As posições
 * são imutáveis (só mudam por reconstrução dos dados), então uma grade de
 * células fixas é mais simples e previsível que uma quadtree.
 */

export const GRID_CELL = 2048;

export class GalaxyGrid {
  private cells = new Map<string, number[]>();

  constructor(
    private readonly xs: Float64Array,
    private readonly ys: Float64Array,
    count: number,
  ) {
    for (let i = 0; i < count; i++) {
      const k = GalaxyGrid.key(Math.floor(xs[i] / GRID_CELL), Math.floor(ys[i] / GRID_CELL));
      let cell = this.cells.get(k);
      if (!cell) {
        cell = [];
        this.cells.set(k, cell);
      }
      cell.push(i);
    }
  }

  private static key(cx: number, cy: number): string {
    return `${cx},${cy}`;
  }

  /** Células não vazias que cruzam o retângulo (coordenadas de mundo). */
  forEachCell(minX: number, minY: number, maxX: number, maxY: number, cb: (indices: number[], cx: number, cy: number) => void): void {
    const cx0 = Math.floor(minX / GRID_CELL);
    const cy0 = Math.floor(minY / GRID_CELL);
    const cx1 = Math.floor(maxX / GRID_CELL);
    const cy1 = Math.floor(maxY / GRID_CELL);
    const span = (cx1 - cx0 + 1) * (cy1 - cy0 + 1);
    // Zoom bem afastado: o retângulo cobre mais células do que existem
    // ocupadas — percorre as ocupadas em vez do retângulo inteiro.
    if (span > this.cells.size) {
      for (const [k, indices] of this.cells) {
        const comma = k.indexOf(',');
        const cx = Number(k.slice(0, comma));
        const cy = Number(k.slice(comma + 1));
        if (cx >= cx0 && cx <= cx1 && cy >= cy0 && cy <= cy1) cb(indices, cx, cy);
      }
      return;
    }
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const indices = this.cells.get(GalaxyGrid.key(cx, cy));
        if (indices) cb(indices, cx, cy);
      }
    }
  }

  /** Índices dentro do retângulo, acrescentados em `out`. */
  query(minX: number, minY: number, maxX: number, maxY: number, out: number[]): number[] {
    this.forEachCell(minX, minY, maxX, maxY, (indices) => {
      for (const i of indices) {
        const x = this.xs[i];
        const y = this.ys[i];
        if (x >= minX && x <= maxX && y >= minY && y <= maxY) out.push(i);
      }
    });
    return out;
  }

  /** O ponto mais próximo de (px, py) dentro de `radius` (mundo), ou -1. */
  nearest(px: number, py: number, radius: number): number {
    let best = -1;
    let bestD = radius * radius;
    this.forEachCell(px - radius, py - radius, px + radius, py + radius, (indices) => {
      for (const i of indices) {
        const dx = this.xs[i] - px;
        const dy = this.ys[i] - py;
        const d = dx * dx + dy * dy;
        if (d <= bestD) {
          bestD = d;
          best = i;
        }
      }
    });
    return best;
  }
}
