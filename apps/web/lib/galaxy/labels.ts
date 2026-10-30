/**
 * Centro horizontal de um rótulo, deslocado o mínimo para ele caber inteiro
 * no viewport (`half` = meia largura do texto com folga; `margin` = distância
 * mínima da borda). Rótulo mais largo que a tela começa na margem esquerda.
 */
export function clampLabelX(sx: number, half: number, w: number, margin: number): number {
  const min = margin + half;
  const max = w - margin - half;
  if (max < min) return min;
  return Math.min(max, Math.max(min, sx));
}
