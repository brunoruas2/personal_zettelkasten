import { useCallback, useEffect, useRef, type RefObject } from 'react';

const MIN_SCALE = 0.5;
const MAX_SCALE = 8;
const DOUBLE_TAP_SCALE = 2.5;
const DOUBLE_TAP_MS = 300;
const TAP_SLOP = 24;
const BUTTON_STEP = 1.4;
const WHEEL_SENSITIVITY = 0.002;

interface Transform { scale: number; x: number; y: number }
interface Point { x: number; y: number }

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/**
 * Pinch-zoom + pan sobre `targetRef`, ouvindo eventos em `surfaceRef`.
 * O estado vive em ref e o transform é escrito direto no style (rAF coalescido):
 * um gesto dispara dezenas de eventos por segundo e re-renderizar o SVG a cada um é caro.
 * `transform-origin` do alvo precisa ser `0 0`.
 */
export function usePinchZoom(
  surfaceRef: RefObject<HTMLElement | null>,
  targetRef: RefObject<HTMLElement | null>,
) {
  const tf = useRef<Transform>({ scale: 1, x: 0, y: 0 });
  const raf = useRef(0);

  const flush = useCallback(() => {
    raf.current = 0;
    const el = targetRef.current;
    if (!el) return;
    const { scale, x, y } = tf.current;
    el.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  }, [targetRef]);

  const schedule = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(flush);
  }, [flush]);

  // Muda a escala mantendo o ponto `p` (coordenadas da surface) fixo na tela.
  const zoomAt = useCallback((p: Point, nextScale: number) => {
    const t = tf.current;
    const s = clampScale(nextScale);
    const k = s / t.scale;
    tf.current = { scale: s, x: p.x - (p.x - t.x) * k, y: p.y - (p.y - t.y) * k };
    schedule();
  }, [schedule]);

  const center = useCallback((): Point => {
    const r = surfaceRef.current?.getBoundingClientRect();
    return r ? { x: r.width / 2, y: r.height / 2 } : { x: 0, y: 0 };
  }, [surfaceRef]);

  const reset = useCallback(() => {
    tf.current = { scale: 1, x: 0, y: 0 };
    schedule();
  }, [schedule]);

  const zoomIn = useCallback(() => zoomAt(center(), tf.current.scale * BUTTON_STEP), [zoomAt, center]);
  const zoomOut = useCallback(() => zoomAt(center(), tf.current.scale / BUTTON_STEP), [zoomAt, center]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    const pointers = new Map<number, Point>();
    // Baseline do gesto: refeito sempre que muda o número de ponteiros.
    let base: { t: Transform; mid: Point; dist: number } | null = null;
    let moved = false;
    let lastTap: { time: number; p: Point } | null = null;

    const local = (e: PointerEvent): Point => {
      const r = surface.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const rebase = () => {
      const pts = [...pointers.values()];
      if (pts.length === 0) { base = null; return; }
      const mid = pts.length === 1
        ? pts[0]
        : { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const dist = pts.length === 1 ? 0 : Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      base = { t: { ...tf.current }, mid, dist };
    };

    const onDown = (e: PointerEvent) => {
      pointers.set(e.pointerId, local(e));
      try { surface.setPointerCapture(e.pointerId); } catch { /* ponteiro sintético */ }
      if (pointers.size === 1) moved = false;
      rebase();
    };

    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId) || !base) return;
      pointers.set(e.pointerId, local(e));
      const pts = [...pointers.values()];
      const mid = pts.length === 1
        ? pts[0]
        : { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };

      if (Math.hypot(mid.x - base.mid.x, mid.y - base.mid.y) > 4 || pts.length > 1) moved = true;

      let scale = base.t.scale;
      if (pts.length > 1 && base.dist > 0) {
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        scale = clampScale(base.t.scale * (dist / base.dist));
      }
      // Ponto do conteúdo que estava sob o baseline continua sob o ponto médio atual.
      const cx = (base.mid.x - base.t.x) / base.t.scale;
      const cy = (base.mid.y - base.t.y) / base.t.scale;
      tf.current = { scale, x: mid.x - cx * scale, y: mid.y - cy * scale };
      schedule();
    };

    const onUp = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      rebase();
      if (!p || pointers.size > 0 || moved) { if (pointers.size === 0) lastTap = null; return; }

      const now = e.timeStamp;
      if (lastTap && now - lastTap.time < DOUBLE_TAP_MS
        && Math.hypot(p.x - lastTap.p.x, p.y - lastTap.p.y) < TAP_SLOP) {
        if (tf.current.scale > 1.05) reset();
        else zoomAt(p, DOUBLE_TAP_SCALE);
        lastTap = null;
      } else {
        lastTap = { time: now, p };
      }
    };

    const onCancel = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      rebase();
      lastTap = null;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = surface.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * WHEEL_SENSITIVITY);
      zoomAt({ x: e.clientX - r.left, y: e.clientY - r.top }, tf.current.scale * factor);
    };

    surface.addEventListener('pointerdown', onDown);
    surface.addEventListener('pointermove', onMove);
    surface.addEventListener('pointerup', onUp);
    surface.addEventListener('pointercancel', onCancel);
    surface.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      surface.removeEventListener('pointerdown', onDown);
      surface.removeEventListener('pointermove', onMove);
      surface.removeEventListener('pointerup', onUp);
      surface.removeEventListener('pointercancel', onCancel);
      surface.removeEventListener('wheel', onWheel);
      pointers.clear();
      if (raf.current) { cancelAnimationFrame(raf.current); raf.current = 0; }
    };
  }, [surfaceRef, schedule, zoomAt, reset]);

  return { zoomIn, zoomOut, reset };
}
