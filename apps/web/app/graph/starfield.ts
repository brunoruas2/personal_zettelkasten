/**
 * Campo de estrelas do mapa de conexões.
 *
 * Tudo que depende só do índice da estrela (posição base, brilho, raio, camada
 * de parallax, frequência e fase do twinkle) é calculado uma única vez em
 * `buildStars`. O laço de desenho passa a fazer só a aritmética que depende de
 * tempo e de pan — antes as constantes eram recalculadas 200 vezes por frame.
 */

const TAU = Math.PI * 2;

/** Velocidade de parallax de cada camada de profundidade (0 = longe, 2 = perto). */
const PARALLAX_BY_DEPTH = [0.03, 0.07, 0.13];

export interface Star {
  /** Posição base normalizada [0,1), multiplicada pela largura/altura no desenho. */
  baseX: number;
  baseY: number;
  parallax: number;
  radius: number;
  /** Opacidade antes de aplicar o twinkle. */
  baseAlpha: number;
  twinkleFreq: number;
  twinklePhase: number;
}

export function buildStars(count = 200): Star[] {
  const stars: Star[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const brightness = ((i * 3571) % 100) / 100;
    stars[i] = {
      baseX: ((42 * (i + 1) * 9301 + 49297) % 233280) / 233280,
      baseY: ((42 * (i + 1) * 7919 + 12345) % 233280) / 233280,
      parallax: PARALLAX_BY_DEPTH[i % 3],
      radius: 0.4 + brightness * 0.9,
      baseAlpha: 0.04 + brightness * 0.14,
      twinkleFreq: 0.4 + (i % 7) * 0.25,
      twinklePhase: i * 2.399,
    };
  }
  return stars;
}

/**
 * Desenha o campo de estrelas em coordenadas de tela (não passa pelo
 * translate/scale do grafo — o parallax é aplicado à mão).
 *
 * A opacidade vai em `globalAlpha` em vez de uma string `rgba()` por estrela:
 * mesmo resultado de composição, sem montar e parsear 200 strings por desenho.
 */
export function drawStarfield(
  ctx: CanvasRenderingContext2D,
  stars: Star[],
  w: number,
  h: number,
  tx: number,
  ty: number,
  timeMs: number,
): void {
  const t = timeMs * 0.001;
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i];
    const sx = ((s.baseX * w + tx * s.parallax) % w + w) % w;
    const sy = ((s.baseY * h + ty * s.parallax) % h + h) % h;
    const twinkle = 0.55 + 0.45 * Math.sin(t * s.twinkleFreq + s.twinklePhase);
    ctx.globalAlpha = s.baseAlpha * twinkle;
    ctx.beginPath();
    ctx.arc(sx, sy, s.radius, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
