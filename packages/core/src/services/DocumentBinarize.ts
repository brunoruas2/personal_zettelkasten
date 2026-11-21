// Binarização de foto de caderno (modo `document` da compressão de imagem).
// Puro: opera em buffers, sem canvas — o cliente passa os bytes do ImageData.
//
// Limiar adaptativo pela média local (imagem integral): um pixel vira preto se
// for mais escuro que `(1 - bias)` da média da vizinhança. Sombra e gradiente de
// iluminação mexem na média junto com o pixel, então o papel sai branco e o
// traço preto sem uma etapa separada de normalização do fundo.

export interface BinarizeOptions {
  /** Raio da janela, em px. Padrão: ~1/32 do lado menor (mín. 8). */
  radius?: number
  /** Quanto abaixo da média local um pixel precisa estar para virar traço. */
  bias?: number
}

/** RGBA → luminância (Rec. 601), um byte por pixel. */
export function rgbaToGray(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint8Array {
  const n = width * height
  const gray = new Uint8Array(n)
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    gray[i] = (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000
  }
  return gray
}

/** Devolve 0 (traço) ou 255 (papel) por pixel. */
export function binarizeAdaptive(
  gray: Uint8Array,
  width: number,
  height: number,
  options: BinarizeOptions = {},
): Uint8Array {
  const radius = options.radius ?? Math.max(8, Math.round(Math.min(width, height) / 32))
  const bias = options.bias ?? 0.12

  // Imagem integral com borda de 1: sums[(y+1)*(w+1) + (x+1)]. Uint32 basta:
  // 255 × 4 M px = ~1,0 G < 4,29 G.
  const stride = width + 1
  const sums = new Uint32Array(stride * (height + 1))
  for (let y = 0; y < height; y++) {
    let row = 0
    for (let x = 0; x < width; x++) {
      row += gray[y * width + x]
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + row
    }
  }

  const out = new Uint8Array(width * height)
  const keep = 1 - bias
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius)
    const y1 = Math.min(height - 1, y + radius)
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius)
      const x1 = Math.min(width - 1, x + radius)
      const area = (x1 - x0 + 1) * (y1 - y0 + 1)
      const sum =
        sums[(y1 + 1) * stride + x1 + 1] -
        sums[y0 * stride + x1 + 1] -
        sums[(y1 + 1) * stride + x0] +
        sums[y0 * stride + x0]
      out[y * width + x] = gray[y * width + x] * area < sum * keep ? 0 : 255
    }
  }
  return out
}

/** Escreve o resultado binário de volta num buffer RGBA (alfa 255). */
export function binaryToRgba(bin: Uint8Array, rgba: Uint8ClampedArray | Uint8Array): void {
  for (let i = 0, p = 0; i < bin.length; i++, p += 4) {
    rgba[p] = rgba[p + 1] = rgba[p + 2] = bin[i]
    rgba[p + 3] = 255
  }
}

/** Gray de uma imagem RGBA já binarizada → fração de pixels de traço (para testes/diagnóstico). */
export function inkFraction(bin: Uint8Array): number {
  let ink = 0
  for (let i = 0; i < bin.length; i++) if (bin[i] === 0) ink++
  return bin.length === 0 ? 0 : ink / bin.length
}
