'use client';

import { memo, useEffect, useRef } from 'react';
import type { GalaxyData } from './useGalaxyData';
import type { GalaxyEngine } from '../../lib/galaxy/engine';
import type { Camera } from '../../lib/galaxy/camera';

const W = 168;
const H = 112;
const PAD = 8;
/** Densidade dos zettels sem cor de cluster: grade grossa, nunca pontos individuais. */
const BINS_X = 42;
const BINS_Y = 28;

interface Frame {
  minX: number;
  minY: number;
  /** Pixels do minimapa por unidade de mundo. */
  k: number;
  offX: number;
  offY: number;
}

function frameFor(data: GalaxyData): Frame | null {
  const b = data.bbox;
  if (!b) return null;
  const bw = Math.max(1, b.maxX - b.minX);
  const bh = Math.max(1, b.maxY - b.minY);
  const k = Math.min((W - PAD * 2) / bw, (H - PAD * 2) / bh);
  return { minX: b.minX, minY: b.minY, k, offX: (W - bw * k) / 2, offY: (H - bh * k) / 2 };
}

/** Base do minimapa: manchas dos clusters e densidade do resto. Desenhada uma vez por mudança de dados. */
function drawBase(canvas: HTMLCanvasElement, data: GalaxyData, f: Frame, dpr: number): void {
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // Densidade (sem cor de cluster): contagem por célula da grade grossa.
  const bw = Math.max(1, data.bbox!.maxX - data.bbox!.minX);
  const bh = Math.max(1, data.bbox!.maxY - data.bbox!.minY);
  const bins = new Uint16Array(BINS_X * BINS_Y);
  let max = 1;
  for (let i = 0; i < data.count; i++) {
    if (data.nebula[i]) continue;
    const bx = Math.min(BINS_X - 1, Math.floor(((data.xs[i] - f.minX) / bw) * BINS_X));
    const by = Math.min(BINS_Y - 1, Math.floor(((data.ys[i] - f.minY) / bh) * BINS_Y));
    const n = ++bins[by * BINS_X + bx];
    if (n > max) max = n;
  }
  const cw = (bw * f.k) / BINS_X;
  const ch = (bh * f.k) / BINS_Y;
  ctx.fillStyle = '#8b93a3';
  for (let by = 0; by < BINS_Y; by++) {
    for (let bx = 0; bx < BINS_X; bx++) {
      const n = bins[by * BINS_X + bx];
      if (!n) continue;
      ctx.globalAlpha = 0.12 + 0.3 * (Math.log(1 + n) / Math.log(1 + max));
      ctx.fillRect(f.offX + bx * cw, f.offY + by * ch, Math.max(1.5, cw), Math.max(1.5, ch));
    }
  }

  // Clusters: uma mancha por célula agregada, na cor dela.
  for (const n of data.cellNebulas) {
    const cx = f.offX + (n.x - f.minX) * f.k;
    const cy = f.offY + (n.y - f.minY) * f.k;
    const r = Math.min(26, Math.max(4, 700 * f.k * (1 + Math.sqrt(Math.min(n.count, 25)) * 0.35)));
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, n.color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  ctx.globalAlpha = 1;
}

/**
 * Minimapa da galáxia (canto inferior direito, a partir de `lg`): onde estão
 * os clusters e que parte do mapa a câmera mostra. Clique/arraste centraliza a
 * câmera (sem animação, mantendo o zoom). A base só é redesenhada quando os
 * dados mudam; a cada mudança de câmera só se redesenha o retângulo, uma vez
 * por frame.
 */
export const Minimap = memo(function Minimap({ data, engine }: { data: GalaxyData; engine: GalaxyEngine | null }) {
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<Frame | null>(null);
  const camRef = useRef<Camera | null>(null);
  const rafRef = useRef(0);
  const dragging = useRef(false);

  const drawView = () => {
    rafRef.current = 0;
    const canvas = viewRef.current;
    const f = frameRef.current;
    const cam = camRef.current;
    if (!canvas || !f || !cam || !engine) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(W * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (baseRef.current) ctx.drawImage(baseRef.current, 0, 0, W, H);
    const { w, h } = engine.getSize();
    const hw = w / 2 / cam.scale;
    const hh = h / 2 / cam.scale;
    const x0 = f.offX + (cam.x - hw - f.minX) * f.k;
    const y0 = f.offY + (cam.y - hh - f.minY) * f.k;
    const rw = Math.max(3, hw * 2 * f.k);
    const rh = Math.max(3, hh * 2 * f.k);
    ctx.strokeStyle = '#a78bfa';
    ctx.lineWidth = 1.5;
    ctx.fillStyle = 'rgba(167,139,250,0.12)';
    ctx.fillRect(x0, y0, rw, rh);
    ctx.strokeRect(x0, y0, rw, rh);
  };
  const schedule = () => {
    if (!rafRef.current) rafRef.current = requestAnimationFrame(drawView);
  };

  // Base: só quando os dados mudam.
  useEffect(() => {
    const f = frameRef.current = frameFor(data);
    if (!f) return;
    const canvas = baseRef.current ?? (baseRef.current = document.createElement('canvas'));
    drawBase(canvas, data, f, window.devicePixelRatio || 1);
    camRef.current = engine?.getCamera() ?? camRef.current;
    schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, engine]);

  // Câmera: só o retângulo, no máximo uma vez por frame.
  useEffect(() => {
    if (!engine) return;
    camRef.current = engine.getCamera();
    schedule();
    const off = engine.addCameraListener((cam) => {
      camRef.current = cam;
      schedule();
    });
    return () => {
      off();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  const moveTo = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const f = frameRef.current;
    if (!f || !engine) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * W;
    const my = ((e.clientY - rect.top) / rect.height) * H;
    engine.setCameraCenter(f.minX + (mx - f.offX) / f.k, f.minY + (my - f.offY) / f.k);
  };

  return (
    <canvas
      ref={viewRef}
      role="img"
      aria-label="Minimapa: o recorte atual dentro da galáxia. Clique ou arraste para mover a câmera."
      width={W}
      height={H}
      style={{ width: W, height: H, touchAction: 'none' }}
      className="absolute bottom-16 right-4 z-30 hidden cursor-pointer rounded-lg border border-white/10 bg-[#070a10]/90 shadow-lg lg:block"
      onPointerDown={(e) => {
        e.stopPropagation();
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        moveTo(e);
      }}
      onPointerMove={(e) => {
        if (dragging.current) moveTo(e);
      }}
      onPointerUp={(e) => {
        dragging.current = false;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
});
