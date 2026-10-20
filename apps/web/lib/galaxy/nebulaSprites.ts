/**
 * Sprites da névoa de cluster do mapa de conexões.
 *
 * O gradiente radial de cada cor é rasterizado uma única vez num canvas
 * offscreen; o frame só faz `drawImage`. Antes cada nó com névoa alocava um
 * `CanvasGradient` novo e pintava um `arc(r=80)` por frame — e como
 * `buildNebulaMap` propaga a cor por todo o componente conexo, na prática isso
 * acontecia para quase todos os nós.
 *
 * O resultado visual é o mesmo: os color stops são idênticos aos usados antes,
 * e `drawImage` compõe com `source-over` como o `fill` compunha — inclusive no
 * acúmulo de opacidade entre névoas sobrepostas.
 */

/** Raio da névoa em coordenadas do mundo — o mesmo usado antes desta mudança. */
export const NEBULA_WORLD_RADIUS = 80;

/**
 * Resolução do sprite. Sobredimensionado em relação ao diâmetro de 160 unidades
 * de mundo para aguentar o zoom máximo (5×) sem borrar visivelmente.
 */
const SPRITE_PX = 256;

const cache = new Map<string, HTMLCanvasElement>();

export function getNebulaSprite(color: string): HTMLCanvasElement | null {
  const cached = cache.get(color);
  if (cached) return cached;
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = SPRITE_PX;
  canvas.height = SPRITE_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const c = SPRITE_PX / 2;
  const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
  gradient.addColorStop(0, color + '26'); // ~15% de opacidade no centro
  gradient.addColorStop(1, color + '00'); // transparente na borda
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, SPRITE_PX, SPRITE_PX);

  cache.set(color, canvas);
  return canvas;
}
