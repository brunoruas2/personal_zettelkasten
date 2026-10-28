import { describe, expect, it } from 'vitest';
import type { ZettelMeta } from '../models/Zettel';
import { relatedZettels } from './RelatedZettels';

const meta = (id: string, tags: string[] = [], updatedAt = 1): ZettelMeta => ({
  id,
  title: id,
  tags,
  createdAt: 1,
  updatedAt,
  bodyLen: 0,
  bodyAt: updatedAt,
});

/** Grafo não direcionado a partir de pares. */
function graph(pairs: [string, string][]) {
  const adj = new Map<string, Set<string>>();
  for (const [a, b] of pairs) {
    (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
    (adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a);
  }
  return (id: string) => [...(adj.get(id) ?? [])];
}

describe('relatedZettels', () => {
  it('ordena por tags em comum', () => {
    const metas = [meta('A', ['igreja', 'ipv']), meta('B', ['igreja', 'ipv']), meta('C', ['igreja'])];
    const out = relatedZettels({ id: 'A', metas, neighborsOf: graph([]) });
    expect(out.map((r) => r.id)).toEqual(['B', 'C']);
    expect(out[0].sharedTags).toBe(2);
  });

  it('exclui os vizinhos diretos', () => {
    const metas = [meta('A', ['x']), meta('B', ['x'])];
    expect(relatedZettels({ id: 'A', metas, neighborsOf: graph([['A', 'B']]) })).toEqual([]);
  });

  it('conta vizinhos em comum (2º grau)', () => {
    const metas = [meta('A'), meta('B'), meta('C'), meta('D')];
    // A–B, B–C, B–D  →  C e D são vizinhos de B, que é vizinho de A.
    const out = relatedZettels({
      id: 'A',
      metas,
      neighborsOf: graph([['A', 'B'], ['B', 'C'], ['B', 'D']]),
    });
    expect(out.map((r) => r.id).sort()).toEqual(['C', 'D']);
    expect(out[0].commonNeighbors).toBe(1);
  });

  it('soma a proximidade espacial com peso menor', () => {
    const metas = [meta('A', ['x']), meta('B', ['x']), meta('C')];
    const out = relatedZettels({ id: 'A', metas, neighborsOf: graph([]), spatialNeighbors: ['C', 'B'] });
    expect(out.map((r) => r.id)).toEqual(['B', 'C']);
    expect(out[1].near).toBe(true);
    expect(out[1].score).toBe(0.5);
  });

  it('ignora tags excluídas do mapa', () => {
    const metas = [meta('A', ['oculta']), meta('B', ['oculta'])];
    expect(relatedZettels({ id: 'A', metas, neighborsOf: graph([]), excludedTags: ['oculta'] })).toEqual([]);
  });

  it('empata por updatedAt decrescente', () => {
    const metas = [meta('A', ['x']), meta('B', ['x'], 1), meta('C', ['x'], 9)];
    const out = relatedZettels({ id: 'A', metas, neighborsOf: graph([]) });
    expect(out.map((r) => r.id)).toEqual(['C', 'B']);
  });

  it('respeita o teto', () => {
    const metas = [meta('A', ['x']), ...Array.from({ length: 20 }, (_, i) => meta(`Z${i}`, ['x']))];
    expect(relatedZettels({ id: 'A', metas, neighborsOf: graph([]) })).toHaveLength(5);
    expect(relatedZettels({ id: 'A', metas, neighborsOf: graph([]), limit: 3 })).toHaveLength(3);
  });

  it('sem sinal ou id desconhecido devolve vazio', () => {
    expect(relatedZettels({ id: 'A', metas: [meta('A'), meta('B')], neighborsOf: graph([]) })).toEqual([]);
    expect(relatedZettels({ id: 'nada', metas: [meta('A')], neighborsOf: graph([]) })).toEqual([]);
  });
});
