import { CARD_MAX_HEIGHT, CARD_WIDTH } from '@zettelkasten/core';
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
  MAX_SCALE,
} from './camera';
import { buildStars, drawStarfield, type Star } from './starfield';
import { getNebulaSprite } from './nebulaSprites';
import { classifyWheel, type WheelMemory } from './wheel';

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
  /** Clique/toque no vazio. */
  onBackgroundTap(): void;
  onCameraChange(cam: Camera): void;
  /** Zettels que devem estar montados como card (só muda quando o conjunto muda). */
  onVisibleCards(ids: string[]): void;
  /** Câmera parada há ~300 ms (true) ou voltou a se mover (false). */
  onCameraSettled(settled: boolean): void;
  /** Duplo clique de mouse no vazio (sem ponto, silhueta ou card): criar ali. */
  onDoubleClickEmpty(wx: number, wy: number): void;
}

export type Lod = 'points' | 'silhouettes' | 'cards';

/** Abaixo: pontos. A partir daqui: silhuetas (canvas). */
export const LOD_SILHOUETTE = 0.18;
/** A partir daqui: cards de leitura (DOM). */
export const LOD_CARDS = 0.42;
export const MAX_CARDS = 36;

export function lodFor(scale: number): Lod {
  return scale < LOD_SILHOUETTE ? 'points' : scale < LOD_CARDS ? 'silhouettes' : 'cards';
}

/** Altura estimada da silhueta (mundo) — só uma pista até o card real. */
function silhouetteHeight(bodyLen: number): number {
  return Math.min(CARD_MAX_HEIGHT, Math.max(140, 140 + bodyLen * 0.35));
}

const BG = '#05070c';
const TWINKLE_INTERVAL_MS = 66;
const HOVER_DWELL_MS = 120;
const HIT_RADIUS_PX = 8;
const DRAG_THRESHOLD_PX = 6;
const KEY_PAN_SPEED = 900; // px de tela por segundo
const FLY_MS = 450;
/** O voo termina com o card legível (nível de cards). */
export const FLY_MIN_SCALE = 0.75;
const SETTLE_MS = 300;
const DOUBLE_CLICK_MS = 300;
const HIGHLIGHT_MS = 1500;
/** Folga entre a base da barra do topo e o topo do card raiz no foco. */
const FOCUS_TOP_GAP = 16;
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

  private wheelMemory: WheelMemory | null = null;
  /** Altura real (mundo) dos cards montados, por id — sobrevive às reconstruções dos dados. */
  private cardHeights = new Map<string, number>();
  /** Base da barra do topo (px de tela): o foco põe o topo do raiz abaixo dela. */
  private topInset = 72;
  private hoverIdx = -1;
  private pinnedIdx = -1;
  /** Card DOM sob o cursor (vem do React): arestas sem mini card. */
  private cardHoverIdx = -1;
  private cardLayer: HTMLElement | null = null;
  private visibleKey = '';
  private settled = false;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  /** Modo foco: só estes índices são desenhados/clicáveis (null = todos). */
  private focusSet: Set<number> | null = null;
  private cameraBeforeFocus: Camera | null = null;
  private lastEmptyClick: { t: number; x: number; y: number } | null = null;
  private dwellTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingMove: { x: number; y: number } | null = null;

  private pointers = new Map<number, { x: number; y: number; type: string }>();
  private down: { x: number; y: number; moved: boolean; type: string; onCard: boolean } | null = null;
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
    // Antes de qualquer filho do React (a camada de cards): o canvas fica por
    // baixo dos cards.
    const anchor = container.firstChild;
    for (const c of [this.bg, this.scene]) {
      c.style.position = 'absolute';
      c.style.inset = '0';
      c.style.width = '100%';
      c.style.height = '100%';
      c.style.display = 'block';
      container.insertBefore(c, anchor);
    }
    // Os cards (DOM) ficam por cima do canvas: a entrada é ouvida no
    // contêiner, para arraste/pinça/roda navegarem por cima deles também.
    container.style.touchAction = 'none';
    this.bgCtx = this.bg.getContext('2d', { alpha: false })!;
    this.ctx = this.scene.getContext('2d')!;

    this.accent = rgbVarToHex('--color-brand', '#7c3aed');
    this.fontTitle = `${readCssVar('--font-newsreader', '')}, Georgia, serif`.replace(/^, /, '');
    // A fonte do título chega depois do primeiro desenho; repinta quando carregar.
    void document.fonts?.ready.then(() => this.markScene());

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();

    container.addEventListener('pointerdown', this.onPointerDown);
    container.addEventListener('pointermove', this.onPointerMove);
    container.addEventListener('pointerup', this.onPointerUp);
    container.addEventListener('pointercancel', this.onPointerCancel);
    container.addEventListener('pointerleave', this.onPointerLeave);
    container.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);

    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    if (this.dwellTimer) clearTimeout(this.dwellTimer);
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.ro.disconnect();
    const c = this.container;
    c.removeEventListener('pointerdown', this.onPointerDown);
    c.removeEventListener('pointermove', this.onPointerMove);
    c.removeEventListener('pointerup', this.onPointerUp);
    c.removeEventListener('pointercancel', this.onPointerCancel);
    c.removeEventListener('pointerleave', this.onPointerLeave);
    c.removeEventListener('wheel', this.onWheel);
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

  /** Pan em pixels de tela (auto-pan do arraste de card), sem mudar o zoom. */
  panBy(dxScreen: number, dyScreen: number): void {
    const s = this.cam.scale;
    this.setCamera({ ...this.cam, x: this.cam.x + dxScreen / s, y: this.cam.y + dyScreen / s });
  }

  getViewportRect(): DOMRect {
    return this.container.getBoundingClientRect();
  }

  getSize(): { w: number; h: number } {
    return { w: this.w, h: this.h };
  }

  setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled;
    if (!enabled) this.keys.clear();
  }

  /**
   * Modo foco: desenha só `idxSet` e enquadra o conjunto; `null` sai e volta
   * à câmera de antes do foco.
   */
  setFocus(idxSet: Set<number> | null, fit = true, rootIdx = -1): void {
    if (idxSet) {
      if (!this.focusSet) this.cameraBeforeFocus = { ...this.cam };
      this.focusSet = idxSet;
      this.hoverIdx = -1;
      this.pinnedIdx = -1;
      // `fit = false`: só troca o conjunto (os índices mudam a cada
      // reconstrução dos dados) sem mexer na câmera.
      if (fit) {
        if (rootIdx >= 0) this.focusOn(rootIdx);
        else this.fitIds(idxSet);
      }
    } else if (this.focusSet) {
      this.focusSet = null;
      const back = this.cameraBeforeFocus;
      this.cameraBeforeFocus = null;
      if (back) this.animateTo(back, true);
    }
    this.markScene();
  }

  setTopInset(px: number): void {
    this.topInset = px;
  }

  /**
   * Voa até o raiz do foco: centrado na horizontal, topo do card logo abaixo
   * da barra do topo, sempre no zoom máximo.
   */
  focusOn(idx: number, animate = true): void {
    this.flyToTop(idx, animate);
  }

  /** "Aproximar": mesmo enquadramento do foco, sem entrar nele. */
  approach(idx: number, animate = true): void {
    this.flyToTop(idx, animate);
  }

  private flyToTop(idx: number, animate: boolean): void {
    const to = this.topAlignedCamera(idx);
    if (!to) return;
    this.animateTo(to, animate);
    this.highlight = { idx, until: performance.now() + (animate ? FLY_MS : 0) + HIGHLIGHT_MS };
  }

  /** Zoom máximo, card centrado na horizontal e topo logo abaixo da barra do topo. */
  private topAlignedCamera(idx: number): Camera | null {
    const d = this.data;
    if (!d || idx < 0) return null;
    const scale = clampScale(MAX_SCALE, this.minScale);
    const top = d.ys[idx] - CARD_MAX_HEIGHT / 2;
    return { x: d.xs[idx], y: top + (this.h / 2 - this.topInset - FOCUS_TOP_GAP) / scale, scale };
  }

  /** Enquadra um conjunto de índices (pegada inteira de cada card), até 100%. */
  fitIds(idxSet: Set<number>, animate = true): void {
    const d = this.data;
    if (!d || idxSet.size === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const i of idxSet) {
      minX = Math.min(minX, d.xs[i] - CARD_WIDTH / 2);
      maxX = Math.max(maxX, d.xs[i] + CARD_WIDTH / 2);
      minY = Math.min(minY, d.ys[i] - CARD_MAX_HEIGHT / 2);
      maxY = Math.max(maxY, d.ys[i] + CARD_MAX_HEIGHT / 2);
    }
    const to = fitBox({ minX, minY, maxX, maxY }, this.w, this.h);
    this.animateTo({ ...to, scale: Math.min(1, to.scale) }, animate);
  }

  private inFocus(i: number): boolean {
    return !this.focusSet || this.focusSet.has(i);
  }

  getLod(): Lod {
    return lodFor(this.cam.scale);
  }

  /**
   * Contêiner dos cards (DOM). Os cards ficam nele em coordenadas de mundo; o
   * motor escreve só o transform da câmera nele — pan/zoom não re-renderizam
   * nem fazem relayout dos cards.
   */
  setCardLayer(el: HTMLElement | null): void {
    this.cardLayer = el;
    this.applyLayerTransform();
  }

  /** Altura medida de um card montado (`null` ao desmontar). */
  setCardHeight(id: string, h: number | null): void {
    if (h === null) {
      this.cardHeights.delete(id);
      return;
    }
    if (this.cardHeights.get(id) === h) return;
    this.cardHeights.set(id, h);
    // Só as arestas dependem da altura.
    if (this.hoverIdx >= 0 || this.cardHoverIdx >= 0 || this.pinnedIdx >= 0) this.markScene();
  }

  /**
   * `y` de mundo onde a aresta encosta: no nível de pontos, o ponto; acima
   * dele, o meio do card desenhado (altura real se montado, senão a
   * estimativa da silhueta). O centro da pegada fica abaixo de card curto.
   */
  private anchorY(d: GalaxyData, i: number, lod: Lod): number {
    if (lod === 'points') return d.ys[i];
    const h = this.cardHeights.get(d.ids[i]) ?? silhouetteHeight(d.metas[i].bodyLen);
    return d.ys[i] - CARD_MAX_HEIGHT / 2 + h / 2;
  }

  /** Cursor sobre um card: arestas e vizinhos realçados, sem mini card. */
  setHoverFromCard(idx: number): void {
    if (this.cardHoverIdx === idx) return;
    this.cardHoverIdx = idx;
    this.markScene();
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

  flyTo(idx: number, animate = true, minScale = FLY_MIN_SCALE): void {
    if (!this.data || idx < 0) return;
    const to = { x: this.data.xs[idx], y: this.data.ys[idx], scale: clampScale(Math.max(this.cam.scale, minScale), this.minScale) };
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
    this.applyLayerTransform();
    this.cb.onCameraChange({ ...this.cam });
    this.clearHover();
    if (this.settled) {
      this.settled = false;
      this.cb.onCameraSettled(false);
    }
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.settled = true;
      this.cb.onCameraSettled(true);
    }, SETTLE_MS);
  }

  private applyLayerTransform(): void {
    if (!this.cardLayer) return;
    const s = this.cam.scale;
    this.cardLayer.style.transform = `translate(${this.w / 2 - this.cam.x * s}px, ${this.h / 2 - this.cam.y * s}px) scale(${s})`;
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
    this.applyLayerTransform();
    this.sceneDirty = true;
    this.bgDirty = true;
  }

  private hitTest(sx: number, sy: number): number {
    if (!this.data || this.data.count === 0) return -1;
    const d = this.data;
    const [wx, wy] = screenToWorld(this.cam, this.w, this.h, sx, sy);
    if (lodFor(this.cam.scale) === 'points') {
      const radius = (HIT_RADIUS_PX + 4) / this.cam.scale;
      if (!this.focusSet) return d.grid.nearest(wx, wy, radius);
      // Em foco, o ponto oculto mais próximo não pode roubar o clique.
      let best = -1;
      let bestD = radius * radius;
      d.grid.forEachCell(wx - radius, wy - radius, wx + radius, wy + radius, (indices) => {
        for (const i of indices) {
          if (!this.focusSet!.has(i)) continue;
          const dd = (d.xs[i] - wx) ** 2 + (d.ys[i] - wy) ** 2;
          if (dd <= bestD) {
            bestD = dd;
            best = i;
          }
        }
      });
      return best;
    }
    // Silhuetas/cards: o alvo é o retângulo do card, não o ponto.
    let hit = -1;
    d.grid.forEachCell(wx - CARD_WIDTH, wy - CARD_MAX_HEIGHT, wx + CARD_WIDTH, wy + CARD_MAX_HEIGHT, (indices) => {
      for (const i of indices) {
        const top = d.ys[i] - CARD_MAX_HEIGHT / 2;
        if (
          this.inFocus(i) &&
          Math.abs(wx - d.xs[i]) <= CARD_WIDTH / 2 &&
          wy >= top &&
          wy <= top + silhouetteHeight(d.metas[i].bodyLen)
        ) {
          hit = i;
        }
      }
    });
    return hit;
  }

  private localPoint(e: PointerEvent | WheelEvent): [number, number] {
    const rect = this.container.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  // --- entrada ---

  private onPointerDown = (e: PointerEvent): void => {
    const target = e.target instanceof Element ? e.target : null;
    // Links/botões/campos dos cards (e qualquer [data-no-pan]) são do card.
    if (target?.closest('a, button, input, textarea, select, [data-no-pan]')) return;
    // Mouse dentro do texto do card: seleção de texto, não pan. No toque um
    // dedo sempre navega (não há seleção por arraste).
    if (e.pointerType === 'mouse' && target?.closest('[data-card-body]')) return;
    const onCard = !!target?.closest('[data-galaxy-card]');

    const [x, y] = this.localPoint(e);
    // Sem pointer capture aqui: com captura, o `click` de um toque cairia no
    // contêiner e não no link do card. Captura só quando o arraste começa.
    this.pointers.set(e.pointerId, { x, y, type: e.pointerType });
    if (this.pointers.size === 1) {
      this.down = { x, y, moved: false, type: e.pointerType, onCard };
      this.fly = null;
    } else if (this.pointers.size === 2) {
      // Segundo dedo: vira pinça, o toque deixa de ser um tap.
      if (this.down) this.down.moved = true;
      const [a, b] = [...this.pointers.values()];
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      for (const id of this.pointers.keys()) this.capture(id);
    }
  };

  private capture(pointerId: number): void {
    try {
      this.container.setPointerCapture(pointerId);
    } catch {
      // ponteiro já liberado
    }
  }

  private onPointerMove = (e: PointerEvent): void => {
    const [x, y] = this.localPoint(e);
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      // Mouse sem botão: hover, coalescido no rAF. Sobre um card, quem cuida
      // do hover é o próprio card.
      if (e.pointerType === 'mouse') {
        const overCard = e.target instanceof Element && !!e.target.closest('[data-galaxy-card]');
        if (overCard) {
          this.pendingMove = null;
          this.clearHover();
        } else this.pendingMove = { x, y };
      }
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
      this.capture(e.pointerId);
    }
    if (this.down.moved) {
      this.cam = { ...this.cam, x: this.cam.x - (x - prev.x) / this.cam.scale, y: this.cam.y - (y - prev.y) / this.cam.scale };
      this.cameraChanged();
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    const [x, y] = this.localPoint(e);
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    const down = this.down;
    if (this.pointers.size === 0) this.down = null;
    if (!down || down.moved || this.pointers.size > 0) return;
    // O card cuida do próprio clique (Abrir, links); clicar no corpo não navega.
    if (down.onCard) return;

    const idx = this.hitTest(x, y);
    if (idx < 0) {
      this.cb.onBackgroundTap();
      // Duplo clique de mouse no vazio: criar ali.
      if (down.type === 'mouse') {
        const now = performance.now();
        const last = this.lastEmptyClick;
        if (last && now - last.t <= DOUBLE_CLICK_MS && Math.hypot(x - last.x, y - last.y) <= DRAG_THRESHOLD_PX) {
          this.lastEmptyClick = null;
          const [wx, wy] = screenToWorld(this.cam, this.w, this.h, x, y);
          this.cb.onDoubleClickEmpty(wx, wy);
        } else {
          this.lastEmptyClick = { t: now, x, y };
        }
      }
      return;
    }
    this.lastEmptyClick = null;
    // Silhueta (ou card além do teto): aproxima até virar card legível.
    if (lodFor(this.cam.scale) !== 'points') {
      this.flyTo(idx);
      return;
    }
    // Mouse: aproxima até o card. Toque: seleciona (mini card), sem hover.
    if (down.type === 'mouse') this.flyTo(idx);
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
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.h : 1;
    const pinch = e.ctrlKey || e.metaKey;
    // Card com overflow: o gesto é dele. Com espaço na direção, o navegador
    // rola; no início/fim, engole o evento — sem transbordo para zoom/pan
    // enquanto o cursor está no card. Card sem overflow navega normalmente.
    if (!pinch && e.target instanceof Element) {
      const scroller = e.target.closest<HTMLElement>('[data-card-scroll]');
      if (scroller && scroller.scrollHeight > scroller.clientHeight + 1) {
        const canDown = scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1;
        const canUp = scroller.scrollTop > 0;
        if (!((e.deltaY > 0 && canDown) || (e.deltaY < 0 && canUp))) e.preventDefault();
        return;
      }
    }
    e.preventDefault();
    this.fly = null;
    if (pinch) {
      // Ctrl/⌘ + roda e pinça do trackpad (chega como ctrl+wheel).
      const [x, y] = this.localPoint(e);
      this.cam = zoomAt(this.cam, this.w, this.h, x, y, Math.exp(-e.deltaY * unit * 0.0015), this.minScale);
    } else if (e.shiftKey) {
      // Pan horizontal; o Windows às vezes já entrega Shift+roda em deltaX.
      const d = (e.deltaX || e.deltaY) * unit;
      this.cam = { ...this.cam, x: this.cam.x + d / this.cam.scale };
    } else {
      const now = performance.now();
      const source = classifyWheel(e, now, this.wheelMemory);
      this.wheelMemory = { source, at: now };
      if (source === 'mouse') {
        // Delta limitado: um entalhe com escala de DPI (125) ou aceleração
        // não salta vários níveis.
        const d = Math.max(-120, Math.min(120, e.deltaY * unit));
        const [x, y] = this.localPoint(e);
        this.cam = zoomAt(this.cam, this.w, this.h, x, y, Math.exp(-d * 0.0015), this.minScale);
      } else {
        this.cam = {
          ...this.cam,
          x: this.cam.x + (e.deltaX * unit) / this.cam.scale,
          y: this.cam.y + (e.deltaY * unit) / this.cam.scale,
        };
      }
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
          // Mini card só no nível de pontos; nos outros, a silhueta/card já
          // mostra o título — o hover só realça as ligações.
          this.dwellTimer = setTimeout(() => {
            this.dwellTimer = null;
            if (this.hoverIdx === idx && lodFor(this.cam.scale) === 'points') this.cb.onHover(idx);
          }, HOVER_DWELL_MS);
        }
      }
      this.container.style.cursor = idx >= 0 ? 'pointer' : 'grab';
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
    if (!d || d.count === 0) {
      this.emitVisibleCards([]);
      return;
    }

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

    const lod = lodFor(scale);
    const focus = this.hoverIdx >= 0 ? this.hoverIdx : this.cardHoverIdx >= 0 ? this.cardHoverIdx : this.pinnedIdx;
    const neighbors = focus >= 0 ? new Set(d.adjacency[focus].filter((n) => this.inFocus(n))) : null;

    // Arestas: só do ponto em foco.
    if (focus >= 0) {
      ctx.strokeStyle = this.accent;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      const fx = toSx(d.xs[focus]);
      const fy = toSy(this.anchorY(d, focus, lod));
      for (const n of neighbors!) {
        ctx.moveTo(fx, fy);
        ctx.lineTo(toSx(d.xs[n]), toSy(this.anchorY(d, n, lod)));
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    if (lod !== 'points') {
      this.drawCardsLevel(ctx, d, lod, minX, minY, maxX, maxY, toSx, toSy, focus, neighbors, now);
      return;
    }
    this.emitVisibleCards([]);

    const visible = d.grid.query(minX - 20 / scale, minY - 20 / scale, maxX + 20 / scale, maxY + 20 / scale, []);

    // Pontos agrupados por cor: um fill por cor.
    const paths = new Map<string, Path2D>();
    for (const i of visible) {
      if (!this.inFocus(i) || i === focus || (neighbors && neighbors.has(i))) continue;
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

  /** Avisa o React só quando o conjunto de cards muda. */
  private emitVisibleCards(ids: string[]): void {
    const key = ids.join(',');
    if (key === this.visibleKey) return;
    this.visibleKey = key;
    this.cb.onVisibleCards(ids);
  }

  /**
   * Silhuetas e cards. No nível de cards, os mais próximos do centro (até o
   * teto) viram DOM; o resto vira silhueta. Nenhum ponto/rótulo é desenhado.
   */
  private drawCardsLevel(
    ctx: CanvasRenderingContext2D,
    d: GalaxyData,
    lod: Lod,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    toSx: (x: number) => number,
    toSy: (y: number) => number,
    focus: number,
    neighbors: Set<number> | null,
    now: number,
  ): void {
    const { scale } = this.cam;
    const cards = new Set<number>();
    if (lod === 'cards') {
      // Margem de meia tela: o card já está montado quando entra na tela.
      const mx = (maxX - minX) / 2 + CARD_WIDTH;
      const my = (maxY - minY) / 2 + CARD_MAX_HEIGHT;
      const candidates = d.grid.query(minX - mx, minY - my, maxX + mx, maxY + my, []).filter((i) => this.inFocus(i));
      candidates.sort(
        (a, b) =>
          (d.xs[a] - this.cam.x) ** 2 + (d.ys[a] - this.cam.y) ** 2 -
          ((d.xs[b] - this.cam.x) ** 2 + (d.ys[b] - this.cam.y) ** 2),
      );
      for (let k = 0; k < candidates.length && k < MAX_CARDS; k++) cards.add(candidates[k]);
      this.emitVisibleCards([...cards].sort((a, b) => a - b).map((i) => d.ids[i]));
    } else {
      this.emitVisibleCards([]);
    }

    const visible = d.grid.query(
      minX - CARD_WIDTH,
      minY - CARD_MAX_HEIGHT,
      maxX + CARD_WIDTH,
      maxY + CARD_MAX_HEIGHT,
      [],
    );
    const titleSize = 24 * scale;
    for (const i of visible) {
      if (cards.has(i) || !this.inFocus(i)) continue;
      const left = toSx(d.xs[i] - CARD_WIDTH / 2);
      const top = toSy(d.ys[i] - CARD_MAX_HEIGHT / 2);
      const w = CARD_WIDTH * scale;
      const h = silhouetteHeight(d.metas[i].bodyLen) * scale;
      const emphasis = i === focus || (neighbors?.has(i) ?? false);
      ctx.beginPath();
      ctx.roundRect(left, top, w, h, 12 * scale);
      ctx.fillStyle = '#0e121a';
      ctx.globalAlpha = focus >= 0 && !emphasis ? 0.55 : 0.95;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = emphasis ? this.accent : 'rgba(255,255,255,0.08)';
      ctx.lineWidth = emphasis ? 1.5 : 1;
      ctx.stroke();
      if (titleSize >= 5) {
        const title = d.metas[i].title || 'Sem título';
        const pad = 20 * scale;
        const maxChars = Math.max(4, Math.floor((w - pad * 2) / (titleSize * 0.5)));
        const text = title.length > maxChars ? title.slice(0, maxChars - 1) + '…' : title;
        ctx.font = `500 ${titleSize}px ${this.fontTitle}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#e6e9f0';
        ctx.globalAlpha = focus >= 0 && !emphasis ? 0.5 : 0.95;
        ctx.fillText(text, left + pad, top + pad);
        ctx.globalAlpha = 1;
      }
    }

    // Destaque do voo: contorno pulsante na silhueta. No card (DOM opaco por
    // cima) quem destaca é o próprio card.
    if (this.highlight && !cards.has(this.highlight.idx)) {
      const i = this.highlight.idx;
      const pulse = 0.5 + 0.5 * Math.sin(now / 120);
      ctx.strokeStyle = '#f5f3ff';
      ctx.globalAlpha = 0.4 + 0.5 * pulse;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(
        toSx(d.xs[i] - CARD_WIDTH / 2) - 4,
        toSy(d.ys[i] - CARD_MAX_HEIGHT / 2) - 4,
        CARD_WIDTH * scale + 8,
        silhouetteHeight(d.metas[i].bodyLen) * scale + 8,
        14 * scale + 4,
      );
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  /** Card em destaque pelo voo (o DOM desenha o contorno). */
  getHighlightId(): string | null {
    return this.highlight && this.data ? this.data.ids[this.highlight.idx] ?? null : null;
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
    // Em foco o conjunto é pequeno e as agregadas misturariam nós ocultos.
    if (scale < NEBULA_AGG_SCALE && !this.focusSet) {
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
          if (!c || !this.inFocus(i)) continue;
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
      if (!this.inFocus(i) || i === focus || (neighbors && neighbors.has(i))) continue;
      const x = d.xs[i];
      const y = d.ys[i];
      if (x < minX || x > maxX || y < minY || y > maxY) continue;
      if (draw(i, false)) shown++;
    }
  }
}
