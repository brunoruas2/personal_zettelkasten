'use client';

import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useZettelStore } from '../../store/useZettelStore';
import { useOfflineRouter } from '../../hooks/useOfflineRouter';
import { buildNodeColorMap, buildNebulaMap } from '../../lib/graphColors';
import { loadLayoutCache, isLayoutCacheValid } from '../../lib/graphLayoutCache';
import { CreateFromNodeModal } from '../../components/CreateFromNodeModal';
import { MarkdownRenderer } from '../../components/MarkdownRenderer';

const PREVIEW_DELAY_MS = 0;
const PREVIEW_BODY_LIMIT = 1000;
const PREVIEW_PANEL_SIZE = { w: 320, h: 260 };

interface GraphNode {
  id: string;
  title: string;
  tags: string[];
  color: string;
  connections: number;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
}

interface LegendItem {
  label: string;
  color: string;
}

export function GraphCanvas() {
  const { zettels, links, controller, graphExcludedTags, graphNodeColors, createZettel, updateZettel } = useZettelStore();
  const router = useOfflineRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const searchParams = useSearchParams();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);
  const simulationRef = useRef<{ simulation: any; data: { nodes: GraphNode[]; links: GraphLink[] } } | null>(null);

  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const dragRef = useRef<{ active: boolean; nodeIndex: number; startX: number; startY: number; isPan: boolean }>({
    active: false, nodeIndex: -1, startX: 0, startY: 0, isPan: false,
  });
  const hoverRef = useRef<number>(-1);
  const [preview, setPreview] = useState<{ x: number; y: number; title: string; tags: string[]; connections: number; body: string } | null>(null);
  const [nodeModal, setNodeModal] = useState<
    { mode: 'create'; id: string; title: string; tags: string[] } | { mode: 'edit'; id: string; title: string; body: string; tags: string[] } | null
  >(null);
  const [focusOriginId] = useState<string | null>(() => searchParams.get('focus'));
  const lastFocusOriginRef = useRef<string | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoveredNodeIdRef = useRef<string | null>(null);
  const previewRectRef = useRef<{ left: number; top: number; right: number; bottom: number } | null>(null);

  // Snapshot fed to the heavy setup effect — only replaced when a full
  // simulation rebuild is actually warranted (see the sync effect below).
  const [setupData, setSetupData] = useState<{ nodes: GraphNode[]; links: GraphLink[] } | null>(null);
  const zettelsRef = useRef(zettels);
  useEffect(() => {
    zettelsRef.current = zettels;
  }, [zettels]);

  useEffect(() => {
    if (!preview) {
      previewRectRef.current = null;
      return;
    }
    const containerRect = containerRef.current?.getBoundingClientRect();
    let left = preview.x + 12;
    let top = preview.y - 10;
    if (containerRect) {
      if (left + PREVIEW_PANEL_SIZE.w > containerRect.width) left = preview.x - PREVIEW_PANEL_SIZE.w - 12;
      if (left < 8) left = 8;
      if (top + PREVIEW_PANEL_SIZE.h > containerRect.height) top = containerRect.height - PREVIEW_PANEL_SIZE.h - 8;
      if (top < 8) top = 8;
    }
    previewRectRef.current = { left, top, right: left + PREVIEW_PANEL_SIZE.w, bottom: top + PREVIEW_PANEL_SIZE.h };
  }, [preview]);

  const clearPreviewTimer = useCallback(() => {
    if (hoverTimerRef.current !== null) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    hoveredNodeIdRef.current = null;
    setPreview(null);
  }, []);

  const getNodeRadius = useCallback((node: GraphNode) => {
    return Math.max(4, Math.min(14, 4 + node.connections * 1.5));
  }, []);

  const { graphData, legend, nebulaMap } = useMemo(() => {
    const empty = { graphData: { nodes: [] as GraphNode[], links: [] as GraphLink[] }, legend: [] as LegendItem[], nebulaMap: new Map<string, string>() };
    if (!controller) return empty;

    const filtered = graphExcludedTags.length
      ? zettels.filter((z) => !z.tags.some((t) => graphExcludedTags.includes(t)))
      : zettels;

    const filteredSet = new Set(filtered.map((z) => z.id));
    const filteredLinks = links.filter(
      (l) => filteredSet.has(l.sourceId) && filteredSet.has(l.targetId),
    );

    // Focus mode: restrict to the origin node + everything reachable from it
    // by following parent → child edges, direct or transitive. Plain [[Title]]
    // links store source=parent, target=child. [[^Title]] links (type:
    // 'parent-ref') store source=child, target=parent — the author wrote
    // "^Title" meaning Title is their parent — so the parent→child edge for
    // BFS purposes is the reverse of the stored row. This reversal is local
    // to this BFS step; raw stored rows are never flipped.
    let visibleIds = filteredSet;
    if (focusOriginId && filteredSet.has(focusOriginId)) {
      const adjacency = new Map<string, string[]>();
      for (const l of filteredLinks) {
        const [parent, child] = l.type === 'parent-ref'
          ? [l.targetId, l.sourceId]
          : [l.sourceId, l.targetId];
        if (!adjacency.has(parent)) adjacency.set(parent, []);
        adjacency.get(parent)!.push(child);
      }
      const reachable = new Set<string>([focusOriginId]);
      const queue = [focusOriginId];
      while (queue.length > 0) {
        const current = queue.shift()!;
        for (const next of adjacency.get(current) ?? []) {
          if (!reachable.has(next)) {
            reachable.add(next);
            queue.push(next);
          }
        }
      }
      visibleIds = reachable;
    }

    const finalFiltered = visibleIds === filteredSet ? filtered : filtered.filter((z) => visibleIds.has(z.id));
    const finalFilteredLinks = visibleIds === filteredSet
      ? filteredLinks
      : filteredLinks.filter((l) => visibleIds.has(l.sourceId) && visibleIds.has(l.targetId));

    const edges = finalFilteredLinks.map((l) => ({ source: l.sourceId, target: l.targetId }));
    const colorMap = buildNodeColorMap(graphNodeColors);
    const nebulaMap = buildNebulaMap(graphNodeColors, edges);

    const rgb = typeof window !== 'undefined'
      ? getComputedStyle(document.documentElement).getPropertyValue('--color-brand').trim()
      : '124 58 237';
    const brandColor = '#' + rgb.split(/\s+/).map((n) => parseInt(n).toString(16).padStart(2, '0')).join('');

    const connCount = new Map<string, number>();
    for (const l of finalFilteredLinks) {
      connCount.set(l.sourceId, (connCount.get(l.sourceId) ?? 0) + 1);
      connCount.set(l.targetId, (connCount.get(l.targetId) ?? 0) + 1);
    }

    const nodes: GraphNode[] = finalFiltered.map((z) => ({
      id: z.id,
      title: z.title,
      tags: z.tags,
      color: colorMap.get(z.id) ?? brandColor,
      connections: connCount.get(z.id) ?? 0,
    }));

    const graphLinks: GraphLink[] = finalFilteredLinks.map((l) => ({
      source: l.sourceId,
      target: l.targetId,
    }));

    const legendItems: LegendItem[] = graphNodeColors.map((rule) => ({
      label: rule.zettelTitle,
      color: rule.color,
    }));

    return { graphData: { nodes, links: graphLinks }, legend: legendItems, nebulaMap };
  }, [zettels, links, controller, graphExcludedTags, graphNodeColors, focusOriginId]);

  // Decides, on every graphData change, whether the running simulation can
  // absorb the change in place (pure node addition — e.g. a zettel created
  // from the map's own "+" badge) or whether a full rebuild is warranted
  // (removal, focus mode entering/exiting, or first mount). Only the setup
  // effect below ever tears down/recreates the simulation and its listeners.
  useEffect(() => {
    const focusChanged = lastFocusOriginRef.current !== focusOriginId;
    lastFocusOriginRef.current = focusOriginId;

    const sim = simulationRef.current;
    if (!sim || focusChanged) {
      setSetupData(graphData);
      return;
    }

    const oldNodes = sim.data.nodes;
    const oldIds = new Set(oldNodes.map((n) => n.id));
    const newIds = new Set(graphData.nodes.map((n) => n.id));
    const isStrictSuperset = newIds.size > oldIds.size && Array.from(oldIds).every((id) => newIds.has(id));

    if (!isStrictSuperset) {
      setSetupData(graphData);
      return;
    }

    // Pure addition — patch the live simulation instead of rebuilding it,
    // preserving the current position of every already-placed node. Existing
    // nodes keep their array index (hoverRef/dragRef track nodes by index,
    // not id) — new nodes are appended at the end, never spliced in.
    const oldById = new Map(oldNodes.map((n) => [n.id, n]));
    const freshById = new Map(graphData.nodes.map((n) => [n.id, n]));

    for (const oldNode of oldNodes) {
      const fresh = freshById.get(oldNode.id);
      if (fresh) {
        oldNode.title = fresh.title;
        oldNode.tags = fresh.tags;
        oldNode.color = fresh.color;
        oldNode.connections = fresh.connections;
      }
    }

    const neighborsByNewId = new Map<string, string[]>();
    for (const link of graphData.links) {
      const src = link.source as string;
      const tgt = link.target as string;
      if (!oldById.has(src) && oldById.has(tgt)) {
        if (!neighborsByNewId.has(src)) neighborsByNewId.set(src, []);
        neighborsByNewId.get(src)!.push(tgt);
      }
      if (!oldById.has(tgt) && oldById.has(src)) {
        if (!neighborsByNewId.has(tgt)) neighborsByNewId.set(tgt, []);
        neighborsByNewId.get(tgt)!.push(src);
      }
    }

    const addedNodes: GraphNode[] = [];
    for (const n of graphData.nodes) {
      if (oldById.has(n.id)) continue;

      const neighborIds = neighborsByNewId.get(n.id) ?? [];
      const neighborPositions = neighborIds
        .map((id) => oldById.get(id))
        .filter((node): node is GraphNode => !!node && node.x != null && node.y != null);

      const { x, y } = neighborPositions.length > 0
        ? {
            x: neighborPositions.reduce((sum, node) => sum + node.x!, 0) / neighborPositions.length,
            y: neighborPositions.reduce((sum, node) => sum + node.y!, 0) / neighborPositions.length,
          }
        : { x: (Math.random() - 0.5) * 40, y: (Math.random() - 0.5) * 40 };

      addedNodes.push({ ...n, x, y });
    }

    sim.data.nodes = [...oldNodes, ...addedNodes];
    sim.data.links = graphData.links.map((l) => ({ ...l }));
    sim.simulation.nodes(sim.data.nodes);
    (sim.simulation.force('link') as any).links(sim.data.links);
    sim.simulation.alpha(0.3).restart();
  }, [graphData, focusOriginId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !setupData || setupData.nodes.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // cancelled flag + asyncCleanup let the sync cleanup function reach inside
    // the async .then() callback. Without this, cancelAnimationFrame and
    // simulation.stop() run before the import resolves, so the previous loop
    // is never cancelled and multiple simulations pile up (especially visible
    // in React Strict Mode which double-invokes effects in development).
    let cancelled = false;
    let asyncCleanup: (() => void) | undefined;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    import('d3-force').then((d3) => {
      if (cancelled) return;
      const data = {
        nodes: setupData.nodes.map((n) => ({ ...n })) as GraphNode[],
        links: setupData.links.map((l) => ({ ...l })) as GraphLink[],
      };

      const width = container.getBoundingClientRect().width;
      const height = container.getBoundingClientRect().height;
      transformRef.current = { x: width / 2, y: height / 2, scale: 1 };

      const badgeColor = getComputedStyle(document.documentElement).getPropertyValue('--color-brand').trim();
      const badgeFill = `rgb(${badgeColor.split(/\s+/).join(',')})`;

      // Load cached positions — skip convergence animation if valid
      const cache = loadLayoutCache();
      const nodeIds = data.nodes.map((n) => n.id);
      const hasValidCache = cache !== null && isLayoutCacheValid(nodeIds, cache);
      if (hasValidCache) {
        for (const node of data.nodes) {
          const pos = cache.positions[node.id];
          if (pos) { node.x = pos.x; node.y = pos.y; }
        }
      }

      const simulation = d3.forceSimulation(data.nodes as any)
        .force('link', d3.forceLink(data.links).id((d: any) => d.id).distance(60).strength(0.3))
        .force('charge', d3.forceManyBody().strength(-120).distanceMax(300))
        .force('center', d3.forceCenter(0, 0))
        .force('collision', d3.forceCollide().radius((d: any) => getNodeRadius(d) + 2))
        .alphaDecay(0.02)
        .velocityDecay(0.3);

      if (hasValidCache) {
        simulation.alpha(0.1);
      }

      simulationRef.current = { simulation, data };

      const draw = () => {
        const { width: w, height: h } = canvas.getBoundingClientRect();
        const { x: tx, y: ty, scale } = transformRef.current;
        const hovIdx = hoverRef.current;

        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#0d1117';
        ctx.fillRect(0, 0, w, h);

        // Starfield — twinkling + parallax depth layers
        const t = Date.now() * 0.001;
        for (let i = 0; i < 200; i++) {
          const baseX = ((42 * (i + 1) * 9301 + 49297) % 233280) / 233280;
          const baseY = ((42 * (i + 1) * 7919 + 12345) % 233280) / 233280;
          // Three depth layers with different parallax speeds
          const depth = i % 3; // 0 = far, 1 = mid, 2 = near
          const parallax = [0.03, 0.07, 0.13][depth];
          const sx = ((baseX * w + tx * parallax) % w + w) % w;
          const sy = ((baseY * h + ty * parallax) % h + h) % h;
          const brightness = ((i * 3571) % 100) / 100;
          const twinkle = 0.55 + 0.45 * Math.sin(t * (0.4 + (i % 7) * 0.25) + i * 2.399);
          ctx.fillStyle = `rgba(255,255,255,${(0.04 + brightness * 0.14) * twinkle})`;
          ctx.beginPath();
          ctx.arc(sx, sy, 0.4 + brightness * 0.9, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.save();
        ctx.translate(tx, ty);
        ctx.scale(scale, scale);

        const hoveredConnections = new Set<string>();
        if (hovIdx >= 0) {
          const hovNode = data.nodes[hovIdx];
          for (const link of data.links) {
            const src = link.source as GraphNode;
            const tgt = link.target as GraphNode;
            if (src?.id === hovNode.id) hoveredConnections.add(tgt.id);
            if (tgt?.id === hovNode.id) hoveredConnections.add(src.id);
          }
        }

        // Cluster nebula — Gaussian splat per node, drawn before links and nodes
        // alpha encoded directly in color stops so globalAlpha stays at 1
        for (const node of data.nodes) {
          if (node.x == null || node.y == null) continue;
          const nebulaColor = nebulaMap.get(node.id);
          if (!nebulaColor) continue;
          const gradient = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, 80);
          gradient.addColorStop(0, nebulaColor + '26'); // ~15% alpha at center
          gradient.addColorStop(1, nebulaColor + '00'); // transparent at edge
          ctx.beginPath();
          ctx.arc(node.x, node.y, 80, 0, Math.PI * 2);
          ctx.fillStyle = gradient;
          ctx.fill();
        }

        // Links
        for (const link of data.links) {
          const src = link.source as GraphNode;
          const tgt = link.target as GraphNode;
          if (src.x == null || tgt.x == null) continue;

          const isHighlighted = hovIdx >= 0 && (
            src.id === data.nodes[hovIdx]?.id ||
            tgt.id === data.nodes[hovIdx]?.id
          );

          ctx.beginPath();
          ctx.moveTo(src.x, src.y!);
          ctx.lineTo(tgt.x, tgt.y!);
          ctx.strokeStyle = isHighlighted ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.06)';
          ctx.lineWidth = isHighlighted ? 1.5 : 0.5;
          ctx.stroke();
        }

        // Nodes — circles first, labels in a second pass to avoid overlap
        const maxConn = Math.max(...data.nodes.map((n) => n.connections), 1);

        data.nodes.forEach((node, i) => {
          if (node.x == null || node.y == null) return;
          const r = getNodeRadius(node);
          const isHovered = i === hovIdx;
          const isConnected = hovIdx >= 0 && hoveredConnections.has(node.id);
          const dimmed = hovIdx >= 0 && !isHovered && !isConnected;

          if (isHovered || isConnected) {
            const gradient = ctx.createRadialGradient(node.x, node.y, r * 0.5, node.x, node.y, r * 3);
            gradient.addColorStop(0, node.color + '60');
            gradient.addColorStop(1, node.color + '00');
            ctx.beginPath();
            ctx.arc(node.x, node.y, r * 3, 0, Math.PI * 2);
            ctx.fillStyle = gradient;
            ctx.fill();
          }

          ctx.beginPath();
          ctx.arc(node.x, node.y, isHovered ? r * 1.4 : r, 0, Math.PI * 2);
          ctx.fillStyle = dimmed ? node.color + '30' : node.color;
          ctx.fill();

          ctx.strokeStyle = dimmed ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.2)';
          ctx.lineWidth = isHovered ? 2 : 0.5;
          ctx.stroke();
        });

        // Labels — second pass so text is always on top of circles
        // LOD: threshold decreases as scale increases → more labels appear when zoomed in
        const labelThreshold = maxConn * 0.2 / scale;
        ctx.textAlign = 'center';
        ctx.shadowColor = 'rgba(0,0,0,0.9)';
        ctx.shadowBlur = 3;

        data.nodes.forEach((node, i) => {
          if (node.x == null || node.y == null) return;
          const r = getNodeRadius(node);
          const isHovered = i === hovIdx;
          const showLabel = isHovered || node.connections >= labelThreshold;
          if (!showLabel) return;

          const dimmed = hovIdx >= 0 && !isHovered && !hoveredConnections.has(node.id);
          const fontSize = 10 / scale;
          ctx.font = `${isHovered ? 'bold ' : ''}${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
          ctx.fillStyle = dimmed ? 'rgba(161,161,170,0.4)' : (isHovered ? '#ffffff' : '#a1a1aa');

          const label = node.title.length > 28 ? node.title.slice(0, 27) + '…' : node.title;
          ctx.fillText(label, node.x, node.y + r + 13 / scale);
        });

        ctx.shadowBlur = 0;

        // Create badge — small "+" on the hovered node, click opens the create-from-node modal
        if (hovIdx >= 0 && !dragRef.current.active) {
          const hovNode = data.nodes[hovIdx];
          if (hovNode.x != null && hovNode.y != null) {
            const hr = getNodeRadius(hovNode);
            const badgeR = 12 / scale;
            const bx = hovNode.x + hr + 6 / scale;
            const by = hovNode.y - hr - 6 / scale;

            ctx.beginPath();
            ctx.arc(bx, by, badgeR, 0, Math.PI * 2);
            ctx.fillStyle = badgeFill;
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.8)';
            ctx.lineWidth = 1 / scale;
            ctx.stroke();

            ctx.font = `${16 / scale}px -apple-system, BlinkMacSystemFont, sans-serif`;
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('+', bx, by + 0.5 / scale);
            ctx.textBaseline = 'alphabetic';
          }
        }

        // Edit badge — pencil icon next to the "+" badge, click opens the modal in edit mode
        if (hovIdx >= 0 && !dragRef.current.active) {
          const hovNode = data.nodes[hovIdx];
          if (hovNode.x != null && hovNode.y != null) {
            const hr = getNodeRadius(hovNode);
            const badgeR = 12 / scale;
            const bx = hovNode.x + hr + 6 / scale + badgeR * 2 + 6 / scale;
            const by = hovNode.y - hr - 6 / scale;

            ctx.beginPath();
            ctx.arc(bx, by, badgeR, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(39,39,42,0.9)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.8)';
            ctx.lineWidth = 1 / scale;
            ctx.stroke();

            ctx.save();
            ctx.translate(bx, by);
            ctx.rotate(-Math.PI / 4);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.6 / scale;
            ctx.beginPath();
            ctx.moveTo(-4.5 / scale, 0);
            ctx.lineTo(4.5 / scale, 0);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(4.5 / scale, 0);
            ctx.lineTo(6.5 / scale, -2 / scale);
            ctx.lineTo(4.5 / scale, -2 / scale);
            ctx.closePath();
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.restore();
          }
        }

        // Focus badge — eye icon mirrored on the opposite side, click enters focus mode
        if (hovIdx >= 0 && !dragRef.current.active) {
          const hovNode = data.nodes[hovIdx];
          if (hovNode.x != null && hovNode.y != null) {
            const hr = getNodeRadius(hovNode);
            const badgeR = 12 / scale;
            const ex = hovNode.x - hr - 6 / scale;
            const ey = hovNode.y - hr - 6 / scale;

            ctx.beginPath();
            ctx.arc(ex, ey, badgeR, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(39,39,42,0.9)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.8)';
            ctx.lineWidth = 1 / scale;
            ctx.stroke();

            ctx.beginPath();
            ctx.ellipse(ex, ey, 5.5 / scale, 3 / scale, 0, 0, Math.PI * 2);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.3 / scale;
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(ex, ey, 1.8 / scale, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
          }
        }

        ctx.restore();
        animFrameRef.current = requestAnimationFrame(draw);
      };

      animFrameRef.current = requestAnimationFrame(draw);

      const hitTest = (clientX: number, clientY: number): number => {
        const rect = canvas.getBoundingClientRect();
        const { x: tx, y: ty, scale } = transformRef.current;
        const mx = (clientX - rect.left - tx) / scale;
        const my = (clientY - rect.top - ty) / scale;

        for (let i = data.nodes.length - 1; i >= 0; i--) {
          const node = data.nodes[i];
          if (node.x == null || node.y == null) continue;
          const r = getNodeRadius(node) * 1.5;
          const dx = mx - node.x;
          const dy = my - node.y;
          if (dx * dx + dy * dy < r * r) return i;
        }
        return -1;
      };

      // Only tests the badge of the currently hovered node — it only exists there
      const hitTestBadge = (clientX: number, clientY: number): boolean => {
        const hovIdx = hoverRef.current;
        if (hovIdx < 0) return false;
        const node = data.nodes[hovIdx];
        if (node.x == null || node.y == null) return false;

        const rect = canvas.getBoundingClientRect();
        const { x: tx, y: ty, scale } = transformRef.current;
        const mx = (clientX - rect.left - tx) / scale;
        const my = (clientY - rect.top - ty) / scale;

        const hr = getNodeRadius(node);
        const bx = node.x + hr + 6 / scale;
        const by = node.y - hr - 6 / scale;
        const badgeHitR = 16 / scale;
        const dx = mx - bx;
        const dy = my - by;
        return dx * dx + dy * dy < badgeHitR * badgeHitR;
      };

      // Only tests the pencil (edit) badge of the currently hovered node
      const hitTestPencilBadge = (clientX: number, clientY: number): boolean => {
        const hovIdx = hoverRef.current;
        if (hovIdx < 0) return false;
        const node = data.nodes[hovIdx];
        if (node.x == null || node.y == null) return false;

        const rect = canvas.getBoundingClientRect();
        const { x: tx, y: ty, scale } = transformRef.current;
        const mx = (clientX - rect.left - tx) / scale;
        const my = (clientY - rect.top - ty) / scale;

        const hr = getNodeRadius(node);
        const badgeR = 12 / scale;
        const bx = node.x + hr + 6 / scale + badgeR * 2 + 6 / scale;
        const by = node.y - hr - 6 / scale;
        const badgeHitR = 16 / scale;
        const dx = mx - bx;
        const dy = my - by;
        return dx * dx + dy * dy < badgeHitR * badgeHitR;
      };

      // Only tests the focus (eye) badge of the currently hovered node
      const hitTestEyeBadge = (clientX: number, clientY: number): boolean => {
        const hovIdx = hoverRef.current;
        if (hovIdx < 0) return false;
        const node = data.nodes[hovIdx];
        if (node.x == null || node.y == null) return false;

        const rect = canvas.getBoundingClientRect();
        const { x: tx, y: ty, scale } = transformRef.current;
        const mx = (clientX - rect.left - tx) / scale;
        const my = (clientY - rect.top - ty) / scale;

        const hr = getNodeRadius(node);
        const ex = node.x - hr - 6 / scale;
        const ey = node.y - hr - 6 / scale;
        const badgeHitR = 16 / scale;
        const dx = mx - ex;
        const dy = my - ey;
        return dx * dx + dy * dy < badgeHitR * badgeHitR;
      };

      const scheduleOrClearPreview = (idx: number) => {
        if (idx === hoverRef.current && hoveredNodeIdRef.current === (idx >= 0 ? data.nodes[idx].id : null)) return;
        if (hoverTimerRef.current !== null) {
          clearTimeout(hoverTimerRef.current);
          hoverTimerRef.current = null;
        }
        setPreview(null);

        if (idx < 0) {
          hoveredNodeIdRef.current = null;
          return;
        }

        const node = data.nodes[idx];
        hoveredNodeIdRef.current = node.id;
        hoverTimerRef.current = setTimeout(() => {
          if (hoveredNodeIdRef.current !== node.id) return;
          const zettel = zettelsRef.current.find((z) => z.id === node.id);
          if (!zettel) return;
          const truncated = zettel.body.length > PREVIEW_BODY_LIMIT
            ? zettel.body.slice(0, PREVIEW_BODY_LIMIT) + '…'
            : zettel.body;
          const rect = canvas.getBoundingClientRect();
          const { x: tx, y: ty, scale } = transformRef.current;
          setPreview({
            x: node.x! * scale + tx,
            y: node.y! * scale + ty,
            title: node.title,
            tags: node.tags,
            connections: node.connections,
            body: truncated,
          });
        }, PREVIEW_DELAY_MS);
      };

      const onMouseMove = (e: MouseEvent) => {
        const drag = dragRef.current;

        if (!drag.active && previewRectRef.current) {
          const rect = canvas.getBoundingClientRect();
          const mx = e.clientX - rect.left;
          const my = e.clientY - rect.top;
          const r = previewRectRef.current;
          if (mx >= r.left && mx <= r.right && my >= r.top && my <= r.bottom) return;
        }

        if (drag.active && drag.isPan) {
          transformRef.current.x += e.clientX - drag.startX;
          transformRef.current.y += e.clientY - drag.startY;
          drag.startX = e.clientX;
          drag.startY = e.clientY;
          return;
        }

        if (drag.active && drag.nodeIndex >= 0) {
          const { x: tx, y: ty, scale } = transformRef.current;
          const rect = canvas.getBoundingClientRect();
          const node = data.nodes[drag.nodeIndex];
          node.x = (e.clientX - rect.left - tx) / scale;
          node.y = (e.clientY - rect.top - ty) / scale;
          (node as any).fx = node.x;
          (node as any).fy = node.y;
          simulation.alpha(0.3).restart();
          return;
        }

        const idx = hitTest(e.clientX, e.clientY);
        if (
          idx < 0 &&
          hoverRef.current >= 0 &&
          (hitTestBadge(e.clientX, e.clientY) || hitTestPencilBadge(e.clientX, e.clientY) || hitTestEyeBadge(e.clientX, e.clientY))
        ) {
          canvas.style.cursor = 'pointer';
          return;
        }
        scheduleOrClearPreview(idx);
        hoverRef.current = idx;
        canvas.style.cursor = idx >= 0 ? 'pointer' : 'grab';
      };

      const onMouseDown = (e: MouseEvent) => {
        if (hitTestBadge(e.clientX, e.clientY)) {
          const node = data.nodes[hoverRef.current];
          clearPreviewTimer();
          setNodeModal({ mode: 'create', id: node.id, title: node.title, tags: node.tags });
          return;
        }

        if (hitTestPencilBadge(e.clientX, e.clientY)) {
          const node = data.nodes[hoverRef.current];
          clearPreviewTimer();
          const zettel = zettelsRef.current.find((z) => z.id === node.id);
          if (zettel) {
            setNodeModal({ mode: 'edit', id: node.id, title: zettel.title, body: zettel.body, tags: zettel.tags });
          }
          return;
        }

        if (hitTestEyeBadge(e.clientX, e.clientY)) {
          const node = data.nodes[hoverRef.current];
          clearPreviewTimer();
          // Hard-navigate through the same ?focus=<id> entry point used from
          // the read screen's "ver no mapa" button, instead of local state.
          routerRef.current.replace(`/graph?focus=${node.id}`);
          return;
        }

        const idx = hitTest(e.clientX, e.clientY);
        if (idx >= 0) {
          dragRef.current = { active: true, nodeIndex: idx, startX: e.clientX, startY: e.clientY, isPan: false };
          const node = data.nodes[idx];
          (node as any).fx = node.x;
          (node as any).fy = node.y;
          simulation.alphaTarget(0.1).restart();
        } else {
          dragRef.current = { active: true, nodeIndex: -1, startX: e.clientX, startY: e.clientY, isPan: true };
        }
        canvas.style.cursor = 'grabbing';
      };

      const onMouseUp = (e: MouseEvent) => {
        const drag = dragRef.current;
        if (drag.active && drag.nodeIndex >= 0) {
          const node = data.nodes[drag.nodeIndex];
          const dx = e.clientX - drag.startX;
          const dy = e.clientY - drag.startY;
          if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
            routerRef.current.push(`/zettel/${node.id}`);
          }
          (node as any).fx = null;
          (node as any).fy = null;
          simulation.alphaTarget(0);
        }
        dragRef.current = { active: false, nodeIndex: -1, startX: 0, startY: 0, isPan: false };
        canvas.style.cursor = 'grab';
      };

      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const { x: tx, y: ty, scale } = transformRef.current;
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        const newScale = Math.max(0.2, Math.min(5, scale * factor));
        transformRef.current = {
          x: mx - (mx - tx) * (newScale / scale),
          y: my - (my - ty) * (newScale / scale),
          scale: newScale,
        };
      };

      // Touch support
      let lastTouchDist = 0;
      let lastTouchMid = { x: 0, y: 0 };

      const onTouchStart = (e: TouchEvent) => {
        e.preventDefault();
        if (e.touches.length === 1) {
          const touch = e.touches[0];
          const idx = hitTest(touch.clientX, touch.clientY);
          if (idx >= 0) {
            dragRef.current = { active: true, nodeIndex: idx, startX: touch.clientX, startY: touch.clientY, isPan: false };
            const node = data.nodes[idx];
            (node as any).fx = node.x;
            (node as any).fy = node.y;
            simulation.alphaTarget(0.1).restart();
          } else {
            dragRef.current = { active: true, nodeIndex: -1, startX: touch.clientX, startY: touch.clientY, isPan: true };
          }
        } else if (e.touches.length === 2) {
          const t0 = e.touches[0], t1 = e.touches[1];
          lastTouchDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
          lastTouchMid = { x: (t0.clientX + t1.clientX) / 2, y: (t0.clientY + t1.clientY) / 2 };
          dragRef.current = { active: false, nodeIndex: -1, startX: 0, startY: 0, isPan: false };
        }
      };

      const onTouchMove = (e: TouchEvent) => {
        e.preventDefault();
        if (e.touches.length === 1) {
          const touch = e.touches[0];
          const drag = dragRef.current;
          if (drag.active && drag.isPan) {
            transformRef.current.x += touch.clientX - drag.startX;
            transformRef.current.y += touch.clientY - drag.startY;
            drag.startX = touch.clientX;
            drag.startY = touch.clientY;
          } else if (drag.active && drag.nodeIndex >= 0) {
            const { x: tx, y: ty, scale } = transformRef.current;
            const rect = canvas.getBoundingClientRect();
            const node = data.nodes[drag.nodeIndex];
            node.x = (touch.clientX - rect.left - tx) / scale;
            node.y = (touch.clientY - rect.top - ty) / scale;
            (node as any).fx = node.x;
            (node as any).fy = node.y;
            simulation.alpha(0.3).restart();
          }
        } else if (e.touches.length === 2) {
          const t0 = e.touches[0], t1 = e.touches[1];
          const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
          const mid = { x: (t0.clientX + t1.clientX) / 2, y: (t0.clientY + t1.clientY) / 2 };
          const rect = canvas.getBoundingClientRect();
          const mx = mid.x - rect.left;
          const my = mid.y - rect.top;
          const { x: tx, y: ty, scale } = transformRef.current;
          const factor = dist / lastTouchDist;
          const newScale = Math.max(0.2, Math.min(5, scale * factor));
          transformRef.current = {
            x: mx - (mx - tx) * (newScale / scale) + (mid.x - lastTouchMid.x),
            y: my - (my - ty) * (newScale / scale) + (mid.y - lastTouchMid.y),
            scale: newScale,
          };
          lastTouchDist = dist;
          lastTouchMid = mid;
        }
      };

      const onTouchEnd = (e: TouchEvent) => {
        const drag = dragRef.current;
        if (drag.active && drag.nodeIndex >= 0) {
          const touch = e.changedTouches[0];
          const node = data.nodes[drag.nodeIndex];
          const dx = touch.clientX - drag.startX;
          const dy = touch.clientY - drag.startY;
          if (Math.abs(dx) < 5 && Math.abs(dy) < 5) {
            routerRef.current.push(`/zettel/${node.id}`);
          }
          (node as any).fx = null;
          (node as any).fy = null;
          simulation.alphaTarget(0);
        }
        dragRef.current = { active: false, nodeIndex: -1, startX: 0, startY: 0, isPan: false };
      };

      canvas.addEventListener('mousemove', onMouseMove);
      canvas.addEventListener('mousedown', onMouseDown);
      canvas.addEventListener('mouseup', onMouseUp);
      canvas.addEventListener('mouseleave', (e: MouseEvent) => {
        if (previewRectRef.current) {
          const rect = canvas.getBoundingClientRect();
          const mx = e.clientX - rect.left;
          const my = e.clientY - rect.top;
          const r = previewRectRef.current;
          if (mx >= r.left && mx <= r.right && my >= r.top && my <= r.bottom) return;
        }
        hoverRef.current = -1;
        clearPreviewTimer();
        const drag = dragRef.current;
        if (drag.active && drag.nodeIndex >= 0) {
          const node = data.nodes[drag.nodeIndex];
          (node as any).fx = null;
          (node as any).fy = null;
        }
        dragRef.current = { active: false, nodeIndex: -1, startX: 0, startY: 0, isPan: false };
      });
      canvas.addEventListener('wheel', onWheel, { passive: false });
      canvas.addEventListener('touchstart', onTouchStart, { passive: false });
      canvas.addEventListener('touchmove', onTouchMove, { passive: false });
      canvas.addEventListener('touchend', onTouchEnd);

      asyncCleanup = () => {
        simulation.stop();
        cancelAnimationFrame(animFrameRef.current);
        clearPreviewTimer();
        canvas.removeEventListener('mousemove', onMouseMove);
        canvas.removeEventListener('mousedown', onMouseDown);
        canvas.removeEventListener('mouseup', onMouseUp);
        canvas.removeEventListener('wheel', onWheel);
        canvas.removeEventListener('touchstart', onTouchStart);
        canvas.removeEventListener('touchmove', onTouchMove);
        canvas.removeEventListener('touchend', onTouchEnd);
      };
    });

    return () => {
      cancelled = true;
      asyncCleanup?.();
      window.removeEventListener('resize', resize);
    };
  }, [setupData, getNodeRadius, clearPreviewTimer]);

  if (!controller) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-zinc-400">Carregando…</p>
      </div>
    );
  }

  if (graphData.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-zinc-400">Crie zettels com [[links]] para ver o mapa.</p>
      </div>
    );
  }

  const previewSize = PREVIEW_PANEL_SIZE;
  let previewPos: { left: number; top: number } | null = null;
  if (preview) {
    const containerRect = containerRef.current?.getBoundingClientRect();
    let left = preview.x + 12;
    let top = preview.y - 10;
    if (containerRect) {
      if (left + previewSize.w > containerRect.width) left = preview.x - previewSize.w - 12;
      if (left < 8) left = 8;
      if (top + previewSize.h > containerRect.height) top = containerRect.height - previewSize.h - 8;
      if (top < 8) top = 8;
    }
    previewPos = { left, top };
  }

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
      <div ref={containerRef} style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
        <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%', cursor: 'grab' }} />
        {focusOriginId && (
          <button
            type="button"
            onClick={() => routerRef.current.replace('/graph')}
            title="Sair do modo focus"
            style={{
              position: 'absolute',
              top: 12,
              right: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'rgba(22,27,34,0.95)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 8,
              padding: '6px 10px',
              color: '#e6edf3',
              fontSize: '0.75rem',
              cursor: 'pointer',
              zIndex: 30,
              backdropFilter: 'blur(8px)',
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            Ver mapa completo
          </button>
        )}
        {preview && previewPos && (
          <div
            style={{
              position: 'absolute',
              left: previewPos.left,
              top: previewPos.top,
              width: previewSize.w,
              maxHeight: previewSize.h,
              pointerEvents: 'none',
              overflow: 'hidden',
              background: 'rgba(22,27,34,0.97)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 10,
              padding: '10px 14px',
              color: '#e6edf3',
              fontSize: '0.8rem',
              zIndex: 20,
              backdropFilter: 'blur(10px)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            }}
          >
            <strong style={{ display: 'block', marginBottom: 4, fontSize: '0.9rem' }}>{preview.title}</strong>
            {preview.tags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                {preview.tags.map((t) => (
                  <span
                    key={t}
                    style={{ padding: '1px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.08)', fontSize: '0.7rem', color: '#8b949e' }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
            <div style={{ maxHeight: 170, overflowY: 'auto', pointerEvents: 'auto', fontSize: '0.78rem', lineHeight: 1.4 }}>
              <MarkdownRenderer body={preview.body} disableWikiLinks onLinkPress={() => {}} />
            </div>
          </div>
        )}
      </div>
      {legend.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            padding: '0.6rem 1.5rem',
            background: '#0d1117',
            borderTop: '1px solid rgba(255,255,255,0.05)',
            alignItems: 'center',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: '0.7rem', color: '#7d8590', fontWeight: 600 }}>Clusters:</span>
          {legend.map((item) => (
            <span key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.7rem', color: '#8b949e' }}>
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: item.color, flexShrink: 0 }} />
              {item.label}
            </span>
          ))}
        </div>
      )}
      <CreateFromNodeModal
        open={!!nodeModal}
        mode={nodeModal?.mode ?? 'create'}
        nodeId={nodeModal?.id}
        originTitle={nodeModal?.title ?? ''}
        originTags={nodeModal?.tags ?? []}
        initialTitle={nodeModal?.mode === 'edit' ? nodeModal.title : undefined}
        initialBody={nodeModal?.mode === 'edit' ? nodeModal.body : undefined}
        suggestions={Array.from(new Set(zettels.flatMap((z) => z.tags)))}
        zettels={zettels}
        onClose={() => setNodeModal(null)}
        onSubmit={async (data) => {
          if (nodeModal?.mode === 'edit') {
            await updateZettel(nodeModal.id, data);
          } else {
            await createZettel(data);
          }
          setNodeModal(null);
        }}
      />
    </div>
  );
}
