import type { GalaxyData } from '../../components/galaxy/useGalaxyData';
import {
  type Camera,
  easeInOut,
  fitBox,
  minScaleFor,
  saveCamera,
  screenToWorld,
  worldToScreen,
  zoomAt,
  clampScale,
} from './camera';
import { buildStars, drawStarfield, type Star } from './starfield';
import { getNebulaSprite } from './nebulaSprites';

/**
 * Motor imperativo da galáxia (o React só monta e passa callbacks — o estado
 * mutável de câmera, ponteiros e desenho mora aqui, como no `SketchEngine`).
 *
 * Duas camadas repintadas sob demanda: o fundo (estrelas, que cintilam a
 * ~15fps) e a cena (nebulosas, pontos, rótulos, hover). Um frame sem nada sujo
 * não desenha; a cintilação nunca força repintar os pontos.
 */

export interface GalaxyCallbacks {
  /** Ponto sob o cursor depois do tempo de permanência (-1 = nenhum). */
  onHover(idx: number): void;
  /** Toque num ponto (sem hover no toque: o toque seleciona). */
  onSelect(idx: number): void;
  /** Clique de mouse num ponto. */
  onOpen(idx: number): void;
  /** Clique/toque no vazio. */
  onBackgroundTap(): void;
  onCameraChange(cam: Camera): void;
}

const BG = '#05070c';
const TWINKLE_INTERVAL_MS = 66;
const HOVER_DWELL_MS = 120;
const HIT_RADIUS_PX = 8;
const DRAG_THRESHOLD_PX = 6;
const KEY_PAN_SPEED = 900; // px de tela por segundo
const FLY_MS = 450;
const FLY_MIN_SCALE = 0.5;
const HIGHLIGHT_MS = 1500;
/** Raio da nebulosa em unidades de mundo (~2,5 pegadas de card). */
const NEBULA_RADIUS = 1400;
/** Abaixo deste zoom, as nebulosas são agregadas por célula da grade. */
const NEBULA_AGG_SCALE = 0.12;
const LABEL_CELL = 48;

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}

function readCssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function rgbVarToHex(name: string, fallback: string): string {
  const rgb = readCssVar(name, '');
  if (!rgb) return fallback;
  return '#' + rgb.split(/\s+/).map((n) => parseInt(n, 10).toString(16).padStart(2, '0')).join('');
}

export function pointRadius(degree: number, scale: number): number {
  const base = Math.min(6, Math.max(1.4, 1.4 + Math.sqrt(degree) * 0.9));
  const factor = Math.min(2.2, Math.max(0.7, 0.7 + scale * 1.5));
  return base * factor;
}

export class GalaxyEngine {
  private bg: HTMLCanvasElement;
  private scene: HTMLCanvasElement;
  private bgCtx: CanvasRenderingContext2D;
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;

  private data: GalaxyData | null = null;
  private cam: Camera = { x: 0, y: 0, scale: 0.05 };
  private minScale = 0.0005;
  private stars: Star[] = buildStars(220);

  private sceneDirty = true;
  private bgDirty = true;
  private raf = 0;
  private lastTwinkle = 0;
  private lastFrame = 0;

  private hoverIdx = -1;
  private pinnedIdx = -1;
  private dwellTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingMove: { x: number; y: number } | null = null;

  private pointers = new Map<number, { x: number; y: number; type: string }>();
  private down: { x: number; y: number; moved: boolean; type: string } | null = null;
  private pinch: { dist: number; cx: number; cy: number } | null = null;
  private keys = new Set<string>();
  private inputEnabled = true;

  private fly: { from: Camera; to: Camera; start: number } | null = null;
  private highlight: { idx: number; until: number } | null = null;

  private accent = '#7c3aed';
  private fontTitle = 'Georgia, serif';
  private ro: ResizeObserver;

  constructor(
    private container: HTMLElement,
    private cb: GalaxyCallbacks,
  ) {
    this.bg = document.createElement('canvas');
    this.scene = document.createElement('canvas');
    for (const c of [this.bg, this.scene]) {
      c.style.position = 'absolute';
      c.style.inset = '0';
      c.style.width = '100%';
      c.style.height = '100%';
      c.style.display = 'block';
      container.appendChild(c);
    }
    this.scene.style.touchAction = 'none';
    this.bgCtx = this.bg.getContext('2d', { alpha: false })!;
    this.ctx = this.scene.getContext('2d')!;

    this.accent = rgbVarToHex('--color-brand', '#7c3aed');
    this.fontTitle = `${readCssVar('--font-newsreader', '')}, Georgia, serif`.replace(/^, /, '');
    // A fonte do título chega depois do primeiro desenho; repinta quando carregar.
    void document.fonts?.ready.then(() => this.markScene());

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();

    this.scene.addEventListener('pointerdown', this.onPointerDown);
    this.scene.addEventListener('pointermove', this.onPointerMove);
    this.scene.addEventListener('pointerup', this.onPointerUp);
    this.scene.addEventListener('pointercancel', this.onPointerCancel);
    this.scene.addEventListener('pointerleave', this.onPointerLeave);
    this.scene.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);

    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    if (this.dwellTimer) clearTimeout(this.dwellTimer);
    this.ro.disconnect();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.bg.remove();
    this.scene.remove();
  }

  // --- API ---

  setData(data: GalaxyData): void {
    const prevId = this.hoverIdx >= 0 && this.data ? this.data.ids[this.hoverIdx] : null;
    this.data = data;
    this.minScale = minScaleFor(data.bbox, this.w, this.h);
    this.cam = { ...this.cam, scale: clampScale(this.cam.scale, this.minScale) };
    this.hoverIdx = prevId ? (data.indexById.get(prevId) ?? -1) : -1;
    this.pinnedIdx = -1;
    this.markScene();
  }

  setCamera(cam: Camera): void {
    this.fly = null;
    this.cam = { ...cam, scale: clampScale(cam.scale, this.minScale) };
    this.cameraChanged();
  }

  getCamera(): Camera {
    return { ...this.cam };
  }

  getSize(): { w: number; h: number } {
    return { w: this.w, h: this.h };
  }

  setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled;
    if (!enabled) this.keys.clear();
  }

  /** Mantém o destaque de um ponto (mini card aberto por toque ou hover). */
  setPinned(idx: number): void {
    this.pinnedIdx = idx;
    this.markScene();
  }

  fit(animate = true): void {
    if (!this.data?.bbox) return;
    const to = fitBox(this.data.bbox, this.w, this.h);
    this.animateTo(to, animate);
  }

  zoomBy(factor: number): void {
    this.animateTo(zoomAt(this.cam, this.w, this.h, this.w / 2, this.h / 2, factor, this.minScale), true);
  }

  flyTo(idx: number, animate = true): void {
    if (!this.data || idx < 0) return;
    const to = { x: this.data.xs[idx], y: this.data.ys[idx], scale: clampScale(Math.max(this.cam.scale, FLY_MIN_SCALE), this.minScale) };
    this.animateTo(to, animate);
    this.highlight = { idx, until: performance.now() + (animate ? FLY_MS : 0) + HIGHLIGHT_MS };
  }

  /** Posição de tela de um ponto (para ancorar o mini card). */
  screenOf(idx: number): [number, number] | null {
    if (!this.data || idx < 0 || idx >= this.data.count) return null;
    return worldToScreen(this.cam, this.w, this.h, this.data.xs[idx], this.data.ys[idx]);
  }

  // --- internos ---

  private animateTo(to: Camera, animate: boolean): void {
    if (!animate) {
      this.setCamera(to);
      return;
    }
    this.fly = { from: { ...this.cam }, to, start: performance.now() };
    this.markScene();
  }

  private markScene(): void {
    this.sceneDirty = true;
  }

  private cameraChanged(): void {
    this.sceneDirty = true;
    this.bgDirty = true;
    saveCamera(this.cam);
    this.cb.onCameraChange({ ...this.cam });
    this.clearHover();
  }

  private clearHover(): void {
    if (this.dwellTimer) {
      clearTimeout(this.dwellTimer);
      this.dwellTimer = null;
    }
    if (this.hoverIdx !== -1) {
      this.hoverIdx = -1;
      this.sceneDirty = true;
      this.cb.onHover(-1);
    }
  }

  private resize(): void {
    const rect = this.container.getBoundingClientRect();
    this.w = Math.max(1, rect.width);
    this.h = Math.max(1, rect.height);
    this.dpr = window.devicePixelRatio || 1;
    for (const c of [this.bg, this.scene]) {
      c.width = Math.round(this.w * this.dpr);
      c.height = Math.round(this.h * this.dpr);
    }
    this.minScale = minScaleFor(this.data?.bbox ?? null, this.w, this.h);
    this.sceneDirty = true;
    this.bgDirty = true;
  }

  private hitTest(sx: number, sy: number): number {
    if (!this.data || this.data.count === 0) return -1;
    const [wx, wy] = screenToWorld(this.cam, this.w, this.h, sx, sy);
    return this.data.grid.nearest(wx, wy, (HIT_RADIUS_PX + 4) / this.cam.scale);
  }

  private localPoint(e: PointerEvent | WheelEvent): [number, number] {
    const rect = this.scene.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  // --- entrada ---

  private onPointerDown = (e: PointerEvent): void => {
    const [x, y] = this.localPoint(e);
    this.scene.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x, y, type: e.pointerType });
    if (this.pointers.size === 1) {
      this.down = { x, y, moved: false, type: e.pointerType };
      this.fly = null;
    } else if (this.pointers.size === 2) {
      // Segundo dedo: vira pinça, o toque deixa de ser um tap.
      if (this.down) this.down.moved = true;
      const [a, b] = [...this.pointers.values()];
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const [x, y] = this.localPoint(e);
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      // Mouse sem botão: hover, coalescido no rAF.
      if (e.pointerType === 'mouse') this.pendingMove = { x, y };
      return;
    }
    const prev = { x: p.x, y: p.y };
    p.x = x;
    p.y = y;

    if (this.pointers.size >= 2 && this.pinch) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      let cam = zoomAt(this.cam, this.w, this.h, cx, cy, dist / Math.max(1, this.pinch.dist), this.minScale);
      cam = { ...cam, x: cam.x - (cx - this.pinch.cx) / cam.scale, y: cam.y - (cy - this.pinch.cy) / cam.scale };
      this.pinch = { dist, cx, cy };
      this.cam = cam;
      this.cameraChanged();
      return;
    }

    if (!this.down) return;
    if (!this.down.moved && Math.hypot(x - this.down.x, y - this.down.y) > DRAG_THRESHOLD_PX) {
      this.down.moved = true;
    }
    if (this.down.moved) {
      this.cam = { ...this.cam, x: this.cam.x - (x - prev.x) / this.cam.scale, y: this.cam.y - (y - prev.y) / this.cam.scale };
      this.cameraChanged();
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    const [x, y] = this.localPoint(e);
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    const down = this.down;
    if (this.pointers.size === 0) this.down = null;
    if (!down || down.moved || this.pointers.size > 0) return;

    const idx = this.hitTest(x, y);
    if (idx < 0) {
      this.cb.onBackgroundTap();
      return;
    }
    if (down.type === 'mouse') this.cb.onOpen(idx);
    else this.cb.onSelect(idx);
  };

  private onPointerCancel = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size === 0) this.down = null;
  };

  private onPointerLeave = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && this.pointers.size === 0) {
      this.pendingMove = null;
      this.clearHover();
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.fly = null;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.h : 1;
    if (e.ctrlKey || e.metaKey) {
      const [x, y] = this.localPoint(e);
      this.cam = zoomAt(this.cam, this.w, this.h, x, y, Math.exp(-e.deltaY * unit * 0.0015), this.minScale);
    } else {
      this.cam = {
        ...this.cam,
        x: this.cam.x + (e.deltaX * unit) / this.cam.scale,
        y: this.cam.y + (e.deltaY * unit) / this.cam.scale,
      };
    }
    this.cameraChanged();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.inputEnabled || e.altKey || e.ctrlKey || e.metaKey || isTypingTarget(e.target)) return;
    if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      this.keys.add(e.key);
      this.fly = null;
      return;
    }
    if (e.key === '+' || e.key === '=') this.zoomBy(1.4);
    else if (e.key === '-' || e.key === '_') this.zoomBy(1 / 1.4);
    else if (e.key === '0') this.fit();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key);
  };

  private onBlur = (): void => {
    this.keys.clear();
  };

  // --- loop ---

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(64, now - (this.lastFrame || now));
    this.lastFrame = now;

    if (this.fly) {
      const t = Math.min(1, (now - this.fly.start) / FLY_MS);
      const k = easeInOut(t);
      const { from, to } = this.fly;
      // Escala interpolada em log: o voo de 1% a 50% não "salta" no fim.
      const scale = Math.exp(Math.log(from.scale) + (Math.log(to.scale) - Math.log(from.scale)) * k);
      this.cam = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, scale };
      if (t >= 1) this.fly = null;
      this.cameraChanged();
    }

    if (this.keys.size > 0) {
      const step = (KEY_PAN_SPEED * dt) / 1000 / this.cam.scale;
      let dx = 0;
      let dy = 0;
      if (this.keys.has('ArrowLeft')) dx -= step;
      if (this.keys.has('ArrowRight')) dx += step;
      if (this.keys.has('ArrowUp')) dy -= step;
      if (this.keys.has('ArrowDown')) dy += step;
      if (dx || dy) {
        this.cam = { ...this.cam, x: this.cam.x + dx, y: this.cam.y + dy };
        this.cameraChanged();
      }
    }

    if (this.pendingMove) {
      const { x, y } = this.pendingMove;
      this.pendingMove = null;
      const idx = this.hitTest(x, y);
      if (idx !== this.hoverIdx) {
        this.hoverIdx = idx;
        this.sceneDirty = true;
        if (this.dwellTimer) clearTimeout(this.dwellTimer);
        this.dwellTimer = null;
        if (idx < 0) this.cb.onHover(-1);
        else {
          this.dwellTimer = setTimeout(() => {
            this.dwellTimer = null;
            if (this.hoverIdx === idx) this.cb.onHover(idx);
          }, HOVER_DWELL_MS);
        }
      }
      this.scene.style.cursor = idx >= 0 ? 'pointer' : 'grab';
    }

    if (this.highlight) {
      if (now > this.highlight.until) this.highlight = null;
      this.sceneDirty = true;
    }

    if (now - this.lastTwinkle >= TWINKLE_INTERVAL_MS) {
      this.lastTwinkle = now;
      this.bgDirty = true;
    }

    if (this.bgDirty) {
      this.bgDirty = false;
      this.drawBackground(now);
    }
    if (this.sceneDirty) {
      this.sceneDirty = false;
      this.drawScene(now);
    }
  };

  // --- desenho ---

  private drawBackground(now: number): void {
    const ctx = this.bgCtx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, this.w, this.h);
    drawStarfield(ctx, this.stars, this.w, this.h, -this.cam.x * this.cam.scale, -this.cam.y * this.cam.scale, now);
  }

  private drawScene(now: number): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    const d = this.data;
    if (!d || d.count === 0) return;

    const { scale } = this.cam;
    const halfW = this.w / 2 / scale;
    const halfH = this.h / 2 / scale;
    const minX = this.cam.x - halfW;
    const maxX = this.cam.x + halfW;
    const minY = this.cam.y - halfH;
    const maxY = this.cam.y + halfH;
    const toSx = (wx: number) => (wx - this.cam.x) * scale + this.w / 2;
    const toSy = (wy: number) => (wy - this.cam.y) * scale + this.h / 2;

    this.drawNebulas(ctx, d, minX, minY, maxX, maxY, toSx, toSy);

    const visible = d.grid.query(minX - 20 / scale, minY - 20 / scale, maxX + 20 / scale, maxY + 20 / scale, []);

    const focus = this.hoverIdx >= 0 ? this.hoverIdx : this.pinnedIdx;
    const neighbors = focus >= 0 ? new Set(d.adjacency[focus]) : null;

    // Arestas: só do ponto em foco.
    if (focus >= 0) {
      ctx.strokeStyle = this.accent;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      const fx = toSx(d.xs[focus]);
      const fy = toSy(d.ys[focus]);
      for (const n of d.adjacency[focus]) {
        ctx.moveTo(fx, fy);
        ctx.lineTo(toSx(d.xs[n]), toSy(d.ys[n]));
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Pontos agrupados por cor: um fill por cor.
    const paths = new Map<string, Path2D>();
    for (const i of visible) {
      if (i === focus || (neighbors && neighbors.has(i))) continue;
      const r = pointRadius(d.degree[i], scale);
      const sx = toSx(d.xs[i]);
      const sy = toSy(d.ys[i]);
      let p = paths.get(d.color[i]);
      if (!p) {
        p = new Path2D();
        paths.set(d.color[i], p);
      }
      if (r < 2) p.rect(sx - r, sy - r, r * 2, r * 2);
      else {
        p.moveTo(sx + r, sy);
        p.arc(sx, sy, r, 0, Math.PI * 2);
      }
    }
    ctx.globalAlpha = focus >= 0 ? 0.25 : 0.8;
    for (const [c, p] of paths) {
      ctx.fillStyle = c;
      ctx.fill(p);
    }
    ctx.globalAlpha = 1;

    if (focus >= 0 && neighbors) {
      ctx.fillStyle = d.color[focus];
      for (const n of neighbors) {
        const r = pointRadius(d.degree[n], scale) + 1.5;
        ctx.beginPath();
        ctx.arc(toSx(d.xs[n]), toSy(d.ys[n]), r, 0, Math.PI * 2);
        ctx.fill();
      }
      const r = pointRadius(d.degree[focus], scale) + 3;
      ctx.fillStyle = '#f5f3ff';
      ctx.beginPath();
      ctx.arc(toSx(d.xs[focus]), toSy(d.ys[focus]), r, 0, Math.PI * 2);
      ctx.fill();
    }

    if (this.highlight) {
      const i = this.highlight.idx;
      const pulse = 0.5 + 0.5 * Math.sin(now / 120);
      ctx.strokeStyle = '#f5f3ff';
      ctx.globalAlpha = 0.4 + 0.5 * pulse;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(toSx(d.xs[i]), toSy(d.ys[i]), pointRadius(d.degree[i], scale) + 8 + pulse * 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    this.drawLabels(ctx, d, minX, minY, maxX, maxY, toSx, toSy, focus, neighbors);
  }

  private drawNebulas(
    ctx: CanvasRenderingContext2D,
    d: GalaxyData,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    toSx: (x: number) => number,
    toSy: (y: number) => number,
  ): void {
    const { scale } = this.cam;
    ctx.globalAlpha = 0.9;
    if (scale < NEBULA_AGG_SCALE) {
      for (const n of d.cellNebulas) {
        const R = NEBULA_RADIUS * (1 + Math.sqrt(Math.min(n.count, 25)) * 0.35);
        if (n.x + R < minX || n.x - R > maxX || n.y + R < minY || n.y - R > maxY) continue;
        const sr = R * scale;
        if (sr < 3) continue;
        const sprite = getNebulaSprite(n.color);
        if (sprite) ctx.drawImage(sprite, toSx(n.x) - sr, toSy(n.y) - sr, sr * 2, sr * 2);
      }
    } else {
      const R = NEBULA_RADIUS;
      const sr = R * scale;
      d.grid.forEachCell(minX - R, minY - R, maxX + R, maxY + R, (indices) => {
        for (const i of indices) {
          const c = d.nebula[i];
          if (!c) continue;
          const sprite = getNebulaSprite(c);
          if (sprite) ctx.drawImage(sprite, toSx(d.xs[i]) - sr, toSy(d.ys[i]) - sr, sr * 2, sr * 2);
        }
      });
    }
    ctx.globalAlpha = 1;
  }

  private drawLabels(
    ctx: CanvasRenderingContext2D,
    d: GalaxyData,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    toSx: (x: number) => number,
    toSy: (y: number) => number,
    focus: number,
    neighbors: Set<number> | null,
  ): void {
    const { scale } = this.cam;
    const cap = Math.round(8 + 600 * Math.min(1, scale * 1.2));
    const placed = new Map<number, [number, number, number, number][]>();
    const fits = (x0: number, y0: number, x1: number, y1: number): boolean => {
      for (let cx = Math.floor(x0 / LABEL_CELL); cx <= Math.floor(x1 / LABEL_CELL); cx++) {
        for (let cy = Math.floor(y0 / LABEL_CELL); cy <= Math.floor(y1 / LABEL_CELL); cy++) {
          for (const [a, b, c, e] of placed.get(cx * 100003 + cy) ?? []) {
            if (x0 < c && x1 > a && y0 < e && y1 > b) return false;
          }
        }
      }
      return true;
    };
    const claim = (x0: number, y0: number, x1: number, y1: number): void => {
      for (let cx = Math.floor(x0 / LABEL_CELL); cx <= Math.floor(x1 / LABEL_CELL); cx++) {
        for (let cy = Math.floor(y0 / LABEL_CELL); cy <= Math.floor(y1 / LABEL_CELL); cy++) {
          const k = cx * 100003 + cy;
          let list = placed.get(k);
          if (!list) {
            list = [];
            placed.set(k, list);
          }
          list.push([x0, y0, x1, y1]);
        }
      }
    };

    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const draw = (i: number, strong: boolean): boolean => {
      const title = d.metas[i].title || 'Sem título';
      const text = title.length > 42 ? title.slice(0, 41) + '…' : title;
      const root = d.isRoot[i] === 1;
      const size = root ? 18 : strong ? 14 : 12.5;
      ctx.font = `${strong || root ? 600 : 500} ${size}px ${this.fontTitle}`;
      const tw = ctx.measureText(text).width;
      const sx = toSx(d.xs[i]);
      const sy = toSy(d.ys[i]) - pointRadius(d.degree[i], scale) - 5;
      const box: [number, number, number, number] = [sx - tw / 2 - 3, sy - size - 2, sx + tw / 2 + 3, sy + 2];
      if (!strong && !fits(...box)) return false;
      claim(...box);
      ctx.fillStyle = '#e6e9f0';
      ctx.globalAlpha = strong ? 1 : root ? 0.95 : focus >= 0 ? 0.3 : 0.62;
      ctx.fillText(text, sx, sy);
      ctx.globalAlpha = 1;
      return true;
    };

    // Ponto em foco e vizinhos primeiro: sempre legíveis.
    if (focus >= 0) {
      draw(focus, true);
      if (neighbors) for (const n of neighbors) draw(n, false);
    }

    let shown = 0;
    for (const i of d.labelOrder) {
      if (shown >= cap) break;
      if (i === focus || (neighbors && neighbors.has(i))) continue;
      const x = d.xs[i];
      const y = d.ys[i];
      if (x < minX || x > maxX || y < minY || y > maxY) continue;
      if (draw(i, false)) shown++;
    }
  }
}
