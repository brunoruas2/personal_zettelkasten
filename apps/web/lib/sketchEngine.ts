import {
  SketchHistory,
  eraseAt,
  newStrokeId,
  sceneBounds,
  screenToWorld,
  strokeBounds,
  zoomAt,
  SKETCH_TYPE,
  SKETCH_VERSION,
  DEFAULT_COLOR,
  type Bounds,
  type Point2,
  type SketchPoint,
  type SketchScene,
  type Stroke,
  type Viewport,
} from '@zettelkasten/core'
import { livePath2D, strokePath2D } from './sketchRender'

export type SketchTool = 'pen' | 'eraser'

export interface SketchEngineState {
  canUndo: boolean
  canRedo: boolean
  empty: boolean
  /** Houve alguma alteração desde que o editor abriu (ou desde `resetWith`). */
  dirty: boolean
}

/** Traço em andamento passa deste tamanho: fecha e continua num traço novo, sem o usuário notar. */
const SPLIT_AT_POINTS = 4000
/** Raio da borracha em px de tela. */
const ERASER_RADIUS_PX = 6
/** Pontos mais próximos que isto (px de tela) do anterior são ruído e não entram. */
const MIN_POINT_DISTANCE_PX = 0.4

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

  private vp: Viewport = { scale: 1, tx: 0, ty: 0 }
  private cssW = 0
  private cssH = 0
  private dpr = 1
  private rect: DOMRect

  tool: SketchTool = 'pen'
  color: string = DEFAULT_COLOR
  size = 4
  private penMode = false
  private spaceDown = false

  private pointers = new Map<number, TouchPoint>()
  private drawing: { pointerId: number; points: SketchPoint[]; real: boolean } | null = null
  private predicted: SketchPoint[] = []
  private erasing: { pointerId: number; hit: Map<string, Stroke> } | null = null
  private panning: { pointerId: number; x: number; y: number } | null = null
  private pinch: { dist: number; cx: number; cy: number } | null = null
  private hidden = new Set<string>()

  private raf = 0
  private staticDirty = true
  private liveDirty = false
  private fitOnFirstSize: boolean

  constructor(
    container: HTMLElement,
    initial: Stroke[],
    onState?: (s: SketchEngineState) => void,
  ) {
    this.container = container
    this.onState = onState
    this.history = new SketchHistory(initial)
    this.baseVersion = this.history.version
    this.fitOnFirstSize = initial.length > 0

    // Os canvases são `absolute`: o container só precisa ser posicionado. Sobrescrever
    // um `absolute inset-0` do chamador com `relative` zera a altura do container.
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative'
    container.style.overflow = 'hidden'
    container.style.touchAction = 'none'
    container.style.userSelect = 'none'
    container.style.background = '#ffffff'

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
    if (this.history.undo()) this.changed(true)
  }

  redo(): void {
    this.cancelGesture()
    if (this.history.redo()) this.changed(true)
  }

  clear(): void {
    this.cancelGesture()
    if (this.history.clear()) this.changed(true)
  }

  /** Troca a cena inteira (usado por "Substituir por novo desenho"). */
  resetWith(strokes: Stroke[]): void {
    this.cancelGesture()
    this.history = new SketchHistory(strokes)
    this.baseVersion = this.history.version
    this.changed(true)
  }

  setTool(tool: SketchTool): void {
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

  /** `Space` pressionado: arrastar passa a fazer pan. */
  setSpaceDown(down: boolean): void {
    this.spaceDown = down
    this.applyCursor()
  }

  state(): SketchEngineState {
    return {
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      empty: this.history.strokes.length === 0,
      dirty: this.history.version !== this.baseVersion,
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
    this.vp = {
      scale: 1,
      tx: (this.cssW - (b.maxX - b.minX)) / 2 - b.minX,
      ty: (this.cssH - (b.maxY - b.minY)) / 2 - b.minY,
    }
  }

  private applyCursor(): void {
    this.container.style.cursor = this.spaceDown ? 'grab' : this.tool === 'eraser' ? 'cell' : 'crosshair'
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
    if (this.staticDirty) this.drawStatic()
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
      ctx.fillStyle = s.color
      ctx.fill(strokePath2D(s))
    }
  }

  private drawLive(): void {
    this.liveDirty = false
    const ctx = this.lctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.liveCanvas.width, this.liveCanvas.height)
    if (!this.drawing) return
    this.applyTransform(ctx)
    // A ponta prevista só existe aqui, na camada viva: nunca entra no traço gravado.
    const points = this.predicted.length ? [...this.drawing.points, ...this.predicted] : this.drawing.points
    ctx.fillStyle = this.color
    ctx.fill(livePath2D({ points, size: this.size }))
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

    // Pan: botão do meio, ou Space + arrastar.
    if (e.button === 1 || (e.button === 0 && this.spaceDown)) {
      this.panning = { pointerId: e.pointerId, x: l.x, y: l.y }
      e.preventDefault()
      return
    }

    if (e.pointerType === 'touch') {
      // Segundo dedo: o traço em andamento vira gesto de pan/pinça, sem deixar risco.
      if (this.touchCount() >= 2) {
        this.discardInProgress()
        this.startPinch()
        return
      }
      // Modo caneta: dedo e palma não desenham.
      if (this.penMode) return
    }

    const erase = this.tool === 'eraser' || (e.pointerType === 'pen' && (e.buttons & 32) !== 0)
    if (erase) {
      this.erasing = { pointerId: e.pointerId, hit: new Map() }
      this.eraseAt(this.world(e))
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
      this.vp = { ...this.vp, tx: this.vp.tx + (l.x - this.panning.x), ty: this.vp.ty + (l.y - this.panning.y) }
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

    if (this.drawing && this.drawing.pointerId === e.pointerId) {
      this.extendStroke(e)
      return
    }

    if (this.erasing && this.erasing.pointerId === e.pointerId) {
      const events = e.getCoalescedEvents?.() ?? []
      for (const ev of events.length ? events : [e]) this.eraseAt(this.world(ev))
    }
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
    this.sctx.fillStyle = stroke.color
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

    if (this.panning && this.panning.pointerId === e.pointerId) this.panning = null
    if (this.pinch && this.touchCount() < 2) this.pinch = null

    if (this.drawing && this.drawing.pointerId === e.pointerId) {
      const points = this.drawing.points
      this.drawing = null
      this.predicted = []
      this.liveDirty = true
      this.schedule()
      if (!cancelled && points.length > 0) this.commitStroke(points)
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
    if (!this.drawing) return
    this.drawing = null
    this.predicted = []
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
    this.vp = vp
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
      this.vp = zoomAt(this.vp, Math.exp(-e.deltaY * unit), l)
    } else {
      const dx = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX
      const dy = e.shiftKey && e.deltaX === 0 ? 0 : e.deltaY
      this.vp = { ...this.vp, tx: this.vp.tx - dx, ty: this.vp.ty - dy }
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
