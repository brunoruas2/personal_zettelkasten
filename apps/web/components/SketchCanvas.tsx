'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { SketchScene, Stroke } from '@zettelkasten/core'
import { SketchEngine, type SketchEngineState, type SketchTool } from '../lib/sketchEngine'

export type { SketchEngineState, SketchTool }

export interface SketchCanvasHandle {
  getScene(): SketchScene
  isEmpty(): boolean
  undo(): void
  redo(): void
  clear(): void
  /** Troca a cena inteira (Substituir por novo desenho). */
  resetWith(strokes: Stroke[]): void
  setTool(tool: SketchTool): void
  setColor(color: string): void
  setSize(size: number): void
  setPenMode(on: boolean): void
  setSpaceDown(down: boolean): void
  /** Zoom multiplicativo ancorado no centro (botões e atalhos). */
  zoomBy(factor: number): void
  /** Volta a 100%. */
  resetZoom(): void
  /** Enquadra o desenho inteiro; cena vazia volta a 100%. */
  fitToContent(): void
}

interface Props {
  /** Traços iniciais; lidos uma vez, na montagem. */
  initialStrokes: Stroke[]
  onStateChange?: (s: SketchEngineState) => void
  /** Zoom atual (1 = 100%): chamado em roda, pinça, botões e atalhos. */
  onZoomChange?: (scale: number) => void
  className?: string
}

/**
 * Casca React do `SketchEngine`. O engine é criado na montagem e destruído na
 * desmontagem; nada do desenho passa por `useState` — o React só vê o estado
 * agregado (desfazer/refazer/vazio/sujo) pelo callback.
 */
export const SketchCanvas = forwardRef<SketchCanvasHandle, Props>(function SketchCanvas(
  { initialStrokes, onStateChange, onZoomChange, className },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<SketchEngine | null>(null)
  const onStateRef = useRef(onStateChange)
  onStateRef.current = onStateChange
  const onZoomRef = useRef(onZoomChange)
  onZoomRef.current = onZoomChange
  const initialRef = useRef(initialStrokes)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const engine = new SketchEngine(
      host,
      initialRef.current,
      (s) => onStateRef.current?.(s),
      (scale) => onZoomRef.current?.(scale),
    )
    engineRef.current = engine
    onStateRef.current?.(engine.state())
    onZoomRef.current?.(engine.scale)
    return () => {
      engine.destroy()
      engineRef.current = null
    }
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      getScene: () => engineRef.current!.getScene(),
      isEmpty: () => engineRef.current?.isEmpty() ?? true,
      undo: () => engineRef.current?.undo(),
      redo: () => engineRef.current?.redo(),
      clear: () => engineRef.current?.clear(),
      resetWith: (strokes) => engineRef.current?.resetWith(strokes),
      setTool: (t) => engineRef.current?.setTool(t),
      setColor: (c) => engineRef.current?.setColor(c),
      setSize: (n) => engineRef.current?.setSize(n),
      setPenMode: (on) => engineRef.current?.setPenMode(on),
      setSpaceDown: (d) => engineRef.current?.setSpaceDown(d),
      zoomBy: (f) => engineRef.current?.zoomBy(f),
      resetZoom: () => engineRef.current?.resetZoom(),
      fitToContent: () => engineRef.current?.fitToContent(),
    }),
    [],
  )

  return <div ref={hostRef} className={className} />
})
