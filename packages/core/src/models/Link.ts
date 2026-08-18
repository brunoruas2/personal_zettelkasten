export interface Link {
  sourceId: string;
  targetId: string;
  type?: 'parent-ref';
}

export interface GraphNode {
  id: string;
  title: string;
  connectionCount: number;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
