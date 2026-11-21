import { describe, it, expect } from 'vitest'
import { binarizeAdaptive, inkFraction, rgbaToGray } from './DocumentBinarize'

function makePage(w: number, h: number, shade: (x: number, y: number) => number, ink: (x: number, y: number) => boolean) {
  const gray = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const paper = shade(x, y)
      gray[y * w + x] = ink(x, y) ? Math.round(paper * 0.25) : paper
    }
  return gray
}

describe('binarizeAdaptive', () => {
  it('só produz 0 ou 255', () => {
    const g = makePage(64, 64, () => 200, (x) => x % 9 === 0)
    const out = binarizeAdaptive(g, 64, 64)
    expect(out.every((v) => v === 0 || v === 255)).toBe(true)
  })

  it('papel liso fica todo branco', () => {
    const out = binarizeAdaptive(makePage(80, 60, () => 190, () => false), 80, 60)
    expect(inkFraction(out)).toBe(0)
  })

  it('traço fino sobre papel vira preto', () => {
    const w = 100
    const h = 100
    const ink = (x: number, y: number) => y === 50 && x > 10 && x < 90
    const out = binarizeAdaptive(makePage(w, h, () => 200, ink), w, h)
    expect(out[50 * w + 50]).toBe(0)
    expect(out[20 * w + 50]).toBe(255)
  })

  it('gradiente de iluminação não vira mancha: fundo branco, traço preto', () => {
    const w = 200
    const h = 100
    // papel vai de 230 (esquerda) a 90 (direita, "sombra")
    const shade = (x: number) => Math.round(230 - (140 * x) / (w - 1))
    const ink = (x: number, y: number) => y === 50 && (x === 30 || x === 170)
    const out = binarizeAdaptive(makePage(w, h, shade, ink), w, h)
    expect(out[50 * w + 30]).toBe(0)
    expect(out[50 * w + 170]).toBe(0)
    expect(out[20 * w + 100]).toBe(255)
    expect(out[20 * w + 190]).toBe(255)
    expect(inkFraction(out)).toBeLessThan(0.02)
  })
})

describe('rgbaToGray', () => {
  it('converte por luminância', () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255])
    expect(Array.from(rgbaToGray(rgba, 2, 1))).toEqual([255, 0])
  })
})
