'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Link, ZettelMeta } from '@zettelkasten/core';
import { useZettelStore } from '../../store/useZettelStore';
import { positionStore, subscribePositions } from '../../lib/positionSync';
import { buildNebulaMap, buildNodeColorMap, type NodeColorRule } from '../../lib/graphColors';
import { GalaxyGrid, GRID_CELL } from '../../lib/galaxy/grid';
import type { BBox } from '../../lib/galaxy/camera';

/** Nebulosa agregada por célula e cor — usada com o zoom bem afastado. */
export interface CellNebula {
  x: number;
  y: number;
  color: string;
  count: number;
}

/**
 * Dados da galáxia em arrays planos (índice = posição no array), só dos
 * zettels posicionados e visíveis. Recalculado quando índice, posições,
 * links, tags excluídas ou cores mudam — nunca por frame.
 */
export interface GalaxyData {
  count: number;
  ids: string[];
  metas: ZettelMeta[];
  indexById: Map<string, number>;
  xs: Float64Array;
  ys: Float64Array;
  degree: Int32Array;
  /** Cor do ponto (cor do cluster, ou a do tema). */
  color: string[];
  /** Cor da nebulosa do componente, ou null. */
  nebula: (string | null)[];
  /** Raiz de cluster (regra de cor) — rótulo sempre que couber. */
  isRoot: Uint8Array;
  adjacency: number[][];
  /** Índices em ordem de importância para os rótulos. */
  labelOrder: number[];
  grid: GalaxyGrid;
  cellNebulas: CellNebula[];
  bbox: BBox | null;
  /** Zettels visíveis (sem tag excluída) que ainda não têm posição. */
  unplacedIds: string[];
  /** Índice e posições já carregados ao menos uma vez. */
  ready: boolean;
}

function readBrandLight(): string {
  if (typeof window === 'undefined') return '#a78bfa';
  const rgb = getComputedStyle(document.documentElement).getPropertyValue('--color-brand-light').trim();
  if (!rgb) return '#a78bfa';
  return '#' + rgb.split(/\s+/).map((n) => parseInt(n, 10).toString(16).padStart(2, '0')).join('');
}

function build(
  zettels: ZettelMeta[],
  positions: Map<string, { x: number; y: number }>,
  links: Link[],
  excludedTags: string[],
  rules: NodeColorRule[],
): GalaxyData {
  const excluded = new Set(excludedTags);
  const visible = excluded.size
    ? zettels.filter((z) => !z.tags.some((t) => excluded.has(t)))
    : zettels;

  const placed: ZettelMeta[] = [];
  const unplacedIds: string[] = [];
  for (const z of visible) {
    if (positions.has(z.id)) placed.push(z);
    else unplacedIds.push(z.id);
  }

  const count = placed.length;
  const ids = placed.map((z) => z.id);
  const indexById = new Map(ids.map((id, i) => [id, i]));
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  let bbox: BBox | null = null;
  for (let i = 0; i < count; i++) {
    const p = positions.get(ids[i])!;
    xs[i] = p.x;
    ys[i] = p.y;
    if (!bbox) bbox = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
    else {
      bbox.minX = Math.min(bbox.minX, p.x);
      bbox.minY = Math.min(bbox.minY, p.y);
      bbox.maxX = Math.max(bbox.maxX, p.x);
      bbox.maxY = Math.max(bbox.maxY, p.y);
    }
  }

  const degree = new Int32Array(count);
  const adjSets: Set<number>[] = Array.from({ length: count }, () => new Set<number>());
  const edges: { source: string; target: string }[] = [];
  for (const l of links) {
    const a = indexById.get(l.sourceId);
    const b = indexById.get(l.targetId);
    if (a === undefined || b === undefined || a === b) continue;
    edges.push({ source: l.sourceId, target: l.targetId });
    if (!adjSets[a].has(b)) {
      adjSets[a].add(b);
      adjSets[b].add(a);
    }
  }
  const adjacency = adjSets.map((s) => [...s]);
  for (let i = 0; i < count; i++) degree[i] = adjacency[i].length;

  const brand = readBrandLight();
  const rootColors = buildNodeColorMap(rules);
  const nebulaMap = buildNebulaMap(rules, edges);
  const color: string[] = new Array(count);
  const nebula: (string | null)[] = new Array(count);
  const isRoot = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const n = nebulaMap.get(ids[i]) ?? null;
    nebula[i] = n;
    color[i] = n ?? brand;
    if (rootColors.has(ids[i])) isRoot[i] = 1;
  }

  const labelOrder = Array.from({ length: count }, (_, i) => i).sort(
    (a, b) => isRoot[b] - isRoot[a] || degree[b] - degree[a] || (ids[a] < ids[b] ? -1 : 1),
  );

  // Nebulosas agregadas por (célula, cor): com o zoom afastado, um sprite por
  // nó seria um drawImage por zettel por frame.
  const agg = new Map<string, CellNebula>();
  for (let i = 0; i < count; i++) {
    const c = nebula[i];
    if (!c) continue;
    const k = `${Math.floor(xs[i] / GRID_CELL)},${Math.floor(ys[i] / GRID_CELL)},${c}`;
    const e = agg.get(k);
    if (e) {
      e.x += xs[i];
      e.y += ys[i];
      e.count++;
    } else agg.set(k, { x: xs[i], y: ys[i], color: c, count: 1 });
  }
  const cellNebulas = [...agg.values()].map((e) => ({ ...e, x: e.x / e.count, y: e.y / e.count }));

  return {
    count,
    ids,
    metas: placed,
    indexById,
    xs,
    ys,
    degree,
    color,
    nebula,
    isRoot,
    adjacency,
    labelOrder,
    grid: new GalaxyGrid(xs, ys, count),
    cellNebulas,
    bbox,
    unplacedIds,
    ready: false,
  };
}

export function useGalaxyData(): GalaxyData {
  const zettels = useZettelStore((s) => s.zettels);
  const links = useZettelStore((s) => s.links);
  const excludedTags = useZettelStore((s) => s.graphExcludedTags);
  const rules = useZettelStore((s) => s.graphNodeColors);
  const isLoading = useZettelStore((s) => s.isLoading);
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void positionStore.getAll().then((records) => {
        if (cancelled) return;
        setPositions(new Map(records.map((r) => [r.id, { x: r.x, y: r.y }])));
      });
    };
    load();
    const unsubscribe = subscribePositions(load);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return useMemo(
    () => ({
      ...build(zettels, positions ?? new Map(), links, excludedTags, rules),
      ready: positions !== null && !isLoading,
    }),
    [zettels, positions, links, excludedTags, rules, isLoading],
  );
}
