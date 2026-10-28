import { CARD_WIDTH } from '@zettelkasten/core';
import type { GalaxyData } from '../../components/galaxy/useGalaxyData';

/**
 * Zettels mais próximos de `id` no mapa (ids, do mais perto ao mais longe).
 * Usa a grade espacial: alarga a busca em anéis até achar `k` vizinhos, então
 * o custo não depende do total de zettels.
 */
export function spatialNeighborIds(d: GalaxyData, id: string, k = 8): string[] {
  const i = d.indexById.get(id);
  if (i === undefined) return [];
  const x = d.xs[i];
  const y = d.ys[i];
  let radius = CARD_WIDTH * 2;
  let found: number[] = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    found = d.grid.query(x - radius, y - radius, x + radius, y + radius, []).filter((j) => j !== i);
    if (found.length >= k) break;
    radius *= 2;
  }
  found.sort((a, b) => (d.xs[a] - x) ** 2 + (d.ys[a] - y) ** 2 - ((d.xs[b] - x) ** 2 + (d.ys[b] - y) ** 2));
  return found.slice(0, k).map((j) => d.ids[j]);
}
