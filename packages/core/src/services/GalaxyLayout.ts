import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from 'd3-force';
import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force';
import type { Link } from '../models/Link';
import { FOOTPRINT_H, FOOTPRINT_W, type Point } from '../models/GalaxyPosition';
import { SpatialGrid, placeNear } from './GalaxyPlacement';

// A simulação roda num espaço com `y` comprimido por W/H: a pegada retangular
// vira um quadrado W×W, e círculos de raio = meia-diagonal desse quadrado que
// não se tocam garantem quadrados inscritos que também não se tocam. Sem força
// de colisão retangular customizada.
const Y_SCALE = FOOTPRINT_W / FOOTPRINT_H;
const COLLIDE_RADIUS = (FOOTPRINT_W * Math.SQRT2) / 2;

// Parâmetros do modo sessão (`GraphCanvas`, colisão ≈ raio + 240 ≈ 250),
// escalados pela razão entre os raios de colisão.
const K = COLLIDE_RADIUS / 250;
const LINK_DISTANCE = 2 * COLLIDE_RADIUS + 80;
const CHARGE = -900 * K * K;
const CHARGE_DISTANCE_MAX = 1200 * K;
const MAX_TICKS = 3000;
const SEED = 0x2f6b1d;

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
 * Layout inicial da galáxia, calculado uma única vez. Determinístico: nós
 * ordenados por id, arestas sem direção e sem duplicatas, posições iniciais
 * numa rede quadrada (sem trigonometria, cuja precisão varia entre motores) e
 * fonte aleatória com semente fixa. Links para ids fora de `ids` são
 * ignorados. Devolve coordenadas inteiras sem nenhuma pegada sobreposta.
 */
export function freezeLayout(ids: string[], links: Link[]): Map<string, Point> {
  const sorted = [...new Set(ids)].sort(byId);
  const known = new Set(sorted);

  const edgeKeys = new Set<string>();
  const edges: SimulationLinkDatum<Node>[] = [];
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
  for (const [a, b] of pairs) edges.push({ source: a, target: b });

  // Rede inicial sem sobreposição: espaçamento = diâmetro de colisão.
  const cols = Math.max(1, Math.ceil(Math.sqrt(sorted.length)));
  const spacing = 2 * COLLIDE_RADIUS;
  const offset = ((cols - 1) * spacing) / 2;
  const nodes: Node[] = sorted.map((id, i) => ({
    id,
    x: (i % cols) * spacing - offset,
    y: Math.floor(i / cols) * spacing - offset,
  }));

  if (nodes.length > 1) {
    const simulation = forceSimulation<Node>(nodes)
      .randomSource(lcg(SEED))
      .force(
        'link',
        forceLink<Node, SimulationLinkDatum<Node>>(edges)
          .id((d) => d.id)
          .distance(LINK_DISTANCE)
          .strength(0.3),
      )
      .force('charge', forceManyBody<Node>().strength(CHARGE).distanceMax(CHARGE_DISTANCE_MAX))
      .force('center', forceCenter(0, 0))
      .force('collision', forceCollide<Node>().radius(COLLIDE_RADIUS).iterations(2))
      .alphaDecay(0.02)
      .velocityDecay(0.3)
      .stop();

    for (let i = 0; i < MAX_TICKS && simulation.alpha() >= 0.001; i++) simulation.tick();
  }

  const raw = new Map<string, Point>();
  for (const n of nodes) {
    raw.set(n.id, { x: Math.round(n.x ?? 0), y: Math.round((n.y ?? 0) / Y_SCALE) });
  }
  return resolveOverlaps(raw);
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
