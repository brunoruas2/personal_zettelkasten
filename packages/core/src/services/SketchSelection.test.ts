import { describe, expect, it } from 'vitest';
import type { Stroke } from '../models/Sketch';
import {
  duplicateStrokes,
  normalizeRect,
  recolorStrokes,
  resizeStrokes,
  selectionBounds,
  strokeAtPoint,
  strokeIntersectsRect,
  strokesInRect,
  translateStrokes,
} from './SketchSelection';
import { SketchHistory } from './SketchHistory';

const stroke = (id: string, points: [number, number, number?][], size = 4, color = '#1e1e1e'): Stroke => ({
  id,
  tool: 'pen',
  color,
  size,
  points: points.map(([x, y, p]) => [x, y, p ?? 0.5]),
});

const rect = (minX: number, minY: number, maxX: number, maxY: number) => ({ minX, minY, maxX, maxY });

describe('normalizeRect', () => {
  it('ordena os cantos em qualquer ordem', () => {
    expect(normalizeRect({ x: 100, y: 80 }, { x: 10, y: 20 })).toEqual(rect(10, 20, 100, 80));
    expect(normalizeRect({ x: 10, y: 80 }, { x: 100, y: 20 })).toEqual(rect(10, 20, 100, 80));
  });
});

describe('strokeIntersectsRect', () => {
  const line = stroke('a', [[0, 0], [1000, 0]]);

  it('o retângulo cobre só o meio de uma linha longa: atinge sem conter', () => {
    expect(strokeIntersectsRect(line, rect(400, -20, 600, 20))).toBe(true);
  });

  it('o retângulo fica entre dois pontos distantes de um segmento que passa por ele', () => {
    // nenhum dos dois pontos (0,0) e (1000,0) está dentro; só o segmento cruza
    const r = rect(300, -5, 700, 5);
    expect(line.points.some(([x, y]) => x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY)).toBe(false);
    expect(strokeIntersectsRect(line, r)).toBe(true);
  });

  it('segmento diagonal que atravessa o retângulo sem tocar um canto', () => {
    const diag = stroke('d', [[0, 0], [100, 100]]);
    expect(strokeIntersectsRect(diag, rect(40, 40, 60, 60))).toBe(true);
    expect(strokeIntersectsRect(diag, rect(60, 0, 100, 30))).toBe(false); // longe da diagonal
  });

  it('retângulo longe não atinge', () => {
    expect(strokeIntersectsRect(line, rect(400, 100, 600, 200))).toBe(false);
    expect(strokeIntersectsRect(line, rect(2000, -10, 3000, 10))).toBe(false);
  });

  it('a meia espessura de folga conta', () => {
    const thick = stroke('t', [[0, 0], [100, 0]], 20);
    expect(strokeIntersectsRect(thick, rect(40, 8, 60, 30))).toBe(true); // 8 < 10 (meia espessura)
    expect(strokeIntersectsRect(thick, rect(40, 12, 60, 30))).toBe(false);
  });

  it('traço de um único ponto é um disco', () => {
    const dot = stroke('p', [[50, 50]], 10);
    expect(strokeIntersectsRect(dot, rect(40, 40, 60, 60))).toBe(true);
    expect(strokeIntersectsRect(dot, rect(52, 52, 80, 80))).toBe(true); // dentro da folga de 5
    expect(strokeIntersectsRect(dot, rect(100, 100, 120, 120))).toBe(false);
  });

  it('traço sem pontos nunca é atingido', () => {
    expect(strokeIntersectsRect({ ...line, points: [] }, rect(-1e6, -1e6, 1e6, 1e6))).toBe(false);
  });
});

describe('strokesInRect', () => {
  it('devolve os ids atingidos na ordem de pintura', () => {
    const a = stroke('a', [[0, 0], [100, 0]]);
    const b = stroke('b', [[0, 200], [100, 200]]);
    const c = stroke('c', [[50, -50], [50, 50]]);
    expect(strokesInRect([a, b, c], rect(40, -10, 60, 10))).toEqual(['a', 'c']);
    expect(strokesInRect([a, b, c], rect(500, 500, 600, 600))).toEqual([]);
  });
});

describe('strokeAtPoint', () => {
  it('devolve o traço mais ao topo quando dois se sobrepõem', () => {
    const under = stroke('under', [[0, 0], [100, 0]]);
    const over = stroke('over', [[50, -50], [50, 50]]);
    expect(strokeAtPoint([under, over], { x: 50, y: 0 }, 6)?.id).toBe('over');
    expect(strokeAtPoint([over, under], { x: 50, y: 0 }, 6)?.id).toBe('under');
  });

  it('devolve null no vazio', () => {
    expect(strokeAtPoint([stroke('a', [[0, 0], [10, 0]])], { x: 500, y: 500 }, 6)).toBeNull();
    expect(strokeAtPoint([], { x: 0, y: 0 }, 6)).toBeNull();
  });
});

describe('selectionBounds', () => {
  const a = stroke('a', [[0, 0]], 4);
  const b = stroke('b', [[100, 50]], 4);
  const c = stroke('c', [[900, 900]], 4);

  it('cobre só os traços selecionados', () => {
    expect(selectionBounds([a, b, c], ['a', 'b'])).toEqual({ minX: -2, minY: -2, maxX: 102, maxY: 52 });
    expect(selectionBounds([a, b, c], new Set(['c']))).toEqual({ minX: 898, minY: 898, maxX: 902, maxY: 902 });
  });

  it('seleção vazia, ou só de ids inexistentes, não tem bounds', () => {
    expect(selectionBounds([a, b], [])).toBeNull();
    expect(selectionBounds([a, b], ['zzz'])).toBeNull();
  });
});

describe('transformações', () => {
  const original = stroke('a', [[1.04, 2.06, 0.31], [10.15, 20.25, 0.92]], 6, '#2f9e44');

  it('translateStrokes não muta, mantém id e pressão, e arredonda a 1 casa', () => {
    const snapshot = JSON.stringify(original);
    const [moved] = translateStrokes([original], 100.123456, -50.987654);
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(moved).not.toBe(original);
    expect(moved.id).toBe('a');
    expect(moved.color).toBe('#2f9e44');
    expect(moved.size).toBe(6);
    expect(moved.points).toEqual([[101.2, -48.9, 0.31], [110.3, -30.7, 0.92]]);
    for (const [x, y] of moved.points) {
      expect(Math.round(x * 10) / 10).toBe(x);
      expect(Math.round(y * 10) / 10).toBe(y);
    }
  });

  it('recolorStrokes troca a cor e mantém id, pontos e pressão', () => {
    const b = stroke('b', [[5, 5, 0.7]]);
    const out = recolorStrokes([original, b], '#e03131');
    expect(out.map((s) => s.color)).toEqual(['#e03131', '#e03131']);
    expect(out.map((s) => s.id)).toEqual(['a', 'b']);
    expect(out[0].points).toEqual(original.points);
    expect(original.color).toBe('#2f9e44');
  });

  it('resizeStrokes limita a espessura a (0, 64]', () => {
    expect(resizeStrokes([original], 8)[0].size).toBe(8);
    expect(resizeStrokes([original], 500)[0].size).toBe(64);
    expect(resizeStrokes([original], 0)[0].size).toBe(4);
    expect(resizeStrokes([original], -3)[0].size).toBe(4);
    expect(resizeStrokes([original], NaN)[0].size).toBe(4);
    expect(original.size).toBe(6);
  });

  it('duplicateStrokes dá ids novos, na mesma ordem, deslocadas e com pressão preservada', () => {
    const a2 = stroke('a', [[1, 2, 0.31], [10, 20, 0.92]], 6, '#2f9e44');
    const b = stroke('b', [[0, 0, 0.2]]);
    let n = 0;
    const copies = duplicateStrokes([a2, b], 16, 16, () => `n${++n}`);
    expect(copies.map((s) => s.id)).toEqual(['n1', 'n2']);
    expect(copies[0].points).toEqual([[17, 18, 0.31], [26, 36, 0.92]]);
    expect(copies[1].points).toEqual([[16, 16, 0.2]]);
    expect(copies[0].color).toBe('#2f9e44');
    expect(copies[0].size).toBe(6);
    // os originais seguem intactos
    expect(a2.id).toBe('a');
    expect(a2.points[0]).toEqual([1, 2, 0.31]);
  });
});

describe('SketchHistory.replace / addMany', () => {
  const s = (id: string, x = 0) => stroke(id, [[x, 0], [x + 1, 1]]);
  const ids = (h: SketchHistory) => h.strokes.map((x) => x.id);

  it('replace troca no mesmo lugar e desfazer devolve a posição original', () => {
    const [a, b, c] = [s('a'), s('b'), s('c')];
    const h = new SketchHistory([a, b, c]);
    const [movedB] = translateStrokes([b], 50, 0);
    expect(h.replace([b], [movedB])).toBe(true);
    expect(ids(h)).toEqual(['a', 'b', 'c']);
    expect(h.strokes[1]).toBe(movedB);
    h.undo();
    expect(ids(h)).toEqual(['a', 'b', 'c']);
    expect(h.strokes[1]).toBe(b);
  });

  it('replace desfeito e refeito fica com a versão nova, na mesma posição', () => {
    const [a, b] = [s('a'), s('b')];
    const h = new SketchHistory([a, b]);
    const [movedA] = translateStrokes([a], 9, 9);
    h.replace([a], [movedA]);
    h.undo();
    h.redo();
    expect(h.strokes[0]).toBe(movedA);
    expect(ids(h)).toEqual(['a', 'b']);
  });

  it('replace de vários traços é uma única operação', () => {
    const [a, b] = [s('a'), s('b')];
    const h = new SketchHistory([a, b]);
    h.replace([a, b], recolorStrokes([a, b], '#e03131'));
    expect(h.strokes.map((x) => x.color)).toEqual(['#e03131', '#e03131']);
    h.undo();
    expect(h.strokes.map((x) => x.color)).toEqual(['#1e1e1e', '#1e1e1e']);
    expect(h.canUndo).toBe(false);
  });

  it('replace continua certo depois de outra operação mexer nos índices', () => {
    const [a, b, c] = [s('a'), s('b'), s('c')];
    const h = new SketchHistory([a, b, c]);
    const [movedC] = translateStrokes([c], 5, 5);
    h.replace([c], [movedC]);
    h.erase([a]); // c passa do índice 2 para o 1
    h.undo(); // volta a
    h.undo(); // desfaz o replace
    expect(h.strokes[2]).toBe(c);
    expect(ids(h)).toEqual(['a', 'b', 'c']);
  });

  it('replace inválido não cria operação: id inexistente, ids trocados, tamanhos diferentes, vazio', () => {
    const [a, b] = [s('a'), s('b')];
    const h = new SketchHistory([a, b]);
    const v0 = h.version;
    expect(h.replace([s('zzz')], [s('zzz', 5)])).toBe(false);
    expect(h.replace([a], [b])).toBe(false);
    expect(h.replace([a, b], [a])).toBe(false);
    expect(h.replace([], [])).toBe(false);
    expect(h.canUndo).toBe(false);
    expect(h.version).toBe(v0);
    expect(ids(h)).toEqual(['a', 'b']);
  });

  it('addMany acrescenta vários e um desfazer remove todos; refazer traz na mesma ordem', () => {
    const h = new SketchHistory([s('a')]);
    expect(h.addMany([s('x'), s('y'), s('z')])).toBe(true);
    expect(ids(h)).toEqual(['a', 'x', 'y', 'z']);
    h.undo();
    expect(ids(h)).toEqual(['a']);
    h.redo();
    expect(ids(h)).toEqual(['a', 'x', 'y', 'z']);
  });

  it('addMany vazio não cria operação', () => {
    const h = new SketchHistory();
    expect(h.addMany([])).toBe(false);
    expect(h.canUndo).toBe(false);
  });

  it('operação nova depois de desfazer um replace esvazia o refazer, e o teto de 200 vale', () => {
    const a = s('a');
    const h = new SketchHistory([a]);
    h.replace([a], translateStrokes([a], 1, 1));
    h.undo();
    expect(h.canRedo).toBe(true);
    h.add(s('b'));
    expect(h.canRedo).toBe(false);

    const h2 = new SketchHistory([s('m')]);
    for (let i = 0; i < 250; i++) h2.replace([h2.strokes[0]], translateStrokes([h2.strokes[0]], 1, 0));
    let undone = 0;
    while (h2.undo()) undone++;
    expect(undone).toBe(200);
  });
});
