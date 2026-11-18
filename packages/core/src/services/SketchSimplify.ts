import type { SketchPoint } from '../models/Sketch';

/** Desvio de pressão (0–1) acima do qual um ponto fica, mesmo colinear. */
export const DEFAULT_PRESSURE_TOLERANCE = 0.05;

/**
 * Reduz os pontos de um traço por Ramer–Douglas–Peucker em x/y. Um ponto também
 * fica quando sua pressão desvia mais de `pressureTolerance` da pressão interpolada
 * no segmento (pela projeção do ponto) — senão um trecho reto com variação de força
 * viraria espessura uniforme. Extremos sempre ficam; até 2 pontos devolve cópia.
 * Iterativo (pilha explícita): não estoura com traço de 4 000 pontos. Não muta a entrada.
 */
export function simplifyStroke(
  points: readonly SketchPoint[],
  tolerance: number,
  pressureTolerance = DEFAULT_PRESSURE_TOLERANCE,
): SketchPoint[] {
  const n = points.length;
  if (n <= 2) return points.map((p) => [p[0], p[1], p[2]] as SketchPoint);

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: number[] = [0, n - 1];

  while (stack.length > 0) {
    const last = stack.pop()!;
    const first = stack.pop()!;
    if (last - first < 2) continue;

    const [ax, ay, ap] = points[first];
    const [bx, by, bp] = points[last];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;

    let worst = -1;
    let worstScore = 0;
    for (let i = first + 1; i < last; i++) {
      const [px, py, pp] = points[i];
      // Projeção do ponto no segmento (t em [0, 1]); segmento degenerado = âncora inicial.
      let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const qx = ax + t * dx - px;
      const qy = ay + t * dy - py;
      const d = Math.sqrt(qx * qx + qy * qy);
      const dp = Math.abs(ap + t * (bp - ap) - pp);
      // Normaliza os dois critérios pela própria tolerância: > 1 em qualquer um = fica.
      const score = Math.max(ratio(d, tolerance), ratio(dp, pressureTolerance));
      if (score > worstScore) {
        worstScore = score;
        worst = i;
      }
    }

    if (worst !== -1 && worstScore > 1) {
      keep[worst] = 1;
      stack.push(first, worst, worst, last);
    }
  }

  const out: SketchPoint[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push([points[i][0], points[i][1], points[i][2]]);
  return out;
}

/** Desvio ÷ tolerância; tolerância ≤ 0 = qualquer desvio conta. */
function ratio(value: number, tolerance: number): number {
  if (tolerance > 0) return value / tolerance;
  return value > 0 ? Infinity : 0;
}
