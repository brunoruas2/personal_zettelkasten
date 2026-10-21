import { describe, expect, it } from 'vitest';
import type { Link } from '../models/Link';
import { FOOTPRINT_H, FOOTPRINT_W, footprintsOverlap, type Point } from '../models/GalaxyPosition';
import { SpatialGrid, anchorFor, buildAdjacency, placeMissing, placeNear } from './GalaxyPlacement';
import { freezeLayout, resolveOverlaps, simulateLayout } from './GalaxyLayout';

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function overlappingPairs(positions: Map<string, Point>): number {
  const list = [...positions.values()];
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (footprintsOverlap(list[i], list[j])) n++;
    }
  }
  return n;
}

function randomGraph(n: number, edges: number, seed: number): { ids: string[]; links: Link[] } {
  const rnd = lcg(seed);
  const ids = Array.from({ length: n }, (_, i) => `z${String(i).padStart(5, '0')}`);
  const links: Link[] = [];
  for (let i = 0; i < edges; i++) {
    links.push({ sourceId: ids[Math.floor(rnd() * n)], targetId: ids[Math.floor(rnd() * n)] });
  }
  return { ids, links };
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Componente conexo: árvore aleatória + arestas extras, ids com prefixo. */
function connectedGraph(prefix: string, n: number, extra: number, seed: number): { ids: string[]; links: Link[] } {
  const rnd = lcg(seed);
  const ids = Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(5, '0')}`);
  const links: Link[] = [];
  for (let i = 1; i < n; i++) links.push({ sourceId: ids[i], targetId: ids[Math.floor(rnd() * i)] });
  for (let i = 0; i < extra; i++) {
    links.push({ sourceId: ids[Math.floor(rnd() * n)], targetId: ids[Math.floor(rnd() * n)] });
  }
  return { ids, links };
}

function aspect(points: Point[]): number {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return (Math.max(...xs) - Math.min(...xs)) / (Math.max(...ys) - Math.min(...ys));
}

function centroid(points: Point[]): Point {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

const FOOTPRINT_DIAGONAL = Math.hypot(FOOTPRINT_W, FOOTPRINT_H);

describe('SpatialGrid / placeNear', () => {
  it('vaga numa grade vazia é a própria âncora arredondada', () => {
    expect(placeNear({ x: 10.4, y: -3.6 }, new SpatialGrid())).toEqual({ x: 10, y: -4 });
  });

  it('é determinístico', () => {
    const grid = new SpatialGrid();
    grid.add('a', { x: 0, y: 0 });
    expect(placeNear({ x: 0, y: 0 }, grid)).toEqual(placeNear({ x: 0, y: 0 }, grid));
  });

  it('500 posicionamentos aleatórios não se sobrepõem', () => {
    const rnd = lcg(7);
    const grid = new SpatialGrid();
    const all = new Map<string, Point>();
    for (let i = 0; i < 500; i++) {
      const p = placeNear({ x: (rnd() - 0.5) * 8000, y: (rnd() - 0.5) * 8000 }, grid);
      grid.add(`n${i}`, p);
      all.set(`n${i}`, p);
    }
    expect(overlappingPairs(all)).toBe(0);
  });

  it('reusa a vaga liberada', () => {
    const grid = new SpatialGrid();
    grid.add('a', { x: 0, y: 0 });
    grid.remove('a', { x: 0, y: 0 });
    expect(placeNear({ x: 0, y: 0 }, grid)).toEqual({ x: 0, y: 0 });
  });

  it('busca local continua rápida com 50k ocupados', () => {
    const grid = new SpatialGrid();
    for (let i = 0; i < 50_000; i++) {
      grid.add(`n${i}`, { x: (i % 250) * FOOTPRINT_W, y: Math.floor(i / 250) * FOOTPRINT_H });
    }
    const t0 = performance.now();
    // Âncora numa região vazia ao lado da massa: poucos anéis.
    const p = placeNear({ x: -3 * FOOTPRINT_W, y: 0 }, grid);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(grid.isFree(p)).toBe(true);
  });
});

describe('anchorFor / placeMissing', () => {
  it('âncora é o centróide dos vizinhos posicionados', () => {
    const adj = buildAdjacency([
      { sourceId: 'n', targetId: 'a' },
      { sourceId: 'b', targetId: 'n' },
      { sourceId: 'n', targetId: 'semPosicao' },
    ]);
    const positions = new Map<string, Point>([
      ['a', { x: 0, y: 0 }],
      ['b', { x: 2000, y: 1000 }],
    ]);
    expect(anchorFor('n', adj, positions)).toEqual({ x: 1000, y: 500 });
  });

  it('órfão vai para perto da origem', () => {
    const placed = placeMissing([{ id: 'o', createdAt: 1 }], [], new Map([['x', { x: 50_000, y: 0 }]]));
    expect(placed.get('o')).toEqual({ x: 0, y: 0 });
  });

  it('não reposiciona quem já tem posição', () => {
    const positions = new Map<string, Point>([['a', { x: 5, y: 5 }]]);
    const placed = placeMissing([{ id: 'a', createdAt: 1 }], [], positions);
    expect(placed.size).toBe(0);
  });

  it('lote importado e ligado fica agrupado perto do vizinho existente', () => {
    const anchor = { x: 40_000, y: -20_000 };
    const positions = new Map<string, Point>([
      ['hub', anchor],
      ['longe', { x: -40_000, y: 0 }],
    ]);
    const zettels = ['l1', 'l2', 'l3', 'l4'].map((id, i) => ({ id, createdAt: i }));
    const links: Link[] = [
      { sourceId: 'l1', targetId: 'hub' },
      { sourceId: 'l2', targetId: 'l1' },
      { sourceId: 'l3', targetId: 'l2' },
      { sourceId: 'l4', targetId: 'l3' },
    ];
    const placed = placeMissing(zettels, links, positions);
    for (const p of placed.values()) expect(dist(p, anchor)).toBeLessThan(4 * FOOTPRINT_H);
    expect(overlappingPairs(new Map([...positions, ...placed]))).toBe(0);
  });
});

describe('freezeLayout', () => {
  it('mesma entrada em ordens diferentes dá saída idêntica', () => {
    const { ids, links } = randomGraph(60, 80, 3);
    const a = freezeLayout(ids, links);
    const b = freezeLayout([...ids].reverse(), [...links].reverse());
    expect([...b.entries()].sort()).toEqual([...a.entries()].sort());
  });

  it.each([1, 2, 50, 1000])('zero sobreposição com %i nós', (n) => {
    const { ids, links } = randomGraph(n, Math.floor(n * 1.2), n);
    const out = freezeLayout(ids, links);
    expect(out.size).toBe(n);
    expect(overlappingPairs(out)).toBe(0);
    for (const p of out.values()) {
      expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true);
    }
  }, 60_000);

  it('vizinhos ficam mais perto que a média dos não vizinhos', () => {
    // Dois aglomerados densos e separados.
    const ids = Array.from({ length: 20 }, (_, i) => `n${String(i).padStart(2, '0')}`);
    const links: Link[] = [];
    for (let i = 0; i < 10; i++) for (let j = i + 1; j < 10; j++) links.push({ sourceId: ids[i], targetId: ids[j] });
    for (let i = 10; i < 20; i++) for (let j = i + 1; j < 20; j++) links.push({ sourceId: ids[i], targetId: ids[j] });
    const out = freezeLayout(ids, links);
    let inside = 0;
    let across = 0;
    let ni = 0;
    let na = 0;
    for (let i = 0; i < 20; i++) {
      for (let j = i + 1; j < 20; j++) {
        const d = dist(out.get(ids[i])!, out.get(ids[j])!);
        if ((i < 10) === (j < 10)) { inside += d; ni++; } else { across += d; na++; }
      }
    }
    expect(inside / ni).toBeLessThan(across / na);
  });

  it('componente grande ocupa região aproximadamente circular', () => {
    const { ids, links } = connectedGraph('a', 300, 60, 11);
    const r = aspect([...freezeLayout(ids, links).values()]);
    expect(r).toBeGreaterThan(0.75);
    expect(r).toBeLessThan(1.33);
  }, 60_000);

  it.each([
    [250, 12],
    [1000, 13],
  ])('mediana da distância ao vizinho mais próximo fica perto de uma pegada (%i nós)', (n, seed) => {
    const { ids, links } = connectedGraph('a', n, Math.floor(n / 5), seed);
    const pts = [...freezeLayout(ids, links).values()];
    const nn = pts
      .map((p, i) => Math.min(...pts.map((q, j) => (i === j ? Infinity : dist(p, q)))))
      .sort((a, b) => a - b);
    const median = nn[Math.floor(nn.length / 2)];
    expect(median).toBeGreaterThan(0.7 * FOOTPRINT_DIAGONAL);
    expect(median).toBeLessThan(1.2 * FOOTPRINT_DIAGONAL);
  }, 60_000);

  it('resolveOverlaps move poucos nós do layout simulado', () => {
    const { ids, links } = connectedGraph('a', 1000, 200, 13);
    const raw = simulateLayout(ids, links);
    const out = resolveOverlaps(raw);
    let moved = 0;
    for (const [id, p] of raw) {
      const q = out.get(id)!;
      if (q.x !== p.x || q.y !== p.y) moved++;
    }
    expect(moved / ids.length).toBeLessThan(0.1);
  }, 60_000);

  it('componentes sem ligação viram ilhas separadas, a maior no centro', () => {
    const big = connectedGraph('a', 60, 10, 21);
    const small = connectedGraph('b', 20, 4, 22);
    const out = freezeLayout([...big.ids, ...small.ids], [...big.links, ...small.links]);

    // Maior distância, dentro de um componente, ao vizinho de link mais próximo.
    let intra = 0;
    for (const g of [big, small]) {
      const adj = buildAdjacency(g.links);
      for (const id of g.ids) {
        const p = out.get(id)!;
        const d = Math.min(...[...(adj.get(id) ?? [])].map((nb) => dist(p, out.get(nb)!)));
        intra = Math.max(intra, d);
      }
    }
    let between = Infinity;
    for (const a of big.ids) for (const b of small.ids) between = Math.min(between, dist(out.get(a)!, out.get(b)!));
    expect(between).toBeGreaterThan(intra);

    const origin = { x: 0, y: 0 };
    const cBig = centroid(big.ids.map((id) => out.get(id)!));
    const cSmall = centroid(small.ids.map((id) => out.get(id)!));
    expect(dist(cBig, origin)).toBeLessThan(dist(cSmall, origin));
  }, 60_000);

  it('avulsos ficam no anel externo', () => {
    const g = connectedGraph('a', 40, 8, 31);
    const loose = Array.from({ length: 30 }, (_, i) => `z${String(i).padStart(3, '0')}`);
    const out = freezeLayout([...g.ids, ...loose], g.links);
    const origin = { x: 0, y: 0 };
    const islandMax = Math.max(...g.ids.map((id) => dist(out.get(id)!, origin)));
    const looseMin = Math.min(...loose.map((id) => dist(out.get(id)!, origin)));
    expect(looseMin).toBeGreaterThan(islandMax);
    expect(overlappingPairs(out)).toBe(0);
  }, 60_000);

  it('só avulsos: disco sem sobreposição', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `z${String(i).padStart(3, '0')}`);
    const out = freezeLayout(ids, []);
    expect(overlappingPairs(out)).toBe(0);
    const r = aspect([...out.values()]);
    expect(r).toBeGreaterThan(0.75);
    expect(r).toBeLessThan(1.33);
  });

  it('grafo sem arestas e links para ids inexistentes', () => {
    const out = freezeLayout(['a', 'b', 'c'], [{ sourceId: 'a', targetId: 'fantasma' }]);
    expect(out.size).toBe(3);
    expect(overlappingPairs(out)).toBe(0);
  });

  it('resolveOverlaps separa pegadas empilhadas', () => {
    const stacked = new Map<string, Point>([
      ['a', { x: 0, y: 0 }],
      ['b', { x: 10, y: 10 }],
      ['c', { x: 0, y: 0 }],
    ]);
    const out = resolveOverlaps(stacked);
    expect(out.get('a')).toEqual({ x: 0, y: 0 });
    expect(overlappingPairs(out)).toBe(0);
  });
});
