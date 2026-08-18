'use client';

import { useEffect, useMemo, useRef, useCallback, useState } from 'react';
import { OfflineLink } from './OfflineLink';
import type { Zettel, Link as ZettelLink } from '@zettelkasten/core';
import { useZettelStore } from '../store/useZettelStore';
import { buildNodeColorMap } from '../lib/graphColors';
import { useOfflineRouter } from '../hooks/useOfflineRouter';

// ── Mini-map ──────────────────────────────────────────────────────────────────

interface MiniNode {
  id: string;
  color: string;
  connections: number;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

interface MiniLink {
  source: string | MiniNode;
  target: string | MiniNode;
}

function MiniMap({ zettels, links }: { zettels: Zettel[]; links: ZettelLink[] }) {
  const graphExcludedTags = useZettelStore((s) => s.graphExcludedTags);
  const graphNodeColors = useZettelStore((s) => s.graphNodeColors);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);
  const router = useOfflineRouter();

  const graphData = useMemo(() => {
    const filtered = graphExcludedTags.length
      ? zettels.filter((z) => !z.tags.some((t) => graphExcludedTags.includes(t)))
      : zettels;

    const filteredSet = new Set(filtered.map((z) => z.id));
    const filteredLinks = links.filter(
      (l) => filteredSet.has(l.sourceId) && filteredSet.has(l.targetId),
    );

    const edges = filteredLinks.map((l) => ({ source: l.sourceId, target: l.targetId }));
    const colorMap = buildNodeColorMap(graphNodeColors);

    const rgb = getComputedStyle(document.documentElement).getPropertyValue('--color-brand').trim();
    const brandColor = '#' + rgb.split(/\s+/).map((n) => parseInt(n).toString(16).padStart(2, '0')).join('');

    const connCount = new Map<string, number>();
    for (const l of filteredLinks) {
      connCount.set(l.sourceId, (connCount.get(l.sourceId) ?? 0) + 1);
      connCount.set(l.targetId, (connCount.get(l.targetId) ?? 0) + 1);
    }

    const nodes: MiniNode[] = filtered.map((z) => ({
      id: z.id,
      color: colorMap.get(z.id) ?? brandColor,
      connections: connCount.get(z.id) ?? 0,
    }));

    const graphLinks: MiniLink[] = filteredLinks.map((l) => ({
      source: l.sourceId,
      target: l.targetId,
    }));

    return { nodes, links: graphLinks };
  }, [zettels, links, graphExcludedTags, graphNodeColors]);

  const getNodeRadius = useCallback(
    (node: MiniNode) => Math.max(3, Math.min(10, 3 + node.connections * 1.2)),
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || graphData.nodes.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

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
        nodes: graphData.nodes.map((n) => ({ ...n })) as MiniNode[],
        links: graphData.links.map((l) => ({ ...l })) as MiniLink[],
      };

      const { width, height } = container.getBoundingClientRect();
      const tx = { x: width / 2, y: height / 2 };

      const simulation = d3.forceSimulation(data.nodes as any)
        .force('link', d3.forceLink(data.links).id((d: any) => d.id).distance(40).strength(0.3))
        .force('charge', d3.forceManyBody().strength(-80).distanceMax(200))
        .force('center', d3.forceCenter(0, 0))
        .force('collision', d3.forceCollide().radius((d: any) => getNodeRadius(d) + 1))
        .alphaDecay(0.02)
        .velocityDecay(0.3);

      const draw = () => {
        const { width: w, height: h } = canvas.getBoundingClientRect();

        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#0d1117';
        ctx.fillRect(0, 0, w, h);

        // Starfield — same as full map but 120 stars
        const t = Date.now() * 0.001;
        for (let i = 0; i < 120; i++) {
          const baseX = ((42 * (i + 1) * 9301 + 49297) % 233280) / 233280;
          const baseY = ((42 * (i + 1) * 7919 + 12345) % 233280) / 233280;
          const depth = i % 3;
          const parallax = [0.03, 0.07, 0.13][depth];
          const sx = ((baseX * w + tx.x * parallax) % w + w) % w;
          const sy = ((baseY * h + tx.y * parallax) % h + h) % h;
          const brightness = ((i * 3571) % 100) / 100;
          const twinkle = 0.55 + 0.45 * Math.sin(t * (0.4 + (i % 7) * 0.25) + i * 2.399);
          ctx.fillStyle = `rgba(255,255,255,${(0.04 + brightness * 0.14) * twinkle})`;
          ctx.beginPath();
          ctx.arc(sx, sy, 0.4 + brightness * 0.9, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.save();
        ctx.translate(tx.x, tx.y);

        for (const link of data.links) {
          const src = link.source as MiniNode;
          const tgt = link.target as MiniNode;
          if (src.x == null || tgt.x == null) continue;
          ctx.beginPath();
          ctx.moveTo(src.x, src.y!);
          ctx.lineTo(tgt.x, tgt.y!);
          ctx.strokeStyle = 'rgba(255,255,255,0.06)';
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }

        data.nodes.forEach((node) => {
          if (node.x == null || node.y == null) return;
          const r = getNodeRadius(node);
          ctx.beginPath();
          ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
          ctx.fillStyle = node.color;
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.2)';
          ctx.lineWidth = 0.5;
          ctx.stroke();
        });

        ctx.restore();
        animFrameRef.current = requestAnimationFrame(draw);
      };

      animFrameRef.current = requestAnimationFrame(draw);

      asyncCleanup = () => {
        simulation.stop();
        cancelAnimationFrame(animFrameRef.current);
      };
    });

    return () => {
      cancelled = true;
      asyncCleanup?.();
      window.removeEventListener('resize', resize);
    };
  }, [graphData, getNodeRadius]);

  const isEmpty = graphData.nodes.length === 0;

  return (
    <div
      onClick={() => router.push('/graph')}
      className="group relative h-full flex flex-col overflow-hidden rounded-2xl border border-zinc-800 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
      style={{ background: '#0d1117' }}
    >
      <div className="px-4 pt-3 pb-1 flex items-center justify-between shrink-0 relative z-10">
        <span className="text-xs font-semibold text-zinc-400">Mapa de conexões</span>
        <span className="text-[11px] text-brand-light group-hover:opacity-70 transition-opacity">
          Ver completo →
        </span>
      </div>
      <div ref={containerRef} className="flex-1 min-h-0 w-full">
        {isEmpty ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-zinc-600 text-center px-4">
              Crie zettels com {'[[links]]'} para ver o mapa
            </p>
          </div>
        ) : (
          <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
        )}
      </div>
      <div className="absolute inset-0 rounded-2xl ring-2 ring-transparent group-hover:ring-brand/40 transition-all pointer-events-none" />
    </div>
  );
}

// ── Timeline ──────────────────────────────────────────────────────────────────

const CHART_W = 320;
const CHART_H = 140;
const PAD = { top: 8, right: 8, bottom: 28, left: 24 };

function Timeline({ zettels }: { zettels: Zettel[] }) {
  const months = useMemo(() => {
    const counts = new Map<string, number>();
    zettels.forEach((z) => {
      const d = new Date(z.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });

    const result = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      result.push({
        key,
        label: d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''),
        count: counts.get(key) ?? 0,
      });
    }
    return result;
  }, [zettels]);

  const maxCount = Math.max(...months.map((m) => m.count), 1);
  const chartInnerW = CHART_W - PAD.left - PAD.right;
  const chartInnerH = CHART_H - PAD.top - PAD.bottom;
  const barW = chartInnerW / months.length;
  const barGap = barW * 0.25;

  return (
    <div className="flex flex-col rounded-2xl bg-white dark:bg-zinc-900 shadow-sm overflow-hidden">
      <div className="px-4 pt-3 pb-1 shrink-0">
        <span className="text-xs font-semibold text-zinc-400">Zettels criados por mês</span>
      </div>
      <div className="flex-1 flex items-end px-2 pb-2">
        <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} width="100%" height={CHART_H} preserveAspectRatio="none" className="overflow-visible">
          {/* Y axis gridlines */}
          {[0.25, 0.5, 0.75, 1].map((frac) => {
            const y = PAD.top + chartInnerH * (1 - frac);
            const val = Math.round(maxCount * frac);
            return (
              <g key={frac}>
                <line
                  x1={PAD.left} y1={y}
                  x2={PAD.left + chartInnerW} y2={y}
                  stroke="#e4e4e7"
                  strokeWidth={1}
                  className="dark:stroke-zinc-800"
                />
                <text
                  x={PAD.left - 4} y={y + 4}
                  fontSize={9}
                  fill="#a1a1aa"
                  textAnchor="end"
                >
                  {val}
                </text>
              </g>
            );
          })}

          {/* Baseline */}
          <line
            x1={PAD.left} y1={PAD.top + chartInnerH}
            x2={PAD.left + chartInnerW} y2={PAD.top + chartInnerH}
            stroke="#d4d4d8"
            strokeWidth={1}
          />

          {months.map((m, i) => {
            const barH = (m.count / maxCount) * chartInnerH;
            const x = PAD.left + i * barW + barGap / 2;
            const w = barW - barGap;
            return (
              <g key={m.key}>
                {/* Ghost bar — always visible to indicate the month slot */}
                <rect
                  x={x} y={PAD.top}
                  width={w} height={chartInnerH}
                  style={{ fill: 'rgb(var(--color-brand))' }}
                  opacity={0.04}
                />
                {m.count > 0 && (
                  <rect
                    x={x} y={PAD.top + chartInnerH - barH}
                    width={w} height={barH}
                    rx={2}
                    style={{ fill: 'rgb(var(--color-brand))' }}
                    opacity={0.75}
                  />
                )}
                <text
                  x={x + w / 2}
                  y={PAD.top + chartInnerH + 16}
                  fontSize={9}
                  fill="#a1a1aa"
                  textAnchor="middle"
                >
                  {m.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

// ── Tag ranking ───────────────────────────────────────────────────────────────

function TagRanking({ zettels }: { zettels: Zettel[] }) {
  const activeTag = useZettelStore((s) => s.activeTag);
  const setActiveTag = useZettelStore((s) => s.setActiveTag);
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    zettels.forEach((z) => z.tags.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [zettels]);

  const max = tags[0]?.[1] ?? 1;

  return (
    <div className="h-full flex flex-col rounded-2xl bg-white dark:bg-zinc-900 shadow-sm overflow-hidden">
      <div className="px-4 pt-3 pb-2 shrink-0">
        <span className="text-xs font-semibold text-zinc-400">Tags mais usadas</span>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-3 space-y-2">
        {tags.length === 0 ? (
          <p className="py-3 text-center text-xs text-zinc-400">Nenhuma tag ainda</p>
        ) : (
          tags.map(([tag, count], i) => (
            <button
              key={tag}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              className="w-full flex items-center gap-2 group text-left"
            >
              <span className="w-4 shrink-0 text-[10px] text-zinc-400">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="mb-0.5 flex items-center justify-between">
                  <span className={`truncate text-xs font-medium transition-colors ${activeTag === tag ? 'text-white bg-brand rounded px-1' : 'text-brand dark:text-brand-light group-hover:opacity-70'}`}>#{tag}</span>
                  <span className="ml-2 shrink-0 text-[10px] text-zinc-400">{count}</span>
                </div>
                <div className="h-1 rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <div
                    className="h-1 rounded-full bg-brand"
                    style={{ width: `${(count / max) * 100}%` }}
                  />
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ── Recent zettels ────────────────────────────────────────────────────────────

function RecentZettels({ zettels }: { zettels: Zettel[] }) {
  const [recentIds, setRecentIds] = useState<string[]>([]);

  useEffect(() => {
    const ids: string[] = JSON.parse(localStorage.getItem('zettel_recent') ?? '[]');
    setRecentIds(ids);
  }, []);

  const recent = recentIds
    .map((id) => zettels.find((z) => z.id === id))
    .filter(Boolean) as Zettel[];

  return (
    <div className="h-full flex flex-col rounded-2xl bg-white dark:bg-zinc-900 shadow-sm overflow-hidden">
      <div className="px-4 pt-3 pb-2 shrink-0">
        <span className="text-xs font-semibold text-zinc-400">Visitados recentemente</span>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-3 flex flex-col gap-1">
        {recent.length === 0 ? (
          <p className="py-3 text-center text-xs text-zinc-400">Nenhum zettel visitado ainda</p>
        ) : (
          recent.map((z) => (
            <OfflineLink
              key={z.id}
              href={`/zettel/${z.id}`}
              className="text-xs text-zinc-700 dark:text-zinc-300 hover:text-brand dark:hover:text-brand-light truncate py-0.5"
            >
              {z.title}
            </OfflineLink>
          ))
        )}
      </div>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-white dark:bg-zinc-900 shadow-sm px-5 py-4">
      <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">{value}</p>
      <p className="text-xs text-zinc-400 mt-0.5">{label}</p>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export function Dashboard({ zettels, links }: { zettels: Zettel[]; links: ZettelLink[] }) {
  const tagCount = useMemo(
    () => new Set(zettels.flatMap((z) => z.tags)).size,
    [zettels],
  );

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 shrink-0">
        <StatCard label="Zettels" value={zettels.length} />
        <StatCard label="Tags" value={tagCount} />
        <StatCard label="Conexões" value={links.length} />
      </div>

      {/* 3-column main area */}
      <div className="grid grid-cols-3 gap-3 flex-1 min-h-0">
        {/* Col 1: gráfico mensal (fixo) + mapa (flex) */}
        <div className="flex flex-col gap-3 min-h-0">
          <div className="shrink-0">
            <Timeline zettels={zettels} />
          </div>
          <div className="flex-1 min-h-0">
            <MiniMap zettels={zettels} links={links} />
          </div>
        </div>

        {/* Col 2: tags */}
        <TagRanking zettels={zettels} />

        {/* Col 3: visitados recentemente */}
        <RecentZettels zettels={zettels} />
      </div>
    </div>
  );
}
