import { serializeSketchScene, type SketchScene } from '@zettelkasten/core'
import { sceneToSvg } from './sketchRender'

const encoder = new TextEncoder()

/**
 * Peso do desenho como o servidor o conta: bytes UTF-8 da cena serializada + do SVG de preview.
 * Custo O(traços) — chamar com debounce, nunca durante o traço.
 */
export function measureDrawingBytes(scene: SketchScene): number {
  const out = sceneToSvg(scene)
  if (!out) return 0
  return encoder.encode(serializeSketchScene(scene)).length + encoder.encode(out.svg).length
}
