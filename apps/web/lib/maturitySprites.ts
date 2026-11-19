/**
 * Manchas (nebulosas) do Mapa com granulação de maturidade. De longe, um zettel
 * com nível tem a mancha esparsa (níveis iniciais) ou sólida (último nível);
 * a cor segue sendo a do cluster. Um sprite por (cor, faixa), pré-renderizado
 * e em cache: desenhar custa um `drawImage`, o mesmo que o gradiente de antes.
 * O padrão de pontos vem de um gerador com semente fixa, então não cintila
 * entre quadros nem entre cores.
 */

/** Faixas de granulação: 0 = esparsa … BUCKETS − 1 = sólida (o gradiente de sempre). */
export const MATURITY_BUCKETS = 4;
/** Diâmetro da mancha em px de tela (raio 120, como o gradiente original). */
export const SPRITE_SIZE = 240;
const SCALE = 2; // renderiza a 2x para não borrar em tela de alta densidade
const CACHE_MAX = 128;
/** Pontos por faixa; a última (sólida) não tem pontos. */
const DOTS = [34, 90, 190];

const cache = new Map<string, HTMLCanvasElement>();

/** `#rrggbb` + alfa → `rgba()`. Cores fora desse formato passam como estão. */
export function hexAlpha(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Gerador pseudoaleatório com semente (mulberry32): mesmo padrão sempre. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function render(color: string, bucket: number): HTMLCanvasElement {
  const px = SPRITE_SIZE * SCALE;
  const c = document.createElement('canvas');
  c.width = px;
  c.height = px;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const R = px / 2;
  const solid = bucket >= MATURITY_BUCKETS - 1;
  // Base: o gradiente de antes (alfa .22). Abaixo da última faixa fica só um véu.
  const g = ctx.createRadialGradient(R, R, 0, R, R, R);
  g.addColorStop(0, hexAlpha(color, solid ? 0.22 : 0.05));
  g.addColorStop(1, hexAlpha(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, px, px);
  if (solid) return c;

  const rand = rng(0x9e3779b9 + bucket * 7919);
  ctx.fillStyle = hexAlpha(color, 0.7);
  for (let i = 0; i < DOTS[Math.min(bucket, DOTS.length - 1)]; i++) {
    // Mais perto do centro que da borda, como a mancha cheia.
    const r = R * 0.92 * Math.pow(rand(), 0.7);
    const a = rand() * Math.PI * 2;
    const size = (1.1 + rand() * 1.4) * SCALE;
    ctx.beginPath();
    ctx.arc(R + Math.cos(a) * r, R + Math.sin(a) * r, size, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

/**
 * Sprite da mancha para a cor e a faixa. Cache de módulo com teto: passando de
 * `CACHE_MAX` entradas, descarta as mais antigas.
 */
export function nebulaSprite(color: string, bucket: number): HTMLCanvasElement {
  const b = Math.min(MATURITY_BUCKETS - 1, Math.max(0, bucket));
  const key = `${color}|${b}`;
  let s = cache.get(key);
  if (!s) {
    s = render(color, b);
    cache.set(key, s);
    if (cache.size > CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  }
  return s;
}

/** Para testes e troca de tema: esvazia o cache. */
export function clearNebulaSprites(): void {
  cache.clear();
}
