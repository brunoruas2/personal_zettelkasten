import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3-force';

interface WorkerNode {
  id: string;
  connections: number;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

interface WorkerEdge {
  source: string;
  target: string;
}

function getNodeRadius(connections: number): number {
  return Math.max(4, Math.min(14, 4 + connections * 1.5));
}

self.addEventListener('message', (event: MessageEvent<{ nodes: WorkerNode[]; edges: WorkerEdge[] }>) => {
  const { nodes, edges } = event.data;
  const simNodes = nodes.map((n) => ({ ...n }));
  const simLinks = edges.map((e) => ({ ...e }));

  const simulation = forceSimulation(simNodes as any)
    .force('link', forceLink(simLinks).id((d: any) => d.id).distance(60).strength(0.3))
    .force('charge', forceManyBody().strength(-120).distanceMax(300))
    .force('center', forceCenter(0, 0))
    .force('collision', forceCollide().radius((d: any) => getNodeRadius(d.connections) + 2))
    .alphaDecay(0.02)
    .velocityDecay(0.3)
    .stop();

  // Run headless until convergence (max 500 ticks as safety cap)
  const MAX_TICKS = 500;
  for (let i = 0; i < MAX_TICKS && simulation.alpha() > 0.001; i++) {
    simulation.tick();
  }

  const positions: Record<string, { x: number; y: number }> = {};
  for (const node of simNodes) {
    if (node.x != null && node.y != null) {
      positions[node.id] = { x: node.x, y: node.y };
    }
  }

  self.postMessage({ positions });
});
