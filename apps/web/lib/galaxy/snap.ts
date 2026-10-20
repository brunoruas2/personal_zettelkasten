import { SpatialGrid, placeNear, type Point } from '@zettelkasten/core';
import { positionStore } from '../positionSync';

/**
 * Vaga livre mais próxima de `world`, considerando todas as posições —
 * inclusive de zettels ocultos por tag, que ocupam espaço mesmo sem aparecer.
 * `excludeId` é o próprio card sendo movido (a vaga dele conta como livre).
 */
export async function snapPosition(world: Point, excludeId?: string): Promise<Point> {
  const grid = new SpatialGrid();
  for (const r of await positionStore.getAll()) {
    if (r.id !== excludeId) grid.add(r.id, r);
  }
  return placeNear(world, grid);
}
