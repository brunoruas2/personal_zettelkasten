export interface NodeColorRule {
  zettelId: string;
  zettelTitle: string;
  color: string;
}

export const CLUSTER_COLORS = [
  { id: 'coral',   hex: '#f87171', label: 'Coral'   },
  { id: 'orange',  hex: '#fb923c', label: 'Laranja' },
  { id: 'amber',   hex: '#fbbf24', label: 'Âmbar'   },
  { id: 'lime',    hex: '#a3e635', label: 'Lima'    },
  { id: 'emerald', hex: '#34d399', label: 'Verde'   },
  { id: 'sky',     hex: '#38bdf8', label: 'Azul'    },
  { id: 'violet',  hex: '#a78bfa', label: 'Violeta' },
  { id: 'pink',    hex: '#f472b6', label: 'Rosa'    },
];

const STORAGE_KEY = 'zettel_node_colors';

export function getNodeColorRules(): NodeColorRule[] {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return [];
    return JSON.parse(raw) as NodeColorRule[];
  } catch {
    return [];
  }
}

export function saveNodeColorRules(rules: NodeColorRule[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
  } catch {}
}

/**
 * Returns a map of zettelId → color for root nodes only.
 * Only the zettel explicitly configured in settings gets the custom color.
 * Neighbor propagation is intentionally removed — the nebula handles cluster visuals.
 */
export function buildNodeColorMap(
  rules: NodeColorRule[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const rule of rules) {
    map.set(rule.zettelId, rule.color);
  }
  return map;
}

/**
 * Returns a map of zettelId → color for all nodes reachable from any root via BFS.
 * Used to determine which nodes receive a nebula splat in the graph canvas.
 * First root wins in case of collision (same priority as nodeColorMap).
 */
export function buildNebulaMap(
  rules: NodeColorRule[],
  edges: { source: string; target: string }[],
): Map<string, string> {
  const map = new Map<string, string>();

  // Build adjacency list (undirected)
  const adj = new Map<string, string[]>();
  for (const edge of edges) {
    if (!adj.has(edge.source)) adj.set(edge.source, []);
    if (!adj.has(edge.target)) adj.set(edge.target, []);
    adj.get(edge.source)!.push(edge.target);
    adj.get(edge.target)!.push(edge.source);
  }

  for (const rule of rules) {
    const queue: string[] = [rule.zettelId];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      if (!map.has(id)) map.set(id, rule.color);
      for (const neighbor of adj.get(id) ?? []) {
        if (!visited.has(neighbor)) queue.push(neighbor);
      }
    }
  }

  return map;
}
