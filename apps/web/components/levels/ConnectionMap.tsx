'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLevelsStore } from '../../store/useLevelsStore';
import { useZettelStore } from '../../store/useZettelStore';
import { NeonButton } from '../zkos';
import { DEFAULT_ACCENT, useLevelsEnv } from './LevelsContext';
import { aggregateRest, boundsOf, clampScale, computeSlice, fitView, type View } from './mapSlice';

const HOT = '#ff2bd6';
const ACTIVE = '#ffb000';
const DIM_EDGE = 'rgba(130,190,215,0.38)';
const DRAG_PX = 4;

interface Cluster {
  color: string;
  title: string;
  x: number;
  y: number;
}

/**
 * Nível 3 · Mapa: bolinhas, manchas de cluster e linhas (sem cards). Desenha
 * só o recorte em volta do foco e dos consultados (teto de ~400); o resto da
 * base vira manchas agregadas por célula. Canvas 2D, redesenho sob demanda.
 */
export function ConnectionMap({ onSelect }: { onSelect: (id: string) => void }) {
  const { data, isMobile } = useLevelsEnv();
  const focusId = useLevelsStore((s) => s.focusId);
  const consulted = useLevelsStore((s) => s.consulted);
  const activeId = useLevelsStore((s) => s.activeId);
  const rules = useZettelStore((s) => s.graphNodeColors);

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const viewRef = useRef<View>({ cx: 0, cy: 0, scale: 0.2 });
  const hoverRef = useRef(-1);
  const rafRef = useRef(0);
  const fontRef = useRef('monospace');
  const [size, setSize] = useState({ w: 0, h: 0 });

  const focusIdx = focusId ? data.indexById.get(focusId) : undefined;
  const activeIdx = activeId ? data.indexById.get(activeId) : undefined;

  const seeds = useMemo(() => {
    const s: number[] = [];
    if (focusIdx !== undefined) s.push(focusIdx);
    for (const id of consulted) {
      const i = data.indexById.get(id);
      if (i !== undefined && !s.includes(i)) s.push(i);
    }
    return s;
  }, [data, focusIdx, consulted]);

  const slice = useMemo(() => computeSlice(data, seeds), [data, seeds]);
  const rest = useMemo(() => aggregateRest(data, slice.mask), [data, slice]);

  const consultedSet = useMemo(() => {
    const s = new Set<number>();
    for (const id of consulted) {
      const i = data.indexById.get(id);
      if (i !== undefined) s.add(i);
    }
    return s;
  }, [data, consulted]);

  // Nome de cada cluster = título do zettel-raiz da regra de cor; fica no centro das bolinhas da cor.
  const clusters = useMemo<Cluster[]>(() => {
    const groups = new Map<string, { sx: number; sy: number; n: number; minY: number }>();
    for (const i of slice.list) {
      const c = data.nebula[i];
      if (!c) continue;
      const g = groups.get(c) ?? { sx: 0, sy: 0, n: 0, minY: Infinity };
      g.sx += data.xs[i];
      g.sy += data.ys[i];
      g.n++;
      g.minY = Math.min(g.minY, data.ys[i]);
      groups.set(c, g);
    }
    return [...groups.entries()].map(([color, g]) => ({
      color,
      title: rules.find((r) => r.color === color)?.zettelTitle ?? 'cluster',
      x: g.sx / g.n,
      y: g.minY,
    }));
  }, [data, slice, rules]);

  const edges = useMemo(() => {
    const normal: [number, number][] = [];
    const hot: [number, number][] = [];
    for (const i of slice.list) {
      for (const j of data.adjacency[i]) {
        if (j <= i || !slice.mask[j]) continue;
        (i === focusIdx || j === focusIdx ? hot : normal).push([i, j]);
      }
    }
    return { normal, hot };
  }, [data, slice, focusIdx]);

  // Rótulos: foco, consultados e os mais ligados (a colisão é resolvida ao desenhar).
  const labelOrder = useMemo(() => {
    const first = [...(focusIdx !== undefined ? [focusIdx] : []), ...consultedSet].filter((i) => slice.mask[i]);
    const others = [...slice.list].sort((a, b) => data.degree[b] - data.degree[a]).filter((i) => !first.includes(i));
    return { first: [...new Set(first)], others };
  }, [data, slice, focusIdx, consultedSet]);

  const stateRef = useRef({ data, slice, rest, edges, clusters, labelOrder, focusIdx, activeIdx, consultedSet, isMobile });
  stateRef.current = { data, slice, rest, edges, clusters, labelOrder, focusIdx, activeIdx, consultedSet, isMobile };

  const draw = useCallback(() => {
    rafRef.current = 0;
    const canvas = canvasRef.current;
    const { w, h } = sizeRef.current;
    if (!canvas || w === 0 || h === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const { data: d, slice: sl, rest: rs, edges: ed, clusters: cl, labelOrder: lo, focusIdx: fi, activeIdx: ai, consultedSet: cs } = stateRef.current;
    const v = viewRef.current;
    const px = (x: number) => (x - v.cx) * v.scale + w / 2;
    const py = (y: number) => (y - v.cy) * v.scale + h / 2;
    const inView = (x: number, y: number, pad = 60) => x > -pad && x < w + pad && y > -pad && y < h + pad;

    // Resto da base: manchas agregadas por célula.
    for (const c of rs) {
      const x = px(c.x);
      const y = py(c.y);
      if (!inView(x, y, 80)) continue;
      const r = Math.min(46, 8 + Math.sqrt(c.count) * 3);
      const col = c.color ?? '#7fb0c0';
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, hexAlpha(col, 0.28));
      g.addColorStop(1, hexAlpha(col, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Manchas dos clusters do recorte.
    for (const i of sl.list) {
      const col = d.nebula[i];
      if (!col) continue;
      const x = px(d.xs[i]);
      const y = py(d.ys[i]);
      if (!inView(x, y, 140)) continue;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 120);
      g.addColorStop(0, hexAlpha(col, 0.22));
      g.addColorStop(1, hexAlpha(col, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, 120, 0, Math.PI * 2);
      ctx.fill();
    }

    // Linhas: discretas, depois as do foco em destaque.
    ctx.lineCap = 'round';
    ctx.strokeStyle = DIM_EDGE;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const [a, b] of ed.normal) {
      ctx.moveTo(px(d.xs[a]), py(d.ys[a]));
      ctx.lineTo(px(d.xs[b]), py(d.ys[b]));
    }
    ctx.stroke();
    ctx.save();
    ctx.strokeStyle = HOT;
    ctx.shadowColor = HOT;
    ctx.shadowBlur = 8;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    for (const [a, b] of ed.hot) {
      ctx.moveTo(px(d.xs[a]), py(d.ys[a]));
      ctx.lineTo(px(d.xs[b]), py(d.ys[b]));
    }
    ctx.stroke();
    ctx.restore();

    // Bolinhas.
    for (const i of sl.list) {
      const x = px(d.xs[i]);
      const y = py(d.ys[i]);
      if (!inView(x, y)) continue;
      const col = d.nebula[i] ?? DEFAULT_ACCENT;
      const isFocus = i === fi;
      const r = isFocus ? 11 : 5 + Math.min(d.degree[i], 10) * 0.7;
      ctx.save();
      ctx.shadowColor = col;
      ctx.shadowBlur = isFocus ? 18 : 10;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1.5, r * 0.32), 0, Math.PI * 2);
      ctx.fill();
      const ring = (color: string, extra: number, width: number) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.arc(x, y, r + extra, 0, Math.PI * 2);
        ctx.stroke();
      };
      if (cs.has(i)) ring('#ffffff', 3, 1.5);
      if (i === ai) ring(ACTIVE, 6, 2);
      if (isFocus) ring(HOT, 4, 2.5);
      if (i === hoverRef.current) ring('#cfe9ee', 9, 1);
    }

    // Nomes de cluster.
    ctx.textAlign = 'center';
    ctx.font = `26px ${fontRef.current}`;
    for (const c of cl) {
      const x = px(c.x);
      const y = py(c.y) - 36;
      if (!inView(x, y, 100)) continue;
      ctx.save();
      ctx.shadowColor = c.color;
      ctx.shadowBlur = 10;
      ctx.fillStyle = c.color;
      ctx.globalAlpha = 0.85;
      ctx.fillText(`// ${c.title.toUpperCase()}`, x, y);
      ctx.restore();
    }

    // Rótulos das bolinhas, com colisão simples.
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const tryLabel = (i: number, force: boolean) => {
      const x = px(d.xs[i]);
      const y = py(d.ys[i]);
      if (!inView(x, y, 20)) return;
      const text = d.metas[i].title.trim() || 'Sem título';
      const isFocus = i === fi;
      ctx.font = `${isFocus ? 22 : 18}px ${fontRef.current}`;
      const tw = Math.min(150, ctx.measureText(text).width);
      const box = { x: x - tw / 2, y: y + 14, w: tw, h: 16 };
      if (!force && placed.some((p) => box.x < p.x + p.w && box.x + box.w > p.x && box.y < p.y + p.h && box.y + box.h > p.y)) return;
      placed.push(box);
      ctx.fillStyle = isFocus ? '#ff7be9' : '#cfe9ee';
      ctx.shadowColor = '#04060b';
      ctx.shadowBlur = 4;
      ctx.fillText(text.length > 22 ? `${text.slice(0, 21)}…` : text, x, y + 28);
      ctx.shadowBlur = 0;
    };
    for (const i of lo.first) tryLabel(i, true);
    let shown = 0;
    if (v.scale >= 0.06) {
      for (const i of lo.others) {
        if (shown >= 28) break;
        const before = placed.length;
        tryLabel(i, false);
        if (placed.length > before) shown++;
      }
    }
    if (hoverRef.current >= 0 && !lo.first.includes(hoverRef.current)) tryLabel(hoverRef.current, true);
    ctx.textAlign = 'start';
  }, []);

  const schedule = useCallback(() => {
    if (!rafRef.current) rafRef.current = requestAnimationFrame(draw);
  }, [draw]);

  // Fonte do tema (VT323 vem de uma variável do next/font).
  useEffect(() => {
    const fam = getComputedStyle(document.documentElement).getPropertyValue('--font-vt323').trim();
    fontRef.current = fam || 'monospace';
    void document.fonts?.ready.then(schedule);
  }, [schedule]);

  // Tamanho do canvas.
  useEffect(() => {
    const el = wrapRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;
    const apply = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      sizeRef.current = { w, h };
      setSize({ w, h });
      schedule();
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [schedule]);

  // Enquadra o recorte quando o foco muda (ou quando os dados chegam); consultar não reenquadra.
  const fitSlice = useCallback(() => {
    const { w, h } = sizeRef.current;
    const { data: d, slice: sl } = stateRef.current;
    viewRef.current = fitView(boundsOf(d, sl.list), w, h);
    schedule();
  }, [schedule]);
  useEffect(() => {
    if (size.w > 0 && data.ready) fitSlice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, data.ready, size.w > 0]);

  const fitAll = useCallback(() => {
    const { w, h } = sizeRef.current;
    const b = stateRef.current.data.bbox;
    viewRef.current = fitView(b ? { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY } : null, w, h, 40);
    schedule();
  }, [schedule]);

  useEffect(() => {
    schedule();
  }, [data, slice, rest, edges, clusters, labelOrder, focusIdx, activeIdx, consultedSet, schedule]);

  const zoomAt = useCallback(
    (factor: number, ax: number, ay: number) => {
      const v = viewRef.current;
      const { w, h } = sizeRef.current;
      const next = clampScale(v.scale * factor);
      // Mantém o ponto sob (ax, ay) parado.
      const wx = (ax - w / 2) / v.scale + v.cx;
      const wy = (ay - h / 2) / v.scale + v.cy;
      viewRef.current = { scale: next, cx: wx - (ax - w / 2) / next, cy: wy - (ay - h / 2) / next };
      schedule();
    },
    [schedule],
  );

  // Roda: zoom no cursor (listener não passivo para impedir a rolagem da página).
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-Math.max(-120, Math.min(120, e.deltaY)) * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const hitAt = useCallback((x: number, y: number): number => {
    const { data: d, slice: sl, isMobile: mob } = stateRef.current;
    const { w, h } = sizeRef.current;
    const v = viewRef.current;
    const radius = mob ? 22 : 14;
    let best = -1;
    let bestD = radius * radius;
    for (const i of sl.list) {
      const dx = (d.xs[i] - v.cx) * v.scale + w / 2 - x;
      const dy = (d.ys[i] - v.cy) * v.scale + h / 2 - y;
      const dist = dx * dx + dy * dy;
      if (dist <= bestD) {
        bestD = dist;
        best = i;
      }
    }
    return best;
  }, []);

  const dragRef = useRef<{ x: number; y: number; moved: boolean; id: number } | null>(null);

  const pos = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <div ref={wrapRef} className="zk-radar relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Mapa de conexões entre zettels. Use as conexões do foco ou as abas da memória para navegar pelo teclado."
        className="absolute inset-0 h-full w-full"
        style={{ touchAction: 'none', cursor: hoverRef.current >= 0 ? 'pointer' : 'grab' }}
        onPointerDown={(e) => {
          const p = pos(e);
          dragRef.current = { x: p.x, y: p.y, moved: false, id: e.pointerId };
        }}
        onPointerMove={(e) => {
          const p = pos(e);
          const d = dragRef.current;
          if (d && d.id === e.pointerId) {
            const dx = p.x - d.x;
            const dy = p.y - d.y;
            if (!d.moved && Math.hypot(dx, dy) > DRAG_PX) {
              d.moved = true;
              e.currentTarget.setPointerCapture(e.pointerId);
            }
            if (d.moved) {
              const v = viewRef.current;
              viewRef.current = { ...v, cx: v.cx - dx / v.scale, cy: v.cy - dy / v.scale };
              d.x = p.x;
              d.y = p.y;
              schedule();
              return;
            }
          }
          if (e.pointerType === 'mouse') {
            const i = hitAt(p.x, p.y);
            if (i !== hoverRef.current) {
              hoverRef.current = i;
              (e.currentTarget as HTMLElement).style.cursor = i >= 0 ? 'pointer' : 'grab';
              schedule();
            }
          }
        }}
        onPointerUp={(e) => {
          const d = dragRef.current;
          dragRef.current = null;
          if (!d || d.moved) return;
          const p = pos(e);
          const i = hitAt(p.x, p.y);
          if (i >= 0) onSelect(stateRef.current.data.ids[i]);
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
        onPointerLeave={() => {
          if (hoverRef.current !== -1) {
            hoverRef.current = -1;
            schedule();
          }
        }}
      />
      <div className="absolute right-2 top-2 flex gap-2">
        {!isMobile && (
          <>
            <NeonButton aria-label="Aproximar" onClick={() => zoomAt(1.4, size.w / 2, size.h / 2)} style={{ minHeight: 36, padding: '0 12px' }}>
              +
            </NeonButton>
            <NeonButton aria-label="Afastar" onClick={() => zoomAt(1 / 1.4, size.w / 2, size.h / 2)} style={{ minHeight: 36, padding: '0 12px' }}>
              −
            </NeonButton>
          </>
        )}
        <NeonButton onClick={fitSlice} style={{ minHeight: 36, padding: '0 10px', fontSize: 18 }}>
          FOCO
        </NeonButton>
        <NeonButton onClick={fitAll} style={{ minHeight: 36, padding: '0 10px', fontSize: 18 }}>
          VER TUDO
        </NeonButton>
      </div>
      <div className="zk-display pointer-events-none absolute bottom-2 left-3 text-[19px] text-zk-dim">
        {data.count === 0
          ? '> nenhum zettel posicionado ainda'
          : `> ${slice.list.length} de ${data.count} no recorte · clique numa bolinha para abrir na memória`}
        {data.unplacedIds.length > 0 ? ` · ${data.unplacedIds.length} sem lugar` : ''}
      </div>
    </div>
  );
}

/** `#rrggbb` + alfa → `rgba()`. Cores fora desse formato passam como estão. */
function hexAlpha(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
