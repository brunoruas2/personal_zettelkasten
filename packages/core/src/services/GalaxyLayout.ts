import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';
import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force';
import type { Link } from '../models/Link';
import { FOOTPRINT_H, FOOTPRINT_W, type Point } from '../models/GalaxyPosition';
import { SpatialGrid, placeNear } from './GalaxyPlacement';

// A simulação roda em espaço de mundo: o disco simulado é o disco desenhado.
// (Comprimir `y` por W/H para tratar a pegada como quadrado esticava o mapa
// 1,45× na vertical ao descomprimir.) Círculos de raio = meia-diagonal da
// pegada que não se tocam contêm retângulos que não se tocam.
const R = Math.hypot(FOOTPRINT_W, FOOTPRINT_H) / 2;

// Parâmetros próprios da galáxia: repulsão fraca e curta, para os vizinhos
// ficarem a cerca de uma pegada (a colisão segura o resto). Calibrado com
// árvores aleatórias de 250–1000 nós: mediana da distância ao vizinho mais
// próximo ≈ 1,0× a diagonal da pegada e extensão ≈ 1,1–1,4·√n diagonais
// (antes, com carga −2R² e alcance 15R, ≈ 1,2–1,9× e o mapa 2–3× mais largo,
// pan demais para navegar). Colisão menor que R aproximava mais, mas deixava
// pegadas encostadas e o `resolveOverlaps` movia 25–70% dos nós.
const LINK_DISTANCE = 2 * R;
const LINK_STRENGTH = 0.3;
const CHARGE = -0.5 * R * R;
const CHARGE_DISTANCE_MAX = 6 * R;
// Puxão fraco para o centro do componente: mantém árvores longas redondas em
// vez de esticadas.
const GRAVITY = 0.002;
const MAX_TICKS = 3000;
const SEED = 0x2f6b1d;

// Ilhas (componentes conexos) e anel de avulsos.
const ISLAND_GAP = R;
const ANCHOR_STEP = Math.round(R);
// Reticulado quadrado com passo da altura da pegada: sem sobreposição e sem
// folga extra.
const LOOSE_STEP = FOOTPRINT_H;

interface Node extends SimulationNodeDatum {
  id: string;
}

/** LCG de 32 bits — mesma sequência em qualquer motor JS. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Componentes conexos por union-find. Cada componente vem com ids ordenados;
 * a lista vem ordenada por tamanho decrescente, desempate pelo menor id.
 */
export function connectedComponents(sortedIds: string[], pairs: [string, string][]): string[][] {
  const index = new Map(sortedIds.map((id, i) => [id, i]));
  const parent = sortedIds.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (const [a, b] of pairs) {
    const ra = find(index.get(a)!);
    const rb = find(index.get(b)!);
    // Raiz = menor índice, então o rótulo não depende da ordem das arestas.
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
  const groups = new Map<number, string[]>();
  sortedIds.forEach((id, i) => {
    const r = find(i);
    let g = groups.get(r);
    if (!g) {
      g = [];
      groups.set(r, g);
    }
    g.push(id);
  });
  return [...groups.values()].sort((p, q) => q.length - p.length || byId(p[0], q[0]));
}

/**
 * Pontos de um reticulado de passo `step` até o raio `maxR`, ordenados por
 * distância à origem, depois `y`, depois `x`. Tudo em inteiros (sem
 * trigonometria): mesma ordem em qualquer motor. A ordem por distância
 * euclidiana faz o reticulado quadrado encher em anéis aproximadamente
 * circulares.
 */
function latticeByDistance(step: number, maxR: number): [number, number][] {
  const k = Math.ceil(maxR / step);
  const pts: [number, number, number][] = [];
  for (let j = -k; j <= k; j++) {
    for (let i = -k; i <= k; i++) {
      const d = i * i + j * j;
      if (d * step * step <= maxR * maxR) pts.push([i, j, d]);
    }
  }
  pts.sort((p, q) => p[2] - q[2] || p[1] - q[1] || p[0] - q[0]);
  return pts.map(([i, j]) => [i * step, j * step]);
}

/** Simula um componente sozinho, centrado na origem; devolve posições e raio. */
function layoutComponent(
  ids: string[],
  pairs: [string, string][],
): { pos: Map<string, Point>; radius: number } {
  // Rede inicial sem sobreposição: espaçamento = diâmetro de colisão.
  const cols = Math.max(1, Math.ceil(Math.sqrt(ids.length)));
  const spacing = 2 * R;
  const offset = ((cols - 1) * spacing) / 2;
  const nodes: Node[] = ids.map((id, i) => ({
    id,
    x: (i % cols) * spacing - offset,
    y: Math.floor(i / cols) * spacing - offset,
  }));

  if (nodes.length > 1) {
    const edges: SimulationLinkDatum<Node>[] = pairs.map(([a, b]) => ({ source: a, target: b }));
    const simulation = forceSimulation<Node>(nodes)
      .randomSource(lcg(SEED))
      .force(
        'link',
        forceLink<Node, SimulationLinkDatum<Node>>(edges)
          .id((d) => d.id)
          .distance(LINK_DISTANCE)
          .strength(LINK_STRENGTH),
      )
      .force('charge', forceManyBody<Node>().strength(CHARGE).distanceMax(CHARGE_DISTANCE_MAX))
      .force('x', forceX<Node>(0).strength(GRAVITY))
      .force('y', forceY<Node>(0).strength(GRAVITY))
      .force('collision', forceCollide<Node>().radius(R).iterations(2))
      .alphaDecay(0.02)
      .velocityDecay(0.3)
      .stop();

    for (let i = 0; i < MAX_TICKS && simulation.alpha() >= 0.001; i++) simulation.tick();
  }

  let cx = 0;
  let cy = 0;
  for (const n of nodes) {
    cx += n.x ?? 0;
    cy += n.y ?? 0;
  }
  cx /= nodes.length;
  cy /= nodes.length;
  const pos = new Map<string, Point>();
  let radius = 0;
  for (const n of nodes) {
    const p = { x: (n.x ?? 0) - cx, y: (n.y ?? 0) - cy };
    pos.set(n.id, p);
    radius = Math.max(radius, Math.hypot(p.x, p.y));
  }
  return { pos, radius: radius + R };
}

/**
 * Âncoras das ilhas: a primeira na origem, cada seguinte no ponto do
 * reticulado mais próximo da origem cujo disco (raio + vão) não toca nenhum
 * já posto. Componentes chegam do maior para o menor, então os maiores ficam
 * no centro. Raios são arredondados para cima em múltiplos de `ANCHOR_STEP`:
 * para um mesmo raio, um ponto recusado continua recusado (âncoras só se
 * acumulam), então cada raio tem um cursor que só avança — o custo não cresce
 * com componentes × pontos.
 */
function islandAnchors(radii: number[]): Point[] {
  const quantized = radii.map((r) => Math.ceil(r / ANCHOR_STEP) * ANCHOR_STEP);
  let area = 0;
  for (const r of quantized) area += (2 * r + ISLAND_GAP) ** 2;
  let maxR = Math.sqrt(area) + 2 * (quantized[0] ?? 0) + ISLAND_GAP;
  let lattice = latticeByDistance(ANCHOR_STEP, maxR);

  // Grade de discos já postos: cada âncora entra em toda célula que seu disco
  // (raio + meio vão) cobre; a consulta olha as células do disco candidato.
  const CELL = 4 * ANCHOR_STEP;
  const cells = new Map<string, number[]>();
  const anchors: Point[] = [];
  const reach: number[] = [];
  const cellRange = (x: number, y: number, r: number) => [
    Math.floor((x - r) / CELL),
    Math.floor((x + r) / CELL),
    Math.floor((y - r) / CELL),
    Math.floor((y + r) / CELL),
  ];
  const fits = (x: number, y: number, r: number): boolean => {
    const [x0, x1, y0, y1] = cellRange(x, y, r);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        for (const k of cells.get(`${cx},${cy}`) ?? []) {
          const a = anchors[k];
          const min = r + reach[k];
          const dx = a.x - x;
          const dy = a.y - y;
          if (dx * dx + dy * dy < min * min) return false;
        }
      }
    }
    return true;
  };

  const cursor = new Map<number, number>();
  for (const r of quantized) {
    const half = r + ISLAND_GAP / 2;
    let i = cursor.get(r) ?? 0;
    for (;;) {
      if (i >= lattice.length) {
        maxR *= 2;
        lattice = latticeByDistance(ANCHOR_STEP, maxR);
        continue;
      }
      const [x, y] = lattice[i];
      if (fits(x, y, half)) break;
      i++;
    }
    cursor.set(r, i + 1);
    const [x, y] = lattice[i];
    const k = anchors.length;
    anchors.push({ x, y });
    reach.push(half);
    const [x0, x1, y0, y1] = cellRange(x, y, half);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const key = `${cx},${cy}`;
        let cell = cells.get(key);
        if (!cell) {
          cell = [];
          cells.set(key, cell);
        }
        cell.push(k);
      }
    }
  }
  return anchors;
}

/**
 * Avulsos: os `n` primeiros pontos de um reticulado largo, ordenados por
 * distância, a partir de `innerR`. Com ilhas vira um anel em volta delas; sem
 * ilhas (`innerR = 0`), um disco.
 */
function looseRing(n: number, innerR: number): Point[] {
  let maxR = Math.sqrt(innerR * innerR + (n * LOOSE_STEP * LOOSE_STEP * 4) / Math.PI) + 2 * LOOSE_STEP;
  for (;;) {
    const pts = latticeByDistance(LOOSE_STEP, maxR).filter(
      ([x, y]) => innerR === 0 || x * x + y * y >= innerR * innerR,
    );
    if (pts.length >= n) return pts.slice(0, n).map(([x, y]) => ({ x, y }));
    maxR *= 2;
  }
}

/**
 * Layout inicial da galáxia, calculado uma única vez. Cada componente conexo
 * é simulado sozinho (link, carga, gravidade fraca, colisão) e vira uma ilha;
 * as ilhas são empacotadas com vão entre si, maiores no centro; zettels sem
 * link vão para um anel em volta. Determinístico: nós ordenados por id,
 * arestas sem direção e sem duplicatas, posições iniciais e âncoras em
 * reticulados (sem trigonometria, cuja precisão varia entre motores) e fonte
 * aleatória com semente fixa. Links para ids fora de `ids` são ignorados.
 * Devolve coordenadas inteiras sem nenhuma pegada sobreposta.
 */
export function freezeLayout(ids: string[], links: Link[]): Map<string, Point> {
  return resolveOverlaps(simulateLayout(ids, links));
}

/**
 * Posições da simulação antes do `resolveOverlaps` (inteiras, podendo ter
 * pegadas encostadas). Exportada para os testes medirem quantos nós a
 * garantia final precisa mover.
 */
export function simulateLayout(ids: string[], links: Link[]): Map<string, Point> {
  const sorted = [...new Set(ids)].sort(byId);
  const known = new Set(sorted);

  const edgeKeys = new Set<string>();
  const pairs: [string, string][] = [];
  for (const l of links) {
    if (l.sourceId === l.targetId || !known.has(l.sourceId) || !known.has(l.targetId)) continue;
    const [a, b] = l.sourceId < l.targetId ? [l.sourceId, l.targetId] : [l.targetId, l.sourceId];
    const k = `${a}\u0000${b}`;
    if (edgeKeys.has(k)) continue;
    edgeKeys.add(k);
    pairs.push([a, b]);
  }
  pairs.sort((p, q) => byId(p[0], q[0]) || byId(p[1], q[1]));

  const components = connectedComponents(sorted, pairs);
  const islands = components.filter((c) => c.length > 1);
  const loose = components.filter((c) => c.length === 1).map((c) => c[0]);

  const componentOf = new Map<string, number>();
  islands.forEach((c, i) => c.forEach((id) => componentOf.set(id, i)));
  const islandPairs: [string, string][][] = islands.map(() => []);
  for (const p of pairs) islandPairs[componentOf.get(p[0])!].push(p);

  const layouts = islands.map((c, i) => layoutComponent(c, islandPairs[i]));
  const anchors = islandAnchors(layouts.map((l) => l.radius));

  const raw = new Map<string, Point>();
  let extent = 0;
  layouts.forEach((l, i) => {
    const a = anchors[i];
    extent = Math.max(extent, Math.hypot(a.x, a.y) + l.radius);
    for (const [id, p] of l.pos) raw.set(id, { x: Math.round(a.x + p.x), y: Math.round(a.y + p.y) });
  });

  const ring = looseRing(loose.length, islands.length > 0 ? extent + ISLAND_GAP : 0);
  loose.forEach((id, i) => raw.set(id, ring[i]));

  return raw;
}

/**
 * Garantia final: a colisão da d3 é suave, não absoluta. Em ordem de id, cada
 * pegada que ainda se sobrepõe às já aceitas vai para a vaga livre mais
 * próxima.
 */
export function resolveOverlaps(positions: Map<string, Point>): Map<string, Point> {
  const grid = new SpatialGrid();
  const out = new Map<string, Point>();
  for (const id of [...positions.keys()].sort(byId)) {
    const p = positions.get(id)!;
    const q = grid.isFree(p) ? p : placeNear(p, grid);
    grid.add(id, q);
    out.set(id, q);
  }
  return out;
}
