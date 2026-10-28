import type { ZettelMeta } from '../models/Zettel';

/**
 * Relacionados de um zettel, só por metadados (sem corpos):
 *  - tags em comum (peso 2 por tag, ignorando as excluídas do mapa);
 *  - vizinhos em comum, isto é, ligados ao mesmo terceiro (peso 1,5 por vizinho);
 *  - proximidade espacial na galáxia (peso 0,5 para os vizinhos mais próximos).
 * Exclui o próprio zettel e os vizinhos diretos por link (já aparecem no
 * rodapé de links). Puro, sem browser; roda sob demanda para um zettel.
 */

export const RELATED_LIMIT = 5;
const TAG_WEIGHT = 2;
const COMMON_WEIGHT = 1.5;
const NEAR_WEIGHT = 0.5;

export interface Related {
  id: string;
  score: number;
  /** Tags em comum. */
  sharedTags: number;
  /** Vizinhos em comum (2º grau). */
  commonNeighbors: number;
  /** Mora perto na galáxia. */
  near: boolean;
}

export interface RelatedInput {
  id: string;
  /** Índice visível (o que a galáxia mostra). */
  metas: ZettelMeta[];
  /** Vizinhos por link, sem direção: quem o zettel cita e quem o cita. */
  neighborsOf: (id: string) => string[];
  /** Zettels mais próximos no mapa (ids), do mais perto ao mais longe. */
  spatialNeighbors?: string[];
  /** Tags que não contam (excluídas do mapa). */
  excludedTags?: string[];
  limit?: number;
}

export function relatedZettels(input: RelatedInput): Related[] {
  const { id, metas, neighborsOf, spatialNeighbors = [], limit = RELATED_LIMIT } = input;
  const excluded = new Set(input.excludedTags ?? []);
  const self = metas.find((m) => m.id === id);
  if (!self) return [];

  const direct = new Set(neighborsOf(id));
  const known = new Map(metas.map((m) => [m.id, m]));
  const acc = new Map<string, Related>();
  const touch = (otherId: string): Related | null => {
    if (otherId === id || direct.has(otherId) || !known.has(otherId)) return null;
    let r = acc.get(otherId);
    if (!r) {
      r = { id: otherId, score: 0, sharedTags: 0, commonNeighbors: 0, near: false };
      acc.set(otherId, r);
    }
    return r;
  };

  const myTags = new Set(self.tags.filter((t) => !excluded.has(t)));
  if (myTags.size > 0) {
    for (const m of metas) {
      if (m.id === id) continue;
      let shared = 0;
      for (const t of m.tags) if (myTags.has(t)) shared++;
      if (shared === 0) continue;
      const r = touch(m.id);
      if (r) r.sharedTags = shared;
    }
  }

  const common = new Map<string, number>();
  for (const n of direct) {
    for (const m of neighborsOf(n)) common.set(m, (common.get(m) ?? 0) + 1);
  }
  for (const [otherId, count] of common) {
    const r = touch(otherId);
    if (r) r.commonNeighbors = count;
  }

  for (const otherId of spatialNeighbors) {
    const r = touch(otherId);
    if (r) r.near = true;
  }

  const out: Related[] = [];
  for (const r of acc.values()) {
    r.score = r.sharedTags * TAG_WEIGHT + r.commonNeighbors * COMMON_WEIGHT + (r.near ? NEAR_WEIGHT : 0);
    if (r.score > 0) out.push(r);
  }
  out.sort(
    (a, b) =>
      b.score - a.score ||
      (known.get(b.id)!.updatedAt - known.get(a.id)!.updatedAt) ||
      (a.id < b.id ? -1 : 1),
  );
  return out.slice(0, limit);
}
