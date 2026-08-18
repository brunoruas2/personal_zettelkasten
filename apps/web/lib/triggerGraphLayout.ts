import { useZettelStore } from '../store/useZettelStore';
import { saveLayoutCache } from './graphLayoutCache';

export function triggerGraphLayoutWorker(): void {
  if (typeof window === 'undefined') return;

  const { zettels, links, graphExcludedTags } = useZettelStore.getState();

  const filtered = graphExcludedTags.length
    ? zettels.filter((z) => !z.tags.some((t) => graphExcludedTags.includes(t)))
    : zettels;

  if (filtered.length === 0) return;

  const filteredSet = new Set(filtered.map((z) => z.id));
  const filteredLinks = links.filter(
    (l) => filteredSet.has(l.sourceId) && filteredSet.has(l.targetId),
  );

  const connCount = new Map<string, number>();
  for (const l of filteredLinks) {
    connCount.set(l.sourceId, (connCount.get(l.sourceId) ?? 0) + 1);
    connCount.set(l.targetId, (connCount.get(l.targetId) ?? 0) + 1);
  }

  const nodes = filtered.map((z) => ({
    id: z.id,
    connections: connCount.get(z.id) ?? 0,
  }));
  const edges = filteredLinks.map((l) => ({ source: l.sourceId, target: l.targetId }));
  const nodeIds = nodes.map((n) => n.id).sort();

  const worker = new Worker(new URL('../workers/graphLayout.worker.ts', import.meta.url));
  worker.postMessage({ nodes, edges });
  worker.onmessage = (e: MessageEvent<{ positions: Record<string, { x: number; y: number }> }>) => {
    saveLayoutCache(nodeIds, e.data.positions);
    worker.terminate();
  };
  worker.onerror = () => worker.terminate();
}
