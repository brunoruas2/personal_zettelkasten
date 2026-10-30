import { describe, expect, it } from 'vitest';
import {
  CONSULTED_MAX,
  TRAIL_MAX,
  backStep,
  consult,
  dismiss,
  focusOn,
  goLevel,
  initialLevels,
  linksOfFocus,
  pruneMissing,
  startEditing,
  stopEditing,
} from './Levels';

const L = (sourceId: string, targetId: string) => ({ sourceId, targetId });

describe('linksOfFocus', () => {
  it('saídas primeiro, depois entradas, sem duplicata nem o próprio zettel', () => {
    const links = [L('a', 'b'), L('c', 'a'), L('a', 'c'), L('a', 'a'), L('d', 'a')];
    expect(linksOfFocus('a', links)).toEqual(['b', 'c', 'd']);
  });

  it('filtra os invisíveis (tags excluídas)', () => {
    const links = [L('a', 'b'), L('c', 'a')];
    expect(linksOfFocus('a', links, (id) => id !== 'b')).toEqual(['c']);
  });

  it('zettel sem links devolve vazio', () => {
    expect(linksOfFocus('x', [L('a', 'b')])).toEqual([]);
  });
});

describe('focusOn', () => {
  it('carrega os links, ativa o primeiro, zera a edição e anota a trilha', () => {
    const s = focusOn({ ...initialLevels, editing: 'focus', level: 'map' }, 'a', [L('a', 'b'), L('c', 'a')]);
    expect(s).toMatchObject({ level: 'focus', focusId: 'a', consulted: ['b', 'c'], activeId: 'b', editing: null, trail: ['a'] });
  });

  it('respeita o teto de consultados', () => {
    const links = Array.from({ length: 12 }, (_, i) => L('a', `n${i}`));
    expect(focusOn(initialLevels, 'a', links).consulted).toHaveLength(CONSULTED_MAX);
  });

  it('a trilha não repete e respeita o teto', () => {
    let s = initialLevels;
    for (const id of ['a', 'b', 'c', 'd', 'e', 'c']) s = focusOn(s, id, []);
    expect(s.trail).toEqual(['b', 'd', 'e', 'c']);
    expect(s.trail).toHaveLength(TRAIL_MAX);
  });

  it('sem links, nenhum ativo', () => {
    expect(focusOn(initialLevels, 'a', [])).toMatchObject({ consulted: [], activeId: null });
  });
});

describe('consult / dismiss', () => {
  const base = focusOn(initialLevels, 'a', [L('a', 'b'), L('a', 'c')]);

  it('consultar põe no topo e ativa, sem trocar o foco', () => {
    const s = consult(base, 'c');
    expect(s.consulted).toEqual(['c', 'b']);
    expect(s.activeId).toBe('c');
    expect(s.focusId).toBe('a');
  });

  it('o nono consultado derruba o mais antigo', () => {
    let s = base;
    for (let i = 0; i < 12; i++) s = consult(s, `x${i}`);
    expect(s.consulted).toHaveLength(CONSULTED_MAX);
    expect(s.consulted[0]).toBe('x11');
    expect(s.consulted).not.toContain('b');
  });

  it('dispensar o ativo ativa o próximo', () => {
    const s = dismiss(base, 'b');
    expect(s.consulted).toEqual(['c']);
    expect(s.activeId).toBe('c');
  });

  it('dispensar o último deixa sem ativo', () => {
    const s = dismiss(dismiss(base, 'b'), 'c');
    expect(s).toMatchObject({ consulted: [], activeId: null });
  });

  it('consultar/dispensar encerram a edição da Memória, mas não a do Foco', () => {
    const mem = startEditing(base, 'memory');
    expect(consult(mem, 'c').editing).toBeNull();
    expect(dismiss(mem, 'b').editing).toBeNull();
    const foc = startEditing(base, 'focus');
    expect(consult(foc, 'c').editing).toBe('focus');
  });
});

describe('edição e níveis', () => {
  const base = focusOn(initialLevels, 'a', [L('a', 'b')]);

  it('só edita o Foco com foco e a Memória com ativo', () => {
    expect(startEditing(initialLevels, 'focus').editing).toBeNull();
    expect(startEditing(initialLevels, 'memory').editing).toBeNull();
    expect(startEditing(base, 'focus').editing).toBe('focus');
    expect(startEditing(base, 'memory').editing).toBe('memory');
  });

  it('abrir uma edição troca a anterior (só uma por vez)', () => {
    expect(startEditing(startEditing(base, 'focus'), 'memory').editing).toBe('memory');
  });

  it('trocar de nível encerra a edição; o mesmo nível não mexe em nada', () => {
    const e = startEditing(base, 'focus');
    expect(goLevel(e, 'memory')).toMatchObject({ level: 'memory', editing: null });
    expect(goLevel(e, 'focus')).toBe(e);
    expect(stopEditing(base)).toBe(base);
  });
});

describe('backStep', () => {
  const base = focusOn(initialLevels, 'a', [L('a', 'b')]);

  it('primeiro encerra a edição, sem trocar de nível', () => {
    const { state, exit } = backStep(startEditing(goLevel(base, 'memory'), 'memory'));
    expect(exit).toBe(false);
    expect(state).toMatchObject({ level: 'memory', editing: null });
  });

  it('depois volta mapa → memória → foco e por fim sai', () => {
    let s = goLevel(base, 'map');
    let r = backStep(s);
    expect(r.state.level).toBe('memory');
    r = backStep(r.state);
    expect(r.state.level).toBe('focus');
    expect(r.exit).toBe(false);
    r = backStep(r.state);
    expect(r.exit).toBe(true);
  });
});

describe('pruneMissing', () => {
  it('remove zettels apagados e reativa um existente', () => {
    const s = consult(focusOn(initialLevels, 'a', [L('a', 'b'), L('a', 'c')]), 'b');
    const p = pruneMissing(s, (id) => id !== 'b');
    expect(p.consulted).toEqual(['c']);
    expect(p.activeId).toBe('c');
  });

  it('foco apagado zera o foco e a edição', () => {
    const s = startEditing(focusOn(initialLevels, 'a', []), 'focus');
    const p = pruneMissing(s, () => false);
    expect(p).toMatchObject({ focusId: null, editing: null, trail: [] });
  });

  it('nada a podar devolve o mesmo objeto', () => {
    const s = focusOn(initialLevels, 'a', [L('a', 'b')]);
    expect(pruneMissing(s, () => true)).toBe(s);
  });
});
