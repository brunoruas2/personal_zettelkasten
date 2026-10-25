import { create } from 'zustand'
import { deferIfDrawing, drawingFocusGate } from '../lib/drawingFocus'

interface DrawingFocusStore {
  /** Há editor de desenho aberto: a galáxia suspende e o sync de background espera. */
  active: boolean
  enter: () => void
  exit: () => void
}

export const useDrawingFocusStore = create<DrawingFocusStore>((set) => ({
  active: false,
  enter: () => {
    drawingFocusGate.enter()
    set({ active: true })
  },
  exit: () => {
    const pending = drawingFocusGate.exit()
    set({ active: drawingFocusGate.active })
    if (pending.length === 0) return
    // Depois do fechamento do modal; se outro desenho abrir antes, volta a esperar.
    setTimeout(() => {
      for (const [key, fn] of pending) deferIfDrawing(key, fn)
    }, 0)
  },
}))
