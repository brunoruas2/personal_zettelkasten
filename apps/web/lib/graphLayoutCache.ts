const GRAPH_LAYOUT_CACHE_KEY = 'zettel_graph_positions';

export interface LayoutCache {
  nodeIds: string[];
  positions: Record<string, { x: number; y: number }>;
}

export function saveLayoutCache(nodeIds: string[], positions: Record<string, { x: number; y: number }>): void {
  try {
    localStorage.setItem(GRAPH_LAYOUT_CACHE_KEY, JSON.stringify({ nodeIds, positions }));
  } catch {
    // quota exceeded — fail silently
  }
}

export function loadLayoutCache(): LayoutCache | null {
  try {
    const raw = localStorage.getItem(GRAPH_LAYOUT_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LayoutCache;
  } catch {
    return null;
  }
}

export function isLayoutCacheValid(currentIds: string[], cache: LayoutCache): boolean {
  if (currentIds.length !== cache.nodeIds.length) return false;
  const sorted = [...currentIds].sort();
  const cacheSorted = [...cache.nodeIds].sort();
  return sorted.every((id, i) => id === cacheSorted[i]);
}
