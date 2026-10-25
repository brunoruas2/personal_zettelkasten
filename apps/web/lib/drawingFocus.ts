import { FocusGate } from '@zettelkasten/core'

/**
 * Modo desenho: enquanto o editor de desenho está aberto, o sync em background
 * não começa — cada gatilho fica guardado por chave e roda uma vez ao fechar
 * (`useDrawingFocusStore.exit`). Salvar o desenho e o autosave do zettel não
 * passam por aqui.
 */
export const drawingFocusGate = new FocusGate()

export function deferIfDrawing(key: string, fn: () => void): void {
  drawingFocusGate.run(key, fn)
}
