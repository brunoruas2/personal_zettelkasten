import {
  SketchHistory,
  duplicateStrokes,
  eraseAt,
  fitViewport,
  newStrokeId,
  normalizeRect,
  recolorStrokes,
  resizeStrokes,
  sceneBounds,
  screenToWorld,
  strokeAtPoint,
  strokeBounds,
  strokeIntersectsRect,
  translateStrokes,
  zoomAt,
  themeColor,
  DARK_BG,
  LIGHT_BG,
  SKETCH_TYPE,
  SKETCH_VERSION,
  DEFAULT_COLOR,
  type Bounds,
  type Point2,
  type SketchPoint,
  type SketchScene,
  type SketchTheme,
  type Stroke,
  type Viewport,
} from '@zettelkasten/core'
import { livePath2D, strokePath2D } from './sketchRender'

/** `hand` só move a vista (não desenha nem apaga); `select` seleciona e move traços. */
export type SketchTool = 'pen' | 'eraser' | 'hand' | 'select'

export interface SketchEngineState {
  canUndo: boolean
  canRedo: boolean
  empty: boolean
  /** Houve alguma alteração desde que o editor abriu (ou desde `resetWith`). */
  dirty: boolean
  /** Quantos traços estão selecionados (a seleção em si não suja o desenho). */
  selectionCount: number
}

/** Traço em andamento passa deste tamanho: fecha e continua num traço novo, sem o usuário notar. */
const SPLIT_AT_POINTS = 4000
/** Raio da borracha em px de tela. */
const ERASER_RADIUS_PX = 6
/** Pontos mais próximos que isto (px de tela) do anterior são ruído e não entram. */
const MIN_POINT_DISTANCE_PX = 0.4
/** Margem do "Ajustar", em px de tela. */
const FIT_PADDING_PX = 32
/** O arraste de uma seleção só começa depois deste deslocamento (px de tela). */
const MOVE_START_PX = 2
/** Folga da caixa de seleção em volta dos traços (px de tela). */
const SELECT_PAD_PX = 6
/** Setas seguidas na mesma direção dentro deste intervalo viram uma operação só. */
const NUDGE_MERGE_MS = 400
/** Deslocamento das cópias ao duplicar (unidades do mundo). */
const DUPLICATE_OFFSET = 16

/** Cor de destaque do app (`--color-brand`) para a seleção; o canvas não lê CSS var sozinho. */
function brandRgb(): [number, number, number] {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--color-brand').trim()
    const parts = raw.split(/\s+/).map(Number)
    if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) return [parts[0], parts[1], parts[2]]
  } catch {
    // cai no padrão
  }
  return [124, 58, 237]
}

type TouchPoint = { x: number; y: number; type: string }

const boundsCache = new WeakMap<Stroke, Bounds>()
function cachedBounds(s: Stroke): Bounds {
  let b = boundsCache.get(s)
  if (!b) {
    b = strokeBounds(s)
    boundsCache.set(s, b)
  }
  return b
}

/**
 * Canvas de desenho à mão livre. Duas camadas empilhadas:
 *  - estática: os traços confirmados; só redesenha em pan/zoom/desfazer/borracha/
 *    limpar/resize (um traço novo é só acrescentado por cima, sem redesenhar tudo);
 *  - viva: apenas o traço em andamento, redesenhada uma vez por frame.
 * Nada de React aqui — o estado mutável vive em campos, não em `useState`, para o
 * `pointermove` não custar nada além de empilhar pontos.
 */
export class SketchEngine {
  private container: HTMLElement
  private staticCanvas: HTMLCanvasElement
  private liveCanvas: HTMLCanvasElement
  private sctx: CanvasRenderingContext2D
  private lctx: CanvasRenderingContext2D
  private resizeObserver: ResizeObserver
  private history: SketchHistory
  private baseVersion: number
  private onState?: (s: SketchEngineState) => void
  private onScale?: (scale: number) => void

  private vp: Viewport = { scale: 1, tx: 0, ty: 0 }
  private cssW = 0
  private cssH = 0
  private dpr = 1
  private rect: DOMRect

  tool: SketchTool = 'pen'
  color: string = DEFAULT_COLOR
  size = 4
  private theme: SketchTheme
  private penMode = false
  private spaceDown = false

  private pointers = new Map<number, TouchPoint>()
  private drawing: { pointerId: number; points: SketchPoint[]; real: boolean } | null = null
  private predicted: SketchPoint[] = []
  private erasing: { pointerId: number; hit: Map<string, Stroke> } | null = null
  private panning: { pointerId: number; x: number; y: number } | null = null
  private pinch: { dist: number; cx: number; cy: number } | null = null
  private hidden = new Set<string>()

  // Seleção: estado transitório do engine (não é histórico e não suja o desenho).
  private selection = new Set<string>()
  private marquee: {
    pointerId: number
    start: Point2
    cur: Point2
    base: Set<string>
  } | null = null
  private moving: {
    pointerId: number
    startWorld: Point2
    startScreen: Point2
    dx: number
    dy: number
    started: boolean
  } | null = null
  private lastNudge: { key: string; time: number; version: number; before: Stroke[]; dx: number; dy: number } | null = null
  private brand = brandRgb()

  private raf = 0
  private staticDirty = true
  private liveDirty = false
  private fitOnFirstSize: boolean

  constructor(
    container: HTMLElement,
    initial: Stroke[],
    onState?: (s: SketchEngineState) => void,
    onScale?: (scale: number) => void,
    // Entra no construtor (e não só em `setTheme`) para a primeira pintura já sair no
    // tema certo: aplicar depois piscaria branco ao abrir no escuro.
    theme: SketchTheme = 'light',
  ) {
    this.container = container
    this.onState = onState
    this.onScale = onScale
    this.theme = theme
    this.history = new SketchHistory(initial)
    this.baseVersion = this.history.version
    this.fitOnFirstSize = initial.length > 0

    // Os canvases são `absolute`: o container só precisa ser posicionado. Sobrescrever
    // um `absolute inset-0` do chamador com `relative` zera a altura do container.
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative'
    container.style.overflow = 'hidden'
    container.style.touchAction = 'none'
    container.style.userSelect = 'none'
    container.style.background = theme === 'dark' ? DARK_BG : LIGHT_BG

    this.staticCanvas = this.makeCanvas()
    this.liveCanvas = this.makeCanvas()
    this.sctx = this.staticCanvas.getContext('2d')!
    // `desynchronized` escreve direto na tela sem esperar o compositor, que é o que
    // corta a latência da ponta do traço; navegadores que não o aceitam o ignoram.
    this.lctx = (this.liveCanvas.getContext('2d', { desynchronized: true }) ??
      this.liveCanvas.getContext('2d'))!
    container.append(this.staticCanvas, this.liveCanvas)
    this.rect = container.getBoundingClientRect()
    this.applyCursor()

    container.addEventListener('pointerdown', this.onPointerDown)
    container.addEventListener('pointermove', this.onPointerMove)
    container.addEventListener('pointerup', this.onPointerUp)
    container.addEventListener('pointercancel', this.onPointerCancel)
    container.addEventListener('wheel', this.onWheel, { passive: false })
    container.addEventListener('contextmenu', this.onContextMenu)
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    window.addEventListener('resize', this.resize)
    this.resize()
  }

  // ── API pública ─────────────────────────────────────────────────────────

  getScene(): SketchScene {
    return { type: SKETCH_TYPE, version: SKETCH_VERSION, strokes: [...this.history.strokes] }
  }

  isEmpty(): boolean {
    return this.history.strokes.length === 0
  }

  undo(): void {
    this.cancelGesture()
    this.selection.clear()
    this.lastNudge = null
    if (this.history.undo()) this.changed(true)
    else this.changed(false)
  }

  redo(): void {
    this.cancelGesture()
    this.selection.clear()
    this.lastNudge = null
    if (this.history.redo()) this.changed(true)
    else this.changed(false)
  }

  clear(): void {
    this.cancelGesture()
    this.selection.clear()
    this.lastNudge = null
    if (this.history.clear()) this.changed(true)
    else this.changed(false)
  }

  /** Troca a cena inteira (usado por "Substituir por novo desenho"). */
  resetWith(strokes: Stroke[]): void {
    this.cancelGesture()
    this.selection.clear()
    this.lastNudge = null
    this.history = new SketchHistory(strokes)
    this.baseVersion = this.history.version
    this.changed(true)
  }

  setTool(tool: SketchTool): void {
    if (tool !== 'select') this.clearSelection()
    this.tool = tool
    this.applyCursor()
  }

  setColor(color: string): void {
    this.color = color
  }

  setSize(size: number): void {
    this.size = size
  }

  setPenMode(on: boolean): void {
    this.penMode = on
  }

  /**
   * Troca o tema de EXIBIÇÃO: fundo e cor com que os traços são pintados
   * (`themeColor`). A cor gravada nos traços não muda, nem histórico, viewport ou
   * o canvas em si — só marca as camadas como sujas e redesenha.
   */
  setTheme(theme: SketchTheme): void {
    if (theme === this.theme) return
    this.theme = theme
    this.container.style.background = theme === 'dark' ? DARK_BG : LIGHT_BG
    this.staticDirty = true
    this.liveDirty = true
    this.schedule()
  }

  /** Zoom atual (1 = 100%). */
  get scale(): number {
    return this.vp.scale
  }

  /** Zoom multiplicativo ancorado no centro do canvas (botões e atalhos). */
  zoomBy(factor: number): void {
    this.setVp(zoomAt(this.vp, factor, { x: this.cssW / 2, y: this.cssH / 2 }))
    this.staticDirty = true
    this.schedule()
  }

  /** Volta a 100%, ancorado no centro do canvas. */
  resetZoom(): void {
    const vp = zoomAt(this.vp, 1 / this.vp.scale, { x: this.cssW / 2, y: this.cssH / 2 })
    // `scale * (1 / scale)` pode sobrar um ε; 100% tem que ser exatamente 1.
    this.setVp({ ...vp, scale: 1 })
    this.staticDirty = true
    this.schedule()
  }

  /** Enquadra o desenho inteiro com margem; cena vazia volta a 100% na origem. */
  fitToContent(): void {
    const b = sceneBounds([...this.history.strokes])
    this.setVp(fitViewport(b, { width: this.cssW, height: this.cssH }, FIT_PADDING_PX))
    this.staticDirty = true
    this.schedule()
  }

  /** Único ponto que troca a viewport: avisa a UI quando o zoom muda. */
  private setVp(vp: Viewport): void {
    const prev = this.vp.scale
    this.vp = vp
    if (vp.scale !== prev) this.onScale?.(vp.scale)
  }

  /** `Space` pressionado: arrastar passa a fazer pan. */
  setSpaceDown(down: boolean): void {
    this.spaceDown = down
    this.applyCursor()
  }

  // ── seleção ─────────────────────────────────────────────────────────────

  get selectionCount(): number {
    return this.selection.size
  }

  clearSelection(): void {
    if (this.selection.size === 0 && !this.marquee && !this.moving) return
    this.cancelSelectGesture()
    this.selection.clear()
    this.afterSelectionChange()
  }

  /** Seleciona todos os traços e passa para a ferramenta Selecionar. */
  selectAll(): void {
    this.cancelGesture()
    this.tool = 'select'
    this.applyCursor()
    this.selection = new Set(this.history.strokes.map((s) => s.id))
    this.afterSelectionChange()
  }

  deleteSelection(): void {
    const sel = this.selected()
    if (sel.length === 0) return
    this.cancelGesture()
    this.selection.clear()
    this.lastNudge = null
    this.history.erase(sel)
    this.liveDirty = true
    this.changed(true)
  }

  /** Cópias deslocadas (+16, +16) com ids novos, que passam a ser a seleção; um desfazer remove todas. */
  duplicateSelection(): void {
    const sel = this.selected()
    if (sel.length === 0) return
    this.cancelGesture()
    const copies = duplicateStrokes(sel, DUPLICATE_OFFSET, DUPLICATE_OFFSET, newStrokeId)
    this.history.addMany(copies)
    this.selection = new Set(copies.map((c) => c.id))
    this.lastNudge = null
    this.liveDirty = true
    this.changed(true)
  }

  /** Troca a cor (canônica) dos selecionados; uma operação de desfazer. */
  applyColorToSelection(color: string): void {
    this.replaceSelected((s) => recolorStrokes(s, color))
  }

  applySizeToSelection(size: number): void {
    this.replaceSelected((s) => resizeStrokes(s, size))
  }

  /**
   * Move a seleção em px de TELA (setas). Setas seguidas na mesma direção em menos de
   * 400 ms viram uma única operação: desfaz a anterior e refaz acumulada.
   */
  nudgeSelection(dxPx: number, dyPx: number): void {
    const sel = this.selected()
    if (sel.length === 0) return
    this.cancelGesture()
    let dx = dxPx / this.vp.scale
    let dy = dyPx / this.vp.scale
    let before = sel
    const key = `${Math.sign(dxPx)},${Math.sign(dyPx)}`
    const now = performance.now()
    const n = this.lastNudge
    if (n && n.key === key && now - n.time < NUDGE_MERGE_MS && n.version === this.history.version) {
      this.history.undo()
      before = n.before
      dx += n.dx
      dy += n.dy
    }
    if (!this.history.replace(before, translateStrokes(before, dx, dy))) return
    this.lastNudge = { key, time: now, version: this.history.version, before, dx, dy }
    this.liveDirty = true
    this.changed(true)
  }

  private replaceSelected(fn: (s: Stroke[]) => Stroke[]): void {
    const before = this.selected()
    if (before.length === 0) return
    this.cancelGesture()
    this.lastNudge = null
    if (this.history.replace(before, fn(before))) {
      this.liveDirty = true
      this.changed(true)
    }
  }

  private selected(): Stroke[] {
    return this.history.strokes.filter((s) => this.selection.has(s.id))
  }

  /** Bounding box dos selecionados (em unidades do mundo), com o cache por traço. */
  private selectedBounds(): Bounds | null {
    let out: Bounds | null = null
    for (const s of this.history.strokes) {
      if (!this.selection.has(s.id)) continue
      const b = cachedBounds(s)
      out = out
        ? {
            minX: Math.min(out.minX, b.minX),
            minY: Math.min(out.minY, b.minY),
            maxX: Math.max(out.maxX, b.maxX),
            maxY: Math.max(out.maxY, b.maxY),
          }
        : b
    }
    return out
  }

  private afterSelectionChange(): void {
    this.lastNudge = null
    this.liveDirty = true
    this.schedule()
    this.emit()
  }

  /** Traços atingidos pelo retângulo; o bounding box em cache evita o custo O(pontos) por traço. */
  private strokesHitByRect(rect: Bounds): string[] {
    const ids: string[] = []
    for (const s of this.history.strokes) {
      const b = cachedBounds(s)
      if (b.maxX < rect.minX || b.minX > rect.maxX || b.maxY < rect.minY || b.minY > rect.maxY) continue
      if (strokeIntersectsRect(s, rect)) ids.push(s.id)
    }
    return ids
  }

  state(): SketchEngineState {
    return {
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      empty: this.history.strokes.length === 0,
      dirty: this.history.version !== this.baseVersion,
      selectionCount: this.selection.size,
    }
  }

  destroy(): void {
    cancelAnimationFrame(this.raf)
    this.resizeObserver.disconnect()
    window.removeEventListener('resize', this.resize)
    const c = this.container
    c.removeEventListener('pointerdown', this.onPointerDown)
    c.removeEventListener('pointermove', this.onPointerMove)
    c.removeEventListener('pointerup', this.onPointerUp)
    c.removeEventListener('pointercancel', this.onPointerCancel)
    c.removeEventListener('wheel', this.onWheel)
    c.removeEventListener('contextmenu', this.onContextMenu)
    this.staticCanvas.remove()
    this.liveCanvas.remove()
  }

  // ── canvas / viewport ───────────────────────────────────────────────────

  private makeCanvas(): HTMLCanvasElement {
    const c = document.createElement('canvas')
    c.style.position = 'absolute'
    c.style.inset = '0'
    c.style.width = '100%'
    c.style.height = '100%'
    c.style.display = 'block'
    return c
  }

  private resize = (): void => {
    const r = this.container.getBoundingClientRect()
    this.rect = r
    this.dpr = Math.max(1, window.devicePixelRatio || 1)
    this.cssW = r.width
    this.cssH = r.height
    for (const c of [this.staticCanvas, this.liveCanvas]) {
      c.width = Math.max(1, Math.round(r.width * this.dpr))
      c.height = Math.max(1, Math.round(r.height * this.dpr))
    }
    if (this.fitOnFirstSize && r.width > 0 && r.height > 0) {
      this.fitOnFirstSize = false
      this.centerOnContent()
    }
    this.staticDirty = true
    this.liveDirty = true
    this.schedule()
  }

  /** Abre com o conteúdo à vista: centraliza o bounding box sem mexer no zoom. */
  private centerOnContent(): void {
    const b = sceneBounds([...this.history.strokes])
    if (!b) return
    this.setVp({
      scale: 1,
      tx: (this.cssW - (b.maxX - b.minX)) / 2 - b.minX,
      ty: (this.cssH - (b.maxY - b.minY)) / 2 - b.minY,
    })
  }

  private applyCursor(): void {
    this.container.style.cursor =
      this.spaceDown || this.tool === 'hand'
        ? 'grab'
        : this.tool === 'eraser'
          ? 'cell'
          : this.tool === 'select'
            ? 'default'
            : 'crosshair'
  }

  private local(e: { clientX: number; clientY: number }): Point2 {
    return { x: e.clientX - this.rect.left, y: e.clientY - this.rect.top }
  }

  private world(e: { clientX: number; clientY: number }): Point2 {
    return screenToWorld(this.vp, this.local(e))
  }

  // ── desenho ─────────────────────────────────────────────────────────────

  private schedule(): void {
    if (this.raf) return
    this.raf = requestAnimationFrame(this.frame)
  }

  private frame = (): void => {
    this.raf = 0
    if (this.staticDirty) {
      this.drawStatic()
      // Pan/zoom/resize mudam a conta mundo→tela: a caixa e o retângulo de seleção (que vivem
      // na camada viva) têm de ser reposicionados junto.
      if (this.selection.size > 0 || this.marquee) this.liveDirty = true
    }
    if (this.liveDirty) this.drawLive()
  }

  private applyTransform(ctx: CanvasRenderingContext2D): void {
    const k = this.dpr * this.vp.scale
    ctx.setTransform(k, 0, 0, k, this.dpr * this.vp.tx, this.dpr * this.vp.ty)
  }

  private drawStatic(): void {
    this.staticDirty = false
    const ctx = this.sctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.staticCanvas.width, this.staticCanvas.height)
    this.applyTransform(ctx)

    const { scale, tx, ty } = this.vp
    const view: Bounds = { minX: -tx / scale, minY: -ty / scale, maxX: (this.cssW - tx) / scale, maxY: (this.cssH - ty) / scale }
    for (const s of this.history.strokes) {
      if (this.hidden.has(s.id)) continue
      const b = cachedBounds(s)
      if (b.maxX < view.minX || b.minX > view.maxX || b.maxY < view.minY || b.minY > view.maxY) continue
      ctx.fillStyle = themeColor(s.color, this.theme)
      ctx.fill(strokePath2D(s))
    }
  }

  private drawLive(): void {
    this.liveDirty = false
    const ctx = this.lctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.liveCanvas.width, this.liveCanvas.height)

    if (this.drawing) {
      this.applyTransform(ctx)
      // A ponta prevista só existe aqui, na camada viva: nunca entra no traço gravado.
      const points = this.predicted.length ? [...this.drawing.points, ...this.predicted] : this.drawing.points
      ctx.fillStyle = themeColor(this.color, this.theme)
      ctx.fill(livePath2D({ points, size: this.size }))
    }

    // Mover: os selecionados saem da estática e são pintados aqui com um translate sobre
    // o Path2D em cache — nenhum outline é recalculado a cada pointermove.
    const shift = this.moving?.started ? this.moving : null
    if (shift) {
      this.applyTransform(ctx)
      ctx.translate(shift.dx, shift.dy)
      for (const s of this.history.strokes) {
        if (!this.selection.has(s.id)) continue
        ctx.fillStyle = themeColor(s.color, this.theme)
        ctx.fill(strokePath2D(s))
      }
    }

    if (this.selection.size > 0 || this.marquee) this.drawSelectionOverlay(ctx, shift)
  }

  /** Caixa tracejada da seleção e retângulo de seleção, em px de tela (espessura constante em qualquer zoom). */
  private drawSelectionOverlay(ctx: CanvasRenderingContext2D, shift: { dx: number; dy: number } | null): void {
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    const { scale, tx, ty } = this.vp
    const [r, g, b] = this.brand

    const box = this.selectedBounds()
    if (box) {
      const dx = shift?.dx ?? 0
      const dy = shift?.dy ?? 0
      const x0 = (box.minX + dx) * scale + tx - SELECT_PAD_PX
      const y0 = (box.minY + dy) * scale + ty - SELECT_PAD_PX
      const x1 = (box.maxX + dx) * scale + tx + SELECT_PAD_PX
      const y1 = (box.maxY + dy) * scale + ty + SELECT_PAD_PX
      ctx.lineWidth = 1.5
      ctx.setLineDash([6, 4])
      ctx.strokeStyle = `rgb(${r} ${g} ${b})`
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0)
      ctx.setLineDash([])
    }

    if (this.marquee) {
      const a = this.marquee.start
      const c = this.marquee.cur
      const x = Math.min(a.x, c.x) * scale + tx
      const y = Math.min(a.y, c.y) * scale + ty
      const w = Math.abs(a.x - c.x) * scale
      const h = Math.abs(a.y - c.y) * scale
      ctx.fillStyle = `rgb(${r} ${g} ${b} / 0.08)`
      ctx.fillRect(x, y, w, h)
      ctx.lineWidth = 1
      ctx.strokeStyle = `rgb(${r} ${g} ${b} / 0.9)`
      ctx.strokeRect(x, y, w, h)
    }
  }

  // ── entrada ─────────────────────────────────────────────────────────────

  private onContextMenu = (e: Event): void => e.preventDefault()

  private touchCount(): number {
    let n = 0
    for (const p of this.pointers.values()) if (p.type === 'touch') n++
    return n
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button === 2) return
    this.rect = this.container.getBoundingClientRect()
    const l = this.local(e)
    this.pointers.set(e.pointerId, { x: l.x, y: l.y, type: e.pointerType })
    this.container.setPointerCapture(e.pointerId)

    // Segundo dedo: vira gesto de pan/pinça e tem precedência sobre tudo, inclusive a
    // Mão; o traço em andamento é descartado para não deixar risco.
    if (e.pointerType === 'touch' && this.touchCount() >= 2) {
      this.discardInProgress()
      this.panning = null
      this.startPinch()
      this.applyCursor()
      return
    }

    // Pan: botão do meio, Space + arrastar, ou a ferramenta Mão com qualquer ponteiro.
    // Vem antes do modo caneta, que só restringe quem pode DESENHAR.
    if (e.button === 1 || (e.button === 0 && (this.spaceDown || this.tool === 'hand'))) {
      this.panning = { pointerId: e.pointerId, x: l.x, y: l.y }
      this.container.style.cursor = 'grabbing'
      e.preventDefault()
      return
    }

    // Modo caneta: dedo e palma não desenham.
    if (e.pointerType === 'touch' && this.penMode) return

    const erase = this.tool === 'eraser' || (e.pointerType === 'pen' && (e.buttons & 32) !== 0)
    if (erase) {
      this.erasing = { pointerId: e.pointerId, hit: new Map() }
      this.eraseAt(this.world(e))
      return
    }

    if (this.tool === 'select') {
      this.beginSelect(e)
      return
    }

    const real = e.pointerType === 'pen'
    const w = this.world(e)
    this.drawing = {
      pointerId: e.pointerId,
      real,
      points: [[w.x, w.y, real ? e.pressure || 0.5 : 0.5]],
    }
    this.predicted = []
    this.liveDirty = true
    this.schedule()
  }

  private onPointerMove = (e: PointerEvent): void => {
    const known = this.pointers.get(e.pointerId)
    if (known) {
      const l = this.local(e)
      known.x = l.x
      known.y = l.y
    }

    if (this.panning && this.panning.pointerId === e.pointerId) {
      const l = this.local(e)
      this.setVp({ ...this.vp, tx: this.vp.tx + (l.x - this.panning.x), ty: this.vp.ty + (l.y - this.panning.y) })
      this.panning.x = l.x
      this.panning.y = l.y
      this.staticDirty = true
      this.schedule()
      return
    }

    if (this.pinch && known && known.type === 'touch') {
      this.updatePinch()
      return
    }

    if (this.moving && this.moving.pointerId === e.pointerId) {
      this.moveSelection(e)
      return
    }

    if (this.marquee && this.marquee.pointerId === e.pointerId) {
      this.updateMarquee(e)
      return
    }

    if (this.drawing && this.drawing.pointerId === e.pointerId) {
      this.extendStroke(e)
      return
    }

    if (this.erasing && this.erasing.pointerId === e.pointerId) {
      const events = e.getCoalescedEvents?.() ?? []
      for (const ev of events.length ? events : [e]) this.eraseAt(this.world(ev))
      return
    }

    // Sem gesto em andamento: o cursor indica se dá para mover (sobre a seleção).
    if (this.tool === 'select' && !this.spaceDown && e.buttons === 0) this.updateSelectCursor(e)
  }

  // ── gestos da ferramenta Selecionar ─────────────────────────────────────

  private beginSelect(e: PointerEvent): void {
    const w = this.world(e)
    const radius = ERASER_RADIUS_PX / this.vp.scale
    const hit = strokeAtPoint(this.history.strokes, w, radius)
    const inside = this.pointInSelection(w)
    const startMove = () => {
      this.moving = {
        pointerId: e.pointerId,
        startWorld: w,
        startScreen: this.local(e),
        dx: 0,
        dy: 0,
        started: false,
      }
    }

    if (e.shiftKey) {
      // Shift soma/alterna; no vazio, o retângulo soma à seleção atual.
      if (hit) {
        if (this.selection.has(hit.id)) {
          this.selection.delete(hit.id)
        } else {
          this.selection.add(hit.id)
          startMove()
        }
        this.afterSelectionChange()
      } else {
        this.marquee = { pointerId: e.pointerId, start: w, cur: w, base: new Set(this.selection) }
      }
      return
    }

    if (hit && this.selection.has(hit.id)) {
      startMove()
      return
    }
    if (!hit && inside) {
      startMove()
      return
    }
    if (hit) {
      // Arrastar um traço que não estava selecionado o seleciona e o move.
      this.selection = new Set([hit.id])
      startMove()
      this.afterSelectionChange()
      return
    }

    if (this.selection.size > 0) {
      this.selection.clear()
      this.afterSelectionChange()
    }
    this.marquee = { pointerId: e.pointerId, start: w, cur: w, base: new Set() }
  }

  private pointInSelection(w: Point2): boolean {
    const box = this.selectedBounds()
    if (!box) return false
    const pad = SELECT_PAD_PX / this.vp.scale
    return w.x >= box.minX - pad && w.x <= box.maxX + pad && w.y >= box.minY - pad && w.y <= box.maxY + pad
  }

  private updateSelectCursor(e: PointerEvent): void {
    this.container.style.cursor = this.pointInSelection(this.world(e)) ? 'move' : 'default'
  }

  private moveSelection(e: PointerEvent): void {
    const m = this.moving!
    if (!m.started) {
      const l = this.local(e)
      if (Math.hypot(l.x - m.startScreen.x, l.y - m.startScreen.y) < MOVE_START_PX) return
      m.started = true
      // Os selecionados saem da estática (redesenhada uma vez) e passam a viver na viva.
      for (const id of this.selection) this.hidden.add(id)
      this.staticDirty = true
      this.container.style.cursor = 'grabbing'
    }
    const w = this.world(e)
    m.dx = w.x - m.startWorld.x
    m.dy = w.y - m.startWorld.y
    this.liveDirty = true
    this.schedule()
  }

  private updateMarquee(e: PointerEvent): void {
    const mq = this.marquee!
    mq.cur = this.world(e)
    const hits = this.strokesHitByRect(normalizeRect(mq.start, mq.cur))
    this.selection = new Set([...mq.base, ...hits])
    this.liveDirty = true
    this.schedule()
  }

  private extendStroke(e: PointerEvent): void {
    const d = this.drawing!
    const events = e.getCoalescedEvents?.() ?? []
    for (const ev of events.length ? events : [e]) {
      const w = this.world(ev)
      const last = d.points[d.points.length - 1]
      // Descarta o que mal se mexeu; mouse parado entre frames gera duplicatas.
      if (Math.hypot(w.x - last[0], w.y - last[1]) * this.vp.scale < MIN_POINT_DISTANCE_PX) continue
      d.points.push([w.x, w.y, d.real ? ev.pressure || last[2] : 0.5])
    }

    const getPredicted = (e as PointerEvent & { getPredictedEvents?: () => PointerEvent[] }).getPredictedEvents
    this.predicted = []
    if (typeof getPredicted === 'function') {
      for (const ev of getPredicted.call(e)) {
        const w = this.world(ev)
        this.predicted.push([w.x, w.y, d.real ? ev.pressure || 0.5 : 0.5])
      }
    }

    if (d.points.length >= SPLIT_AT_POINTS) this.splitStroke()
    this.liveDirty = true
    this.schedule()
  }

  /** Fecha o traço atual e continua num novo a partir do último ponto, de forma transparente. */
  private splitStroke(): void {
    const d = this.drawing!
    const last = d.points[d.points.length - 1]
    this.commitStroke(d.points)
    d.points = [last]
  }

  private commitStroke(points: SketchPoint[]): void {
    const stroke: Stroke = { id: newStrokeId(), tool: 'pen', color: this.color, size: this.size, points: [...points] }
    this.history.add(stroke)
    // O traço novo é o último da ordem de pintura: basta acrescentá-lo à estática.
    this.applyTransform(this.sctx)
    this.sctx.fillStyle = themeColor(stroke.color, this.theme)
    this.sctx.fill(strokePath2D(stroke))
    this.emit()
  }

  private onPointerUp = (e: PointerEvent): void => {
    this.finishPointer(e, false)
  }

  private onPointerCancel = (e: PointerEvent): void => {
    this.finishPointer(e, true)
  }

  private finishPointer(e: PointerEvent, cancelled: boolean): void {
    this.pointers.delete(e.pointerId)
    if (this.container.hasPointerCapture(e.pointerId)) this.container.releasePointerCapture(e.pointerId)

    if (this.panning && this.panning.pointerId === e.pointerId) {
      this.panning = null
      this.applyCursor()
    }
    if (this.pinch && this.touchCount() < 2) this.pinch = null

    if (this.drawing && this.drawing.pointerId === e.pointerId) {
      const points = this.drawing.points
      this.drawing = null
      this.predicted = []
      this.liveDirty = true
      this.schedule()
      if (!cancelled && points.length > 0) this.commitStroke(points)
    }

    if (this.moving && this.moving.pointerId === e.pointerId) {
      const m = this.moving
      this.moving = null
      if (m.started) {
        this.hidden.clear()
        // O gesto inteiro vira UMA operação; sem deslocamento real, nenhuma.
        if (!cancelled && (Math.abs(m.dx) >= 0.05 || Math.abs(m.dy) >= 0.05)) {
          const before = this.selected()
          this.history.replace(before, translateStrokes(before, m.dx, m.dy))
        }
        this.lastNudge = null
        this.staticDirty = true
        this.liveDirty = true
        this.schedule()
        this.applyCursor()
        this.emit()
      }
    }

    if (this.marquee && this.marquee.pointerId === e.pointerId) {
      this.marquee = null
      this.liveDirty = true
      this.schedule()
      this.emit()
    }

    if (this.erasing && this.erasing.pointerId === e.pointerId) {
      const hit = [...this.erasing.hit.values()]
      this.erasing = null
      this.hidden.clear()
      // A passada inteira vira UMA operação de desfazer.
      if (!cancelled && hit.length > 0) this.history.erase(hit)
      this.staticDirty = true
      this.schedule()
      this.emit()
    }
  }

  private eraseAt(world: Point2): void {
    const er = this.erasing!
    const radius = ERASER_RADIUS_PX / this.vp.scale
    const candidates = this.history.strokes.filter((s) => !this.hidden.has(s.id))
    const hits = eraseAt(candidates, world, radius)
    if (hits.length === 0) return
    for (const s of hits) {
      er.hit.set(s.id, s)
      this.hidden.add(s.id)
    }
    this.staticDirty = true
    this.schedule()
  }

  /** Descarta o que estiver em andamento (traço ou borracha) sem gravar nada. */
  private cancelGesture(): void {
    this.discardInProgress()
    if (this.erasing) {
      this.erasing = null
      this.hidden.clear()
      this.staticDirty = true
      this.schedule()
    }
  }

  private discardInProgress(): void {
    this.cancelSelectGesture()
    if (!this.drawing) return
    this.drawing = null
    this.predicted = []
    this.liveDirty = true
    this.schedule()
  }

  /** Descarta um arraste de seleção/movimento sem gravar nada (a seleção em si fica). */
  private cancelSelectGesture(): void {
    this.marquee = null
    if (this.moving) {
      this.moving = null
      this.hidden.clear()
      this.staticDirty = true
      this.applyCursor()
    }
    this.liveDirty = true
    this.schedule()
  }

  // ── pinça e roda ────────────────────────────────────────────────────────

  private touchPair(): [TouchPoint, TouchPoint] | null {
    const t = [...this.pointers.values()].filter((p) => p.type === 'touch')
    return t.length >= 2 ? [t[0], t[1]] : null
  }

  private startPinch(): void {
    const pair = this.touchPair()
    if (!pair) return
    const [a, b] = pair
    this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }
  }

  private updatePinch(): void {
    const pair = this.touchPair()
    if (!pair || !this.pinch) return
    const [a, b] = pair
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1
    const cx = (a.x + b.x) / 2
    const cy = (a.y + b.y) / 2
    // Zoom ancorado no centro da pinça, depois o deslocamento do centro vira pan.
    let vp = zoomAt(this.vp, dist / this.pinch.dist, { x: cx, y: cy })
    vp = { ...vp, tx: vp.tx + (cx - this.pinch.cx), ty: vp.ty + (cy - this.pinch.cy) }
    this.setVp(vp)
    this.pinch = { dist, cx, cy }
    this.staticDirty = true
    this.schedule()
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    const l = this.local(e)
    if (e.ctrlKey || e.metaKey) {
      // Pinça de trackpad chega como ctrl+wheel com deltas pequenos; roda de mouse com ctrl, deltas grandes.
      const unit = e.deltaMode === 1 ? 0.05 : 0.0025
      this.setVp(zoomAt(this.vp, Math.exp(-e.deltaY * unit), l))
    } else {
      const dx = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX
      const dy = e.shiftKey && e.deltaX === 0 ? 0 : e.deltaY
      this.setVp({ ...this.vp, tx: this.vp.tx - dx, ty: this.vp.ty - dy })
    }
    this.staticDirty = true
    this.schedule()
  }

  // ── estado ──────────────────────────────────────────────────────────────

  private changed(redraw: boolean): void {
    if (redraw) {
      this.staticDirty = true
      this.schedule()
    }
    this.emit()
  }

  private emit(): void {
    this.onState?.(this.state())
  }
}
