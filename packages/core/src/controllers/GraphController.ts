import type { Zettel } from '../models/Zettel';
import type { Link, Graph, GraphNode, GraphEdge } from '../models/Link';

export class GraphController {
  buildGraph(zettels: Zettel[], links: Link[]): Graph {
    const connectionCount = new Map<string, number>();

    for (const z of zettels) {
      connectionCount.set(z.id, 0);
    }

    for (const link of links) {
      connectionCount.set(link.sourceId, (connectionCount.get(link.sourceId) ?? 0) + 1);
      connectionCount.set(link.targetId, (connectionCount.get(link.targetId) ?? 0) + 1);
    }

    const nodes: GraphNode[] = zettels.map((z) => ({
      id: z.id,
      title: z.title,
      connectionCount: connectionCount.get(z.id) ?? 0,
    }));

    const edges: GraphEdge[] = links.map((l) => ({
      source: l.sourceId,
      target: l.targetId,
    }));

    return { nodes, edges };
  }

  filterByTag(zettels: Zettel[], links: Link[], tag: string): Graph {
    const filtered = zettels.filter((z) => z.tags.includes(tag));
    const filteredIds = new Set(filtered.map((z) => z.id));
    const filteredLinks = links.filter(
      (l) => filteredIds.has(l.sourceId) && filteredIds.has(l.targetId),
    );
    return this.buildGraph(filtered, filteredLinks);
  }
}
