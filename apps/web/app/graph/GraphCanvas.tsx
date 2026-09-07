'use client';

import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useZettelStore } from '../../store/useZettelStore';
import { useOfflineRouter } from '../../hooks/useOfflineRouter';
import { buildNodeColorMap, buildNebulaMap } from '../../lib/graphColors';
import { loadLayoutCache, isLayoutCacheValid } from '../../lib/graphLayoutCache';
import { CreateFromNodeModal } from '../../components/CreateFromNodeModal';
import { MarkdownRenderer } from '../../components/MarkdownRenderer';
import { buildStars, drawStarfield } from './starfield';
import { getNebulaSprite, NEBULA_WORLD_RADIUS } from './nebulaSprites';

/**
 * Permanência do cursor sobre o nó antes de abrir o preview. Com 0, atravessar
 * nós durante um pan disparava dois renders React e um parse de markdown por nó
 * cruzado.
 */
const PREVIEW_DELAY_MS = 120;
const PREVIEW_BODY_LIMIT = 1000;
const PREVIEW_PANEL_SIZE = { w: 320, h: 260 };

const TAU = Math.PI * 2;

/** Intervalo entre atualizações da cintilação das estrelas (~15fps). */
const TWINKLE_INTERVAL_MS = 66;

/**
 * Margem, em unidades do mundo, somada à área visível antes do culling. Precisa
 * cobrir o raio da névoa (80) mais a folga do label, para que um nó logo além da
 * borda ainda desenhe o que dele invade a tela.
 */
const CULL_PADDING = 100;

const NEBULA_SPRITE_SIZE = NEBULA_WORLD_RADIUS * 2;

interface GraphNode {
  id: string;
  title: string;
  /** Título já truncado para exibição — evita alocar string por frame. */
  label: string;
  tags: string[];
  color: string;
  connections: number;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  /** Maior contagem de conexões do grafo — base do LOD dos labels. */
  maxConn: number;
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
}

interface LegendItem {
  label: string;
  color: string;
}

const LABEL_MAX_CHARS = 28;

function truncateLabel(title: string): string {
  return title.length > LABEL_MAX_CHARS ? title.slice(0, LABEL_MAX_CHARS - 1) + '…' : title;
}

export function GraphCanvas() {
  // Selectors individuais: com o destructure do store inteiro o componente
  // re-renderizava a cada mutação, inclusive de campos que o mapa não usa
  // (isLoading, activeTag, resultados de busca).
  const zettels = useZettelStore((s) => s.zettels);
  const links = useZettelStore((s) => s.links);
  const controller = useZettelStore((s) => s.controller);
  const graphExcludedTags = useZettelStore((s) => s.graphExcludedTags);
  const graphNodeColors = useZettelStore((s) => s.graphNodeColors);
  const createZettel = useZettelStore((s) => s.createZettel);
  const updateZettel = useZettelStore((s) => s.updateZettel);
  const router = useOfflineRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const searchParams = useSearchParams();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);
  const simulationRef = useRef<{ simulation: any; data: GraphData } | null>(null);

  // Dimensões do canvas em cache. Antes cada evento de mousemove podia disparar
  // até quatro getBoundingClientRect() (hitTest + os três testes de badge).
  const canvasRectRef = useRef({ left: 0, top: 0, width: 0, height: 0 });

  // Uma camada suja é repintada no próximo frame; um frame sem nada sujo não
  // desenha nada. Marcar sempre por markDirty/markBgDirty, nunca por atribuição
  // direta — é o que mantém rastreável quem acorda o loop.
  const dirtyRef = useRef(true);
  const bgDirtyRef = useRef(true);
  const markDirty = useCallback(() => { dirtyRef.current = true; }, []);
  const markBgDirty = useCallback(() => { bgDirtyRef.current = true; }, []);

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
  const [setupData, setSetupData] = useState<GraphData | null>(null);
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
    // Retornar a mesma referência faz o React abortar o re-render — evita um
    // render por nó atravessado quando não há preview aberto.
    setPreview((p) => (p === null ? p : null));
  }, []);

  const getNodeRadius = useCallback((node: GraphNode) => {
    return Math.max(4, Math.min(14, 4 + node.connections * 1.5));
  }, []);

  const { graphData, legend, nebulaMap } = useMemo(() => {
    const empty = {
      graphData: { nodes: [] as GraphNode[], links: [] as GraphLink[], maxConn: 1 } as GraphData,
      legend: [] as LegendItem[],
      nebulaMap: new Map<string, string>(),
    };
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
      label: truncateLabel(z.title),
      tags: z.tags,
      color: colorMap.get(z.id) ?? brandColor,
      connections: connCount.get(z.id) ?? 0,
    }));

    // Laço em vez de Math.max(...nodes.map(...)): o spread alocava um array e o
    // passava como argumentos a cada frame.
    let maxConn = 1;
    for (const n of nodes) {
      if (n.connections > maxConn) maxConn = n.connections;
    }

    const graphLinks: GraphLink[] = finalFilteredLinks.map((l) => ({
      source: l.sourceId,
      target: l.targetId,
    }));

    const legendItems: LegendItem[] = graphNodeColors.map((rule) => ({
      label: rule.zettelTitle,
      color: rule.color,
    }));

    return { graphData: { nodes, links: graphLinks, maxConn }, legend: legendItems, nebulaMap };
  }, [zettels, links, controller, graphExcludedTags, graphNodeColors, focusOriginId]);

  // Recalcular isso em todo render varre a lista inteira de zettels por causa
  // de um modal que quase sempre está fechado.
  const tagSuggestions = useMemo(
    () => Array.from(new Set(zettels.flatMap((z) => z.tags))),
    [zettels],
  );

  // O loop de desenho lê a névoa por ref: assim uma regra de cor nova aparece
  // sem depender de o efeito pesado ser recriado.
  const nebulaMapRef = useRef(nebulaMap);
  useEffect(() => {
    nebulaMapRef.current = nebulaMap;
    markDirty();
  }, [nebulaMap, markDirty]);

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
        oldNode.label = fresh.label;
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
    sim.data.maxConn = graphData.maxConn;
    sim.simulation.nodes(sim.data.nodes);
    (sim.simulation.force('link') as any).links(sim.data.links);
    sim.simulation.alpha(0.3).restart();
    markDirty();
  }, [graphData, focusOriginId, markDirty]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !setupData || setupData.nodes.length === 0) return;

    const ctx = canvas.getContext('2d');
    const bgCanvas = bgCanvasRef.current;
    // Camada de fundo é opaca: nada por baixo dela, então alpha: false permite
    // ao navegador pular a composição com transparência.
    const bgCtx = bgCanvas ? bgCanvas.getContext('2d', { alpha: false }) : null;
    if (!ctx || !bgCanvas || !bgCtx) return;

    // cancelled flag + asyncCleanup let the sync cleanup function reach inside
    // the async .then() callback. Without this, cancelAnimationFrame and
    // simulation.stop() run before the import resolves, so the previous loop
    // is never cancelled and multiple simulations pile up (especially visible
    // in React Strict Mode which double-invokes effects in development).
    let cancelled = false;
    let asyncCleanup: (() => void) | undefined;

    const stars = buildStars();

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      for (const [el, c] of [[canvas, ctx], [bgCanvas, bgCtx]] as const) {
        el.width = rect.width * dpr;
        el.height = rect.height * dpr;
        el.style.width = `${rect.width}px`;
        el.style.height = `${rect.height}px`;
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      // Os dois canvases preenchem o container, então o rect dele serve aos
      // testes de acerto — que assim param de consultar o layout por evento.
      canvasRectRef.current = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      markDirty();
      markBgDirty();
    };
    resize();

    // ResizeObserver pega mudança só do container (a legenda de clusters
    // aparecendo, por exemplo), que o listener de window não vê; o listener de
    // window continua por causa de rotação de tela e teclado virtual no mobile.
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleResize = () => {
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = null;
        resize();
      }, 100);
    };
    const resizeObserver = new ResizeObserver(scheduleResize);
    resizeObserver.observe(container);
    window.addEventListener('resize', scheduleResize);

    import('d3-force').then((d3) => {
      if (cancelled) return;
      const data: GraphData = {
        nodes: setupData.nodes.map((n) => ({ ...n })) as GraphNode[],
        links: setupData.links.map((l) => ({ ...l })) as GraphLink[],
        maxConn: setupData.maxConn,
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

      // O tick é emitido exatamente quando as posições mudam, e a d3 para de
      // emitir quando a simulação esfria — é o que deixa o loop dormir sem
      // ninguém precisar consultar alpha() por frame.
      simulation.on('tick', markDirty);

      simulationRef.current = { simulation, data };

      const drawBackground = (now: number) => {
        const { width: w, height: h } = canvasRectRef.current;
        const { x: tx, y: ty } = transformRef.current;
        bgCtx.fillStyle = '#0d1117';
        bgCtx.fillRect(0, 0, w, h);
        drawStarfield(bgCtx, stars, w, h, tx, ty, now);
      };

      // Reaproveitados entre frames para não realocar a cada desenho.
      const visibleIdx: number[] = [];
      const visibleR: number[] = [];
      const fillPaths = new Map<string, Path2D>();
      const strokePaths = new Map<string, Path2D>();

      const drawGraph = () => {
        const { width: w, height: h } = canvasRectRef.current;
        const { x: tx, y: ty, scale } = transformRef.current;
        const hovIdx = hoverRef.current;
        const nodes = data.nodes;
        const hovNode = hovIdx >= 0 ? nodes[hovIdx] ?? null : null;

        // Transparente: o campo de estrelas está no canvas de baixo.
        ctx.clearRect(0, 0, w, h);

        ctx.save();
        ctx.translate(tx, ty);
        ctx.scale(scale, scale);

        // Área visível em coordenadas do mundo — base do culling.
        const x0 = -tx / scale - CULL_PADDING;
        const y0 = -ty / scale - CULL_PADDING;
        const x1 = (w - tx) / scale + CULL_PADDING;
        const y1 = (h - ty) / scale + CULL_PADDING;

        const hoveredConnections = new Set<string>();
        if (hovNode) {
          for (const link of data.links) {
            const src = link.source as GraphNode;
            const tgt = link.target as GraphNode;
            if (src?.id === hovNode.id) hoveredConnections.add(tgt.id);
            if (tgt?.id === hovNode.id) hoveredConnections.add(src.id);
          }
        }

        // Índices dos nós visíveis. Guardamos o índice ORIGINAL: hoverRef e
        // dragRef.nodeIndex referenciam nós por posição no array, então filtrar
        // para um array novo faria hover e arraste agirem sobre o nó errado.
        visibleIdx.length = 0;
        visibleR.length = 0;
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i];
          if (node.x == null || node.y == null) continue;
          if (node.x < x0 || node.x > x1 || node.y < y0 || node.y > y1) continue;
          visibleIdx.push(i);
          visibleR.push(getNodeRadius(node));
        }

        // Névoa de cluster — sprite por cor, desenhado antes de links e nós
        for (let k = 0; k < visibleIdx.length; k++) {
          const node = nodes[visibleIdx[k]];
          const nebulaColor = nebulaMapRef.current.get(node.id);
          if (!nebulaColor) continue;
          const sprite = getNebulaSprite(nebulaColor);
          if (!sprite) continue;
          ctx.drawImage(
            sprite,
            node.x! - NEBULA_WORLD_RADIUS,
            node.y! - NEBULA_WORLD_RADIUS,
            NEBULA_SPRITE_SIZE,
            NEBULA_SPRITE_SIZE,
          );
        }

        // Links — dois paths acumulados, um stroke por estilo
        const normalPath = new Path2D();
        const highlightPath = new Path2D();
        for (const link of data.links) {
          const src = link.source as GraphNode;
          const tgt = link.target as GraphNode;
          if (src.x == null || src.y == null || tgt.x == null || tgt.y == null) continue;
          if (Math.max(src.x, tgt.x) < x0 || Math.min(src.x, tgt.x) > x1) continue;
          if (Math.max(src.y, tgt.y) < y0 || Math.min(src.y, tgt.y) > y1) continue;

          const path = hovNode && (src.id === hovNode.id || tgt.id === hovNode.id)
            ? highlightPath
            : normalPath;
          path.moveTo(src.x, src.y);
          path.lineTo(tgt.x, tgt.y);
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 0.5;
        ctx.stroke(normalPath);
        if (hovNode) {
          ctx.strokeStyle = 'rgba(255,255,255,0.4)';
          ctx.lineWidth = 1.5;
          ctx.stroke(highlightPath);
        }

        // Brilho radial do nó em hover e dos seus vizinhos
        if (hovNode) {
          for (let k = 0; k < visibleIdx.length; k++) {
            const i = visibleIdx[k];
            const node = nodes[i];
            if (i !== hovIdx && !hoveredConnections.has(node.id)) continue;
            const r = visibleR[k];
            const gradient = ctx.createRadialGradient(node.x!, node.y!, r * 0.5, node.x!, node.y!, r * 3);
            gradient.addColorStop(0, node.color + '60');
            gradient.addColorStop(1, node.color + '00');
            ctx.beginPath();
            ctx.arc(node.x!, node.y!, r * 3, 0, TAU);
            ctx.fillStyle = gradient;
            ctx.fill();
          }
        }

        // Círculos — agrupados por estilo, um fill/stroke por bucket. Cada arc
        // precisa de um moveTo antes, senão o subpath se liga ao anterior por
        // uma reta.
        fillPaths.clear();
        strokePaths.clear();
        for (let k = 0; k < visibleIdx.length; k++) {
          const i = visibleIdx[k];
          if (i === hovIdx) continue; // desenhado à parte: raio e traço diferentes
          const node = nodes[i];
          const r = visibleR[k];
          const dimmed = hovNode !== null && !hoveredConnections.has(node.id);
          const fillStyle = dimmed ? node.color + '30' : node.color;
          const strokeStyle = dimmed ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.2)';

          let fillPath = fillPaths.get(fillStyle);
          if (!fillPath) {
            fillPath = new Path2D();
            fillPaths.set(fillStyle, fillPath);
          }
          fillPath.moveTo(node.x! + r, node.y!);
          fillPath.arc(node.x!, node.y!, r, 0, TAU);

          let strokePath = strokePaths.get(strokeStyle);
          if (!strokePath) {
            strokePath = new Path2D();
            strokePaths.set(strokeStyle, strokePath);
          }
          strokePath.moveTo(node.x! + r, node.y!);
          strokePath.arc(node.x!, node.y!, r, 0, TAU);
        }
        for (const [style, path] of fillPaths) {
          ctx.fillStyle = style;
          ctx.fill(path);
        }
        ctx.lineWidth = 0.5;
        for (const [style, path] of strokePaths) {
          ctx.strokeStyle = style;
          ctx.stroke(path);
        }

        const hovR = hovNode ? getNodeRadius(hovNode) : 0;
        if (hovNode && hovNode.x != null && hovNode.y != null) {
          const r = hovR * 1.4;
          ctx.beginPath();
          ctx.arc(hovNode.x, hovNode.y, r, 0, TAU);
          ctx.fillStyle = hovNode.color;
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.2)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Labels — segunda passada, para o texto ficar sempre sobre os círculos.
        // LOD: o threshold cai conforme o zoom sobe, revelando mais labels.
        const labelThreshold = data.maxConn * 0.2 / scale;
        const fontSize = 10 / scale;
        const labelOffset = 13 / scale;
        ctx.textAlign = 'center';
        ctx.shadowColor = 'rgba(0,0,0,0.9)';
        ctx.shadowBlur = 3;
        // Uma string de fonte por frame: fontSize só depende do scale, e trocar
        // ctx.font é uma das mudanças de estado mais caras do contexto 2D.
        ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;

        let lastLabelFill = '';
        for (let k = 0; k < visibleIdx.length; k++) {
          const i = visibleIdx[k];
          if (i === hovIdx) continue;
          const node = nodes[i];
          if (node.connections < labelThreshold) continue;

          const fill = hovNode && !hoveredConnections.has(node.id)
            ? 'rgba(161,161,170,0.4)'
            : '#a1a1aa';
          if (fill !== lastLabelFill) {
            ctx.fillStyle = fill;
            lastLabelFill = fill;
          }
          ctx.fillText(node.label, node.x!, node.y! + visibleR[k] + labelOffset);
        }
        if (hovNode && hovNode.x != null && hovNode.y != null) {
          ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
          ctx.fillStyle = '#ffffff';
          ctx.fillText(hovNode.label, hovNode.x, hovNode.y + hovR + labelOffset);
        }

        ctx.shadowBlur = 0;

        // Badges do nó em hover: "+" (criar), lápis (editar) e olho (focar)
        if (hovNode && !dragRef.current.active && hovNode.x != null && hovNode.y != null) {
          const badgeR = 12 / scale;
          const bx = hovNode.x + hovR + 6 / scale;
          const by = hovNode.y - hovR - 6 / scale;

          ctx.beginPath();
          ctx.arc(bx, by, badgeR, 0, TAU);
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

          const px = bx + badgeR * 2 + 6 / scale;

          ctx.beginPath();
          ctx.arc(px, by, badgeR, 0, TAU);
          ctx.fillStyle = 'rgba(39,39,42,0.9)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.8)';
          ctx.lineWidth = 1 / scale;
          ctx.stroke();

          ctx.save();
          ctx.translate(px, by);
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

          const ex = hovNode.x - hovR - 6 / scale;

          ctx.beginPath();
          ctx.arc(ex, by, badgeR, 0, TAU);
          ctx.fillStyle = 'rgba(39,39,42,0.9)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.8)';
          ctx.lineWidth = 1 / scale;
          ctx.stroke();

          ctx.beginPath();
          ctx.ellipse(ex, by, 5.5 / scale, 3 / scale, 0, 0, TAU);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.3 / scale;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(ex, by, 1.8 / scale, 0, TAU);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
        }

        ctx.restore();
      };

      /** Converte coordenadas de tela em coordenadas do mundo, sem tocar no layout. */
      const toWorld = (clientX: number, clientY: number) => {
        const rect = canvasRectRef.current;
        const { x: tx, y: ty, scale } = transformRef.current;
        return {
          x: (clientX - rect.left - tx) / scale,
          y: (clientY - rect.top - ty) / scale,
        };
      };

      const hitTest = (clientX: number, clientY: number): number => {
        const { x: mx, y: my } = toWorld(clientX, clientY);

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

        const { x: mx, y: my } = toWorld(clientX, clientY);
        const { scale } = transformRef.current;
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

        const { x: mx, y: my } = toWorld(clientX, clientY);
        const { scale } = transformRef.current;
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

        const { x: mx, y: my } = toWorld(clientX, clientY);
        const { scale } = transformRef.current;
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
        // Mesma referência => o React aborta o re-render. Sem isso, atravessar
        // nós durante um pan disparava um render por nó cruzado.
        setPreview((p) => (p === null ? p : null));

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

      let cursor = 'grab';
      const setCursor = (value: string) => {
        if (cursor === value) return;
        cursor = value;
        canvas.style.cursor = value;
      };

      const setHover = (idx: number) => {
        if (hoverRef.current === idx) return;
        hoverRef.current = idx;
        markDirty();
      };

      const handleMove = (clientX: number, clientY: number) => {
        const drag = dragRef.current;

        if (!drag.active && previewRectRef.current) {
          const rect = canvasRectRef.current;
          const mx = clientX - rect.left;
          const my = clientY - rect.top;
          const r = previewRectRef.current;
          if (mx >= r.left && mx <= r.right && my >= r.top && my <= r.bottom) return;
        }

        if (drag.active && drag.isPan) {
          transformRef.current.x += clientX - drag.startX;
          transformRef.current.y += clientY - drag.startY;
          drag.startX = clientX;
          drag.startY = clientY;
          markDirty();
          markBgDirty();
          return;
        }

        if (drag.active && drag.nodeIndex >= 0) {
          const node = data.nodes[drag.nodeIndex];
          const world = toWorld(clientX, clientY);
          node.x = world.x;
          node.y = world.y;
          (node as any).fx = node.x;
          (node as any).fy = node.y;
          simulation.alpha(0.3).restart();
          markDirty();
          return;
        }

        const idx = hitTest(clientX, clientY);
        if (
          idx < 0 &&
          hoverRef.current >= 0 &&
          (hitTestBadge(clientX, clientY) || hitTestPencilBadge(clientX, clientY) || hitTestEyeBadge(clientX, clientY))
        ) {
          setCursor('pointer');
          return;
        }
        scheduleOrClearPreview(idx);
        setHover(idx);
        setCursor(idx >= 0 ? 'pointer' : 'grab');
      };

      // Movimento do ponteiro é coalescido: o handler só guarda a última
      // posição e o teste de acerto roda no máximo uma vez por frame.
      const pendingPointer = { x: 0, y: 0, has: false };
      const flushPointer = () => {
        if (!pendingPointer.has) return;
        pendingPointer.has = false;
        handleMove(pendingPointer.x, pendingPointer.y);
      };
      const queuePointer = (clientX: number, clientY: number) => {
        pendingPointer.x = clientX;
        pendingPointer.y = clientY;
        pendingPointer.has = true;
      };

      const onMouseMove = (e: MouseEvent) => {
        queuePointer(e.clientX, e.clientY);
      };

      const onMouseDown = (e: MouseEvent) => {
        // Os testes de badge dependem de hoverRef, que só é atualizado ao
        // processar o movimento — resolvemos o pendente antes de decidir.
        flushPointer();

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
        setCursor('grabbing');
        markDirty();
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
        setCursor('grab');
        markDirty();
      };

      const onMouseLeave = (e: MouseEvent) => {
        if (previewRectRef.current) {
          const rect = canvasRectRef.current;
          const mx = e.clientX - rect.left;
          const my = e.clientY - rect.top;
          const r = previewRectRef.current;
          if (mx >= r.left && mx <= r.right && my >= r.top && my <= r.bottom) return;
        }
        pendingPointer.has = false;
        setHover(-1);
        clearPreviewTimer();
        const drag = dragRef.current;
        if (drag.active && drag.nodeIndex >= 0) {
          const node = data.nodes[drag.nodeIndex];
          (node as any).fx = null;
          (node as any).fy = null;
        }
        dragRef.current = { active: false, nodeIndex: -1, startX: 0, startY: 0, isPan: false };
        markDirty();
      };

      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const rect = canvasRectRef.current;
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
        markDirty();
        markBgDirty();
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
          pendingPointer.has = false;
        }
        markDirty();
      };

      const onTouchMove = (e: TouchEvent) => {
        e.preventDefault();
        if (e.touches.length === 1) {
          // Um dedo segue o mesmo caminho do mouse (pan ou arraste de nó),
          // coalescido em rAF.
          const touch = e.touches[0];
          queuePointer(touch.clientX, touch.clientY);
        } else if (e.touches.length === 2) {
          const t0 = e.touches[0], t1 = e.touches[1];
          const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
          const mid = { x: (t0.clientX + t1.clientX) / 2, y: (t0.clientY + t1.clientY) / 2 };
          const rect = canvasRectRef.current;
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
          markDirty();
          markBgDirty();
        }
      };

      const onTouchEnd = (e: TouchEvent) => {
        pendingPointer.has = false;
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
        markDirty();
      };

      canvas.addEventListener('mousemove', onMouseMove);
      canvas.addEventListener('mousedown', onMouseDown);
      canvas.addEventListener('mouseup', onMouseUp);
      canvas.addEventListener('mouseleave', onMouseLeave);
      canvas.addEventListener('wheel', onWheel, { passive: false });
      canvas.addEventListener('touchstart', onTouchStart, { passive: false });
      canvas.addEventListener('touchmove', onTouchMove, { passive: false });
      canvas.addEventListener('touchend', onTouchEnd);

      // Um frame sem nada sujo não desenha — só resolve o ponteiro pendente e
      // reagenda, o que é praticamente de graça.
      let lastTwinkle = 0;
      const frame = (now: number) => {
        animFrameRef.current = requestAnimationFrame(frame);
        flushPointer();
        if (now - lastTwinkle >= TWINKLE_INTERVAL_MS) {
          lastTwinkle = now;
          markBgDirty();
        }
        if (bgDirtyRef.current) {
          bgDirtyRef.current = false;
          drawBackground(now);
        }
        if (dirtyRef.current) {
          dirtyRef.current = false;
          drawGraph();
        }
      };
      animFrameRef.current = requestAnimationFrame(frame);

      asyncCleanup = () => {
        simulation.on('tick', null);
        simulation.stop();
        cancelAnimationFrame(animFrameRef.current);
        clearPreviewTimer();
        canvas.removeEventListener('mousemove', onMouseMove);
        canvas.removeEventListener('mousedown', onMouseDown);
        canvas.removeEventListener('mouseup', onMouseUp);
        canvas.removeEventListener('mouseleave', onMouseLeave);
        canvas.removeEventListener('wheel', onWheel);
        canvas.removeEventListener('touchstart', onTouchStart);
        canvas.removeEventListener('touchmove', onTouchMove);
        canvas.removeEventListener('touchend', onTouchEnd);
      };
    });

    return () => {
      cancelled = true;
      asyncCleanup?.();
      resizeObserver.disconnect();
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      window.removeEventListener('resize', scheduleResize);
    };
  }, [setupData, getNodeRadius, clearPreviewTimer, markDirty, markBgDirty]);

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
        {/* Duas camadas: as estrelas cintilam sozinhas, então manter o grafo no
            mesmo canvas obrigaria a repintá-lo junto e anularia o dirty flag. */}
        <canvas ref={bgCanvasRef} style={{ position: 'absolute', inset: 0, display: 'block' }} />
        <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, display: 'block', cursor: 'grab' }} />
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
        suggestions={tagSuggestions}
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
