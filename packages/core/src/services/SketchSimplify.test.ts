import { describe, expect, it } from 'vitest';
import type { SketchPoint } from '../models/Sketch';
import { simplifyStroke } from './SketchSimplify';

function distToSegment(p: SketchPoint, a: SketchPoint, b: SketchPoint): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
}

function distToPolyline(p: SketchPoint, line: SketchPoint[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) best = Math.min(best, distToSegment(p, line[i - 1], line[i]));
  return best;
}

describe('simplifyStroke', () => {
  it('reduz uma reta lenta de 300 pontos a menos de 10%', () => {
    const pts: SketchPoint[] = Array.from({ length: 300 }, (_, i) => [i * 0.5, i * 0.25, 0.6]);
    const out = simplifyStroke(pts, 0.75);
    expect(out.length).toBeLessThan(30);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1]);
  });

  it('preserva a forma de um círculo dentro da tolerância', () => {
    const r = 100;
    const pts: SketchPoint[] = Array.from({ length: 800 }, (_, i) => {
      const a = (i / 799) * Math.PI * 2;
      return [r * Math.cos(a), r * Math.sin(a), 0.5 + 0.001 * (i % 2)];
    });
    const tol = 0.75;
    const out = simplifyStroke(pts, tol);
    expect(out.length).toBeLessThan(pts.length / 4);
    for (const p of pts) expect(distToPolyline(p, out)).toBeLessThanOrEqual(tol + 1e-9);
  });

  it('mantém pontos para preservar uma rampa de pressão não linear em reta', () => {
    // Pressão sobe em curva (quadrática): a interpolação linear entre extremos erra muito no meio.
    const pts: SketchPoint[] = Array.from({ length: 200 }, (_, i) => {
      const t = i / 199;
      return [i, 0, 0.2 + 0.7 * t * t];
    });
    const out = simplifyStroke(pts, 0.75);
    expect(out.length).toBeGreaterThan(2);
    // Toda pressão descartada fica a ≤ 0,05 da interpolada entre os vizinhos mantidos.
    let k = 0;
    for (const p of pts) {
      while (k < out.length - 2 && out[k + 1][0] < p[0]) k++;
      const a = out[k];
      const b = out[k + 1];
      const t = (p[0] - a[0]) / (b[0] - a[0]);
      expect(Math.abs(a[2] + t * (b[2] - a[2]) - p[2])).toBeLessThanOrEqual(0.05 + 1e-9);
    }
  });

  it('pressão linear em reta reduz aos extremos', () => {
    const pts: SketchPoint[] = Array.from({ length: 100 }, (_, i) => [i, 0, 0.2 + (0.7 * i) / 99]);
    expect(simplifyStroke(pts, 0.75)).toHaveLength(2);
  });

  it('não mexe em traço de 0, 1 ou 2 pontos', () => {
    expect(simplifyStroke([], 1)).toEqual([]);
    expect(simplifyStroke([[1, 2, 0.5]], 1)).toEqual([[1, 2, 0.5]]);
    expect(simplifyStroke([[1, 2, 0.5], [1, 2.1, 0.5]], 1)).toEqual([[1, 2, 0.5], [1, 2.1, 0.5]]);
  });

  it('não muta a entrada e devolve pontos novos', () => {
    const pts: SketchPoint[] = Array.from({ length: 50 }, (_, i) => [i, 0, 0.5]);
    const copy = pts.map((p) => [...p]);
    const out = simplifyStroke(pts, 0.75);
    expect(pts).toEqual(copy);
    expect(out[0]).not.toBe(pts[0]);
  });

  it('pontos repetidos (segmento degenerado) não geram NaN', () => {
    const pts: SketchPoint[] = [[5, 5, 0.5], [5, 5, 0.5], [6, 7, 0.5], [5, 5, 0.5]];
    const out = simplifyStroke(pts, 0.75);
    for (const p of out) for (const v of p) expect(Number.isFinite(v)).toBe(true);
    expect(out[0]).toEqual([5, 5, 0.5]);
    expect(out[out.length - 1]).toEqual([5, 5, 0.5]);
    expect(out).toContainEqual([6, 7, 0.5]);
  });

  it('aguenta 4 000 pontos em zigue-zague sem estourar a pilha', () => {
    const pts: SketchPoint[] = Array.from({ length: 4000 }, (_, i) => [i, i % 2 === 0 ? 0 : 5, 0.5]);
    const out = simplifyStroke(pts, 0.75);
    expect(out).toHaveLength(4000);
  });

  it('tolerância menor mantém mais pontos (zoom maior)', () => {
    const pts: SketchPoint[] = Array.from({ length: 400 }, (_, i) => {
      const a = (i / 399) * Math.PI;
      return [50 * Math.cos(a), 50 * Math.sin(a), 0.5];
    });
    expect(simplifyStroke(pts, 0.75 / 4).length).toBeGreaterThan(simplifyStroke(pts, 0.75).length);
  });
});
