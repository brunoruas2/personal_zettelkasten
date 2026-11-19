import { describe, expect, it } from 'vitest';
import type { ZettelType } from '../models/ZettelType';
import { levelBucket, levelFraction, summarizeLevels, trailLinkedIds, trailProgress, type AssignmentLike } from './Maturity';

const type = (id: string, slug: string, over: Partial<ZettelType> = {}): ZettelType => ({
  id,
  name: slug,
  slug,
  icon: '📘',
  color: '#a78bfa',
  template: '',
  protectedSections: [],
  levels: [],
  countsProgress: false,
  updatedAt: 1,
  ...over,
});

const conteudo = type('c', 'conteudo', {
  countsProgress: true,
  levels: [
    { key: 'semente', label: 'Semente', emoji: '🤖', userOnly: false },
    { key: 'testado', label: 'Testado', emoji: '💾', userOnly: false },
    { key: 'consolidado', label: 'Consolidado', emoji: '🧠', userOnly: true },
  ],
});
const fonte = type('f', 'fonte');
const pratica = type('p', 'pratica', { countsProgress: true });
const typeById = new Map([conteudo, fonte, pratica].map((t) => [t.id, t]));
const as = (o: Record<string, [string, string | null]>) =>
  new Map<string, AssignmentLike>(Object.entries(o).map(([id, [typeId, level]]) => [id, { typeId, level }]));

describe('levelFraction', () => {
  it('escada de três níveis: (posição + 1) / total', () => {
    expect(levelFraction(conteudo, 'semente')).toBeCloseTo(1 / 3);
    expect(levelFraction(conteudo, 'testado')).toBeCloseTo(2 / 3);
    expect(levelFraction(conteudo, 'consolidado')).toBe(1);
  });
  it('escada de um nível vale 1', () => {
    expect(levelFraction(type('x', 'x', { levels: [{ key: 'a', label: 'A', userOnly: false }] }), 'a')).toBe(1);
  });
  it('sem tipo, sem escada, sem nível ou nível removido: null', () => {
    expect(levelFraction(null, 'semente')).toBeNull();
    expect(levelFraction(undefined, 'semente')).toBeNull();
    expect(levelFraction(fonte, 'semente')).toBeNull();
    expect(levelFraction(conteudo, null)).toBeNull();
    expect(levelFraction(conteudo, 'beta')).toBeNull();
  });
});

describe('levelBucket', () => {
  it('divide (0, 1] em faixas de granulação', () => {
    expect([0.25, 1 / 3, 0.5, 2 / 3, 0.75, 1].map((f) => levelBucket(f, 4))).toEqual([0, 1, 1, 2, 2, 3]);
  });
  it('limites e faixa única', () => {
    expect(levelBucket(0.0001, 4)).toBe(0);
    expect(levelBucket(1, 4)).toBe(3);
    expect(levelBucket(0.7, 1)).toBe(0);
  });
});

describe('summarizeLevels', () => {
  const a = as({
    z1: ['c', 'semente'],
    z2: ['c', 'semente'],
    z3: ['c', 'testado'],
    z4: ['c', null],
    z5: ['f', null],
    z6: ['p', null],
  });

  it('só tipos que contam, nível na ordem da escada, com zeros', () => {
    const s = summarizeLevels(['z1', 'z2', 'z3', 'z4', 'z5', 'z6', 'z7'], a, typeById);
    expect(s.total).toBe(5);
    const g = s.groups.find((x) => x.type.slug === 'conteudo')!;
    expect(g.levels.map((l) => [l.key, l.count])).toEqual([['semente', 2], ['testado', 1], ['consolidado', 0]]);
    expect(g.noLevel).toBe(1);
    expect(g.total).toBe(4);
  });

  it('Fonte (não conta) e zettel sem tipo ficam de fora', () => {
    const s = summarizeLevels(['z5', 'z7'], a, typeById);
    expect(s.total).toBe(0);
    expect(s.groups).toEqual([]);
  });

  it('tipo que conta sem escada só tem total', () => {
    const s = summarizeLevels(['z6'], a, typeById);
    const g = s.groups[0];
    expect(g.type.slug).toBe('pratica');
    expect(g.levels).toEqual([]);
    expect(g.total).toBe(1);
    expect(g.noLevel).toBe(0);
  });

  it('nível removido do tipo conta como sem nível', () => {
    const s = summarizeLevels(['z1'], as({ z1: ['c', 'beta'] }), typeById);
    expect(s.groups[0].noLevel).toBe(1);
    expect(s.groups[0].levels.every((l) => l.count === 0)).toBe(true);
  });

  it('includeEmptyTypes mostra os tipos que contam, mesmo sem zettel', () => {
    const s = summarizeLevels([], a, typeById, { includeEmptyTypes: true });
    expect(s.groups.map((g) => g.type.slug).sort()).toEqual(['conteudo', 'pratica']);
    expect(s.total).toBe(0);
  });

  it('id repetido conta uma vez', () => {
    expect(summarizeLevels(['z1', 'z1'], a, typeById).total).toBe(1);
  });
});

describe('trailLinkedIds / trailProgress', () => {
  const links = [
    { sourceId: 'T', targetId: 'z1' },
    { sourceId: 'T', targetId: 'z3' },
    { sourceId: 'T', targetId: 'z5' },
    { sourceId: 'T', targetId: 'P', type: 'parent-ref' as const },
    { sourceId: 'T', targetId: 'z1' },
    { sourceId: 'T', targetId: 'T' },
    { sourceId: 'OUTRA', targetId: 'z2' },
  ];
  const a = as({ z1: ['c', 'semente'], z2: ['c', 'semente'], z3: ['c', 'testado'], z5: ['f', null] });

  it('links de saída comuns, sem pai, sem duplicata, sem autolink', () => {
    expect(trailLinkedIds(links, 'T')).toEqual(['z1', 'z3', 'z5']);
  });
  it('progresso só pelos conteúdos citados', () => {
    const p = trailProgress(links, 'T', a, typeById);
    expect(p.total).toBe(2);
    expect(p.groups[0].levels.map((l) => l.count)).toEqual([1, 1, 0]);
  });
  it('trilha sem conteúdo: total 0', () => {
    expect(trailProgress([{ sourceId: 'T', targetId: 'z5' }], 'T', a, typeById).total).toBe(0);
  });
});
