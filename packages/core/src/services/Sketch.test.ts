import { describe, expect, it } from 'vitest';
import type { Stroke } from '../models/Sketch';
import { MAX_POINTS_PER_STROKE, MAX_STROKES } from '../models/Sketch';
import { emptyScene, parseSketchScene, serializeSketchScene } from './SketchScene';
import {
  eraseAt,
  fitViewport,
  hitTestStroke,
  sceneBounds,
  screenToWorld,
  strokeBounds,
  worldToScreen,
  zoomAt,
} from './SketchGeometry';
import { MAX_HISTORY, SketchHistory } from './SketchHistory';
import { outlineToSvgPath } from './SketchPath';

const stroke = (id: string, points: [number, number, number?][], size = 4, color = '#1e1e1e'): Stroke => ({
  id,
  tool: 'pen',
  color,
  size,
  points: points.map(([x, y, p]) => [x, y, p ?? 0.5]),
});

const sceneJson = (strokes: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'zk-sketch', version: 1, strokes, ...extra });

describe('parseSketchScene', () => {
  it('aceita uma cena mínima', () => {
    const r = parseSketchScene(sceneJson([{ id: 'a', tool: 'pen', color: '#e03131', size: 4, points: [[1, 2, 0.5], [3, 4, 0.6]] }]));
    expect(r.kind).toBe('scene');
    if (r.kind === 'scene') {
      expect(r.scene.strokes).toHaveLength(1);
      expect(r.scene.strokes[0].points).toEqual([[1, 2, 0.5], [3, 4, 0.6]]);
    }
  });

  it('devolve erro para JSON inválido', () => {
    expect(parseSketchScene('nope')).toEqual({ kind: 'error', reason: 'invalid-json' });
    expect(parseSketchScene('null')).toEqual({ kind: 'error', reason: 'invalid-json' });
  });

  it('rejeita versão futura em vez de interpretar', () => {
    expect(parseSketchScene(JSON.stringify({ type: 'zk-sketch', version: 2, strokes: [] }))).toEqual({
      kind: 'error',
      reason: 'future-version',
    });
  });

  it('rejeita versão ausente, tipo desconhecido e strokes que não é array', () => {
    expect(parseSketchScene(JSON.stringify({ type: 'zk-sketch', strokes: [] })).kind).toBe('error');
    expect(parseSketchScene(JSON.stringify({ type: 'outro', version: 1, strokes: [] }))).toEqual({
      kind: 'error',
      reason: 'unknown-type',
    });
    expect(parseSketchScene(JSON.stringify({ type: 'zk-sketch', version: 1, strokes: {} }))).toEqual({
      kind: 'error',
      reason: 'bad-strokes',
    });
  });

  it('reconhece cena legada do Excalidraw sem interpretá-la', () => {
    expect(parseSketchScene(JSON.stringify({ type: 'excalidraw', version: 2, elements: [{ id: 'x' }] }))).toEqual({
      kind: 'legacy',
    });
  });

  it('descarta ponto com NaN/Infinity/fora de faixa e limita pressão e cor', () => {
    const r = parseSketchScene(
      '{"type":"zk-sketch","version":1,"strokes":[{"id":"a","tool":"pen","color":"red","size":4,"points":[[1,2,3],[null,2,0.5],[5000000,0,0.5],[7,8,-1],[9,10]]}]}',
    );
    expect(r.kind).toBe('scene');
    if (r.kind !== 'scene') return;
    const s = r.scene.strokes[0];
    expect(s.color).toBe('#1e1e1e');
    // [1,2,3] -> pressão 1; [null..] e [5e6..] descartados; [7,8,-1] -> 0; [9,10] -> 0.5
    expect(s.points).toEqual([[1, 2, 1], [7, 8, 0], [9, 10, 0.5]]);
  });

  it('limita espessura e usa o padrão quando inválida', () => {
    const mk = (size: unknown) =>
      parseSketchScene(sceneJson([{ id: 'a', tool: 'pen', color: '#000000', size, points: [[0, 0, 0.5]] }]));
    const get = (r: ReturnType<typeof mk>) => (r.kind === 'scene' ? r.scene.strokes[0].size : -1);
    expect(get(mk(500))).toBe(64);
    expect(get(mk(0))).toBe(4);
    expect(get(mk(-3))).toBe(4);
    expect(get(mk('x'))).toBe(4);
  });

  it('descarta traço sem pontos válidos e traço com tool desconhecida', () => {
    const r = parseSketchScene(
      sceneJson([
        { id: 'a', tool: 'pen', color: '#000000', size: 4, points: [] },
        { id: 'b', tool: 'brush', color: '#000000', size: 4, points: [[0, 0, 0.5]] },
        { id: 'c', tool: 'pen', color: '#000000', size: 4, points: [[0, 0, 0.5]] },
      ]),
    );
    expect(r.kind === 'scene' && r.scene.strokes.map((s) => s.id)).toEqual(['c']);
  });

  it('aplica os limites de traços e de pontos', () => {
    const many = Array.from({ length: MAX_STROKES + 5 }, (_, i) => ({
      id: `s${i}`, tool: 'pen', color: '#000000', size: 4, points: [[i % 100, 0, 0.5]],
    }));
    const r1 = parseSketchScene(sceneJson(many));
    expect(r1.kind === 'scene' && r1.scene.strokes.length).toBe(MAX_STROKES);

    const longPts = Array.from({ length: MAX_POINTS_PER_STROKE + 10 }, (_, i) => [i % 1000, 0, 0.5]);
    const r2 = parseSketchScene(sceneJson([{ id: 'a', tool: 'pen', color: '#000000', size: 4, points: longPts }]));
    expect(r2.kind === 'scene' && r2.scene.strokes[0].points.length).toBe(MAX_POINTS_PER_STROKE);
  });

  it('arredonda coordenadas a 1 casa e pressão a 2', () => {
    const r = parseSketchScene(sceneJson([{ id: 'a', tool: 'pen', color: '#000000', size: 4, points: [[1.2345, 9.8765, 0.12345]] }]));
    expect(r.kind === 'scene' && r.scene.strokes[0].points[0]).toEqual([1.2, 9.9, 0.12]);
  });

  it('ida e volta: serialize → parse preserva a cena', () => {
    const scene = emptyScene();
    scene.strokes.push(stroke('a', [[1.5, 2.5, 0.3], [3.5, 4.5, 0.9]], 8, '#2f9e44'));
    const r = parseSketchScene(serializeSketchScene(scene));
    expect(r).toEqual({ kind: 'scene', scene });
  });
});

describe('bounds e viewport', () => {
  it('bounding box do traço inclui meia espessura', () => {
    expect(strokeBounds(stroke('a', [[0, 0], [100, 50]], 4))).toEqual({ minX: -2, minY: -2, maxX: 102, maxY: 52 });
  });

  it('bounding box da cena cobre todos os traços; vazia não tem', () => {
    const b = sceneBounds([stroke('a', [[0, 0]], 4), stroke('b', [[100, 50]], 4)]);
    expect(b).toEqual({ minX: -2, minY: -2, maxX: 102, maxY: 52 });
    expect(sceneBounds([])).toBeNull();
    expect(sceneBounds(emptyScene())).toBeNull();
  });

  it('screenToWorld e worldToScreen são inversas', () => {
    for (const vp of [{ scale: 1, tx: 0, ty: 0 }, { scale: 2.5, tx: -30, ty: 17 }, { scale: 0.25, tx: 400, ty: -90 }]) {
      const p = { x: 123.4, y: -56.7 };
      const back = screenToWorld(vp, worldToScreen(vp, p));
      expect(back.x).toBeCloseTo(p.x, 9);
      expect(back.y).toBeCloseTo(p.y, 9);
    }
  });

  it('zoomAt mantém o ponto sob o ponteiro no mesmo lugar', () => {
    const vp = { scale: 1.3, tx: 20, ty: -40 };
    const anchor = { x: 310, y: 205 };
    const before = screenToWorld(vp, anchor);
    const next = zoomAt(vp, 1.7, anchor);
    const after = screenToWorld(next, anchor);
    expect(next.scale).toBeCloseTo(1.3 * 1.7, 9);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('zoomAt respeita os limites 0,25–8', () => {
    const anchor = { x: 0, y: 0 };
    expect(zoomAt({ scale: 7, tx: 0, ty: 0 }, 10, anchor).scale).toBe(8);
    expect(zoomAt({ scale: 0.3, tx: 0, ty: 0 }, 0.01, anchor).scale).toBe(0.25);
  });
});

describe('fitViewport', () => {
  const size = { width: 1000, height: 500 };

  it('desenho grande: cabe inteiro, com margem, e fica centralizado', () => {
    const b = { minX: 0, minY: 0, maxX: 2000, maxY: 1000 };
    const vp = fitViewport(b, size, 20);
    expect(vp.scale).toBeCloseTo(0.46, 9); // limitado pela altura: (500 - 40) / 1000
    const tl = worldToScreen(vp, { x: b.minX, y: b.minY });
    const br = worldToScreen(vp, { x: b.maxX, y: b.maxY });
    expect(tl.x).toBeGreaterThanOrEqual(20 - 1e-9);
    expect(tl.y).toBeGreaterThanOrEqual(20 - 1e-9);
    expect(br.x).toBeLessThanOrEqual(1000 - 20 + 1e-9);
    expect(br.y).toBeLessThanOrEqual(500 - 20 + 1e-9);
    // centralizado: as folgas dos dois lados são iguais
    expect(tl.x).toBeCloseTo(1000 - br.x, 9);
    expect(tl.y).toBeCloseTo(500 - br.y, 9);
  });

  it('desenho pequeno: o zoom para em 800% e o desenho fica no centro', () => {
    const b = { minX: 100, minY: 100, maxX: 110, maxY: 110 };
    const vp = fitViewport(b, { width: 1000, height: 1000 }, 20);
    expect(vp.scale).toBe(8);
    const c = worldToScreen(vp, { x: 105, y: 105 });
    expect(c.x).toBeCloseTo(500, 9);
    expect(c.y).toBeCloseTo(500, 9);
  });

  it('desenho enorme: o zoom para em 25%', () => {
    const vp = fitViewport({ minX: 0, minY: 0, maxX: 100000, maxY: 100000 }, size, 20);
    expect(vp.scale).toBe(0.25);
  });

  it('cena vazia ou área sem tamanho: 100% na origem', () => {
    expect(fitViewport(null, size, 20)).toEqual({ scale: 1, tx: 0, ty: 0 });
    expect(fitViewport({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, { width: 0, height: 0 }, 20)).toEqual({
      scale: 1,
      tx: 0,
      ty: 0,
    });
  });

  it('margem maior que a área não quebra (escala positiva)', () => {
    const vp = fitViewport({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, { width: 30, height: 30 }, 50);
    expect(vp.scale).toBeGreaterThan(0);
    expect(Number.isFinite(vp.tx)).toBe(true);
  });
});

describe('borracha', () => {
  const line = stroke('a', [[0, 0], [100, 0]], 4);

  it('acerta o traço a 3 px com raio 6', () => {
    expect(hitTestStroke(line, { x: 50, y: 3 }, 6)).toBe(true);
    expect(eraseAt([line], { x: 50, y: 3 }, 6).map((s) => s.id)).toEqual(['a']);
  });

  it('erra o traço a 50 px', () => {
    expect(hitTestStroke(line, { x: 50, y: 50 }, 6)).toBe(false);
    expect(eraseAt([line], { x: 50, y: 50 }, 6)).toEqual([]);
  });

  it('considera os extremos do segmento, não a reta infinita', () => {
    expect(hitTestStroke(line, { x: 150, y: 0 }, 6)).toBe(false);
    expect(hitTestStroke(line, { x: 104, y: 0 }, 6)).toBe(true);
  });

  it('traço de um único ponto é um disco', () => {
    const dot = stroke('d', [[10, 10]], 8);
    expect(hitTestStroke(dot, { x: 14, y: 10 }, 2)).toBe(true);
    expect(hitTestStroke(dot, { x: 30, y: 10 }, 2)).toBe(false);
  });

  it('devolve só os traços atingidos', () => {
    const far = stroke('far', [[0, 200], [100, 200]]);
    expect(eraseAt([line, far], { x: 50, y: 0 }, 4).map((s) => s.id)).toEqual(['a']);
  });
});

describe('SketchHistory', () => {
  const s = (id: string) => stroke(id, [[0, 0], [1, 1]]);
  const ids = (h: SketchHistory) => h.strokes.map((x) => x.id);

  it('desfaz e refaz um traço na mesma posição da ordem de pintura', () => {
    const h = new SketchHistory();
    h.add(s('a'));
    h.add(s('b'));
    expect(h.undo()).toBe(true);
    expect(ids(h)).toEqual(['a']);
    expect(h.redo()).toBe(true);
    expect(ids(h)).toEqual(['a', 'b']);
  });

  it('operação nova esvazia o refazer', () => {
    const h = new SketchHistory();
    h.add(s('a'));
    h.undo();
    expect(h.canRedo).toBe(true);
    h.add(s('b'));
    expect(h.canRedo).toBe(false);
    expect(h.redo()).toBe(false);
  });

  it('uma passada de borracha é uma única operação e desfazer devolve na ordem original', () => {
    const h = new SketchHistory();
    ['a', 'b', 'c', 'd'].forEach((id) => h.add(s(id)));
    h.erase([s('b'), s('d'), s('a')]);
    expect(ids(h)).toEqual(['c']);
    h.undo();
    expect(ids(h)).toEqual(['a', 'b', 'c', 'd']);
    h.redo();
    expect(ids(h)).toEqual(['c']);
  });

  it('apagar traço que não existe não cria operação', () => {
    const h = new SketchHistory([s('a')]);
    expect(h.erase([s('zzz')])).toBe(false);
    expect(h.canUndo).toBe(false);
  });

  it('limpar é desfazível e não faz nada na cena vazia', () => {
    const h = new SketchHistory();
    expect(h.clear()).toBe(false);
    h.add(s('a'));
    h.add(s('b'));
    expect(h.clear()).toBe(true);
    expect(ids(h)).toEqual([]);
    h.undo();
    expect(ids(h)).toEqual(['a', 'b']);
  });

  it('mantém só as últimas 200 operações', () => {
    const h = new SketchHistory();
    for (let i = 0; i < 250; i++) h.add(s(`s${i}`));
    let undone = 0;
    while (h.undo()) undone++;
    expect(undone).toBe(MAX_HISTORY);
    expect(h.strokes).toHaveLength(50);
  });

  it('version sobe a cada mudança, inclusive desfazer e refazer', () => {
    const h = new SketchHistory();
    const v0 = h.version;
    h.add(s('a'));
    h.undo();
    h.redo();
    expect(h.version).toBe(v0 + 3);
  });

  it('começa com os traços iniciais sem histórico', () => {
    const h = new SketchHistory([s('a')]);
    expect(ids(h)).toEqual(['a']);
    expect(h.canUndo).toBe(false);
  });
});

describe('outlineToSvgPath', () => {
  it('outline de 4 pontos: começa em M, tem Q e termina em Z', () => {
    const d = outlineToSvgPath([[0, 0], [10, 0], [10, 10], [0, 10]]);
    expect(d.startsWith('M0.00,0.00')).toBe(true);
    expect(d).toContain('Q');
    expect(d.endsWith('Z')).toBe(true);
  });

  it('outline degenerado (0 ou 1 ponto) vira string vazia', () => {
    expect(outlineToSvgPath([])).toBe('');
    expect(outlineToSvgPath([[1, 1]])).toBe('');
  });

  it('2 e 3 pontos viram polígono reto', () => {
    expect(outlineToSvgPath([[0, 0], [5, 5]])).toBe('M0.00,0.00 L5.00,5.00 Z');
    expect(outlineToSvgPath([[0, 0], [5, 5], [0, 5]])).toBe('M0.00,0.00 L5.00,5.00 L0.00,5.00 Z');
  });
});
