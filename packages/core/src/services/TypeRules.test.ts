import { describe, expect, it } from 'vitest';
import { TYPE_COLORS, TYPE_ICONS } from '../models/TypeAppearance';
import { isValidSlug, MAX_LEVELS, slugify, validateType, type ZettelType } from '../models/ZettelType';
import { checkLevelChange, effectiveLevel, levelAfterTypeChange, validateLevel } from './TypeRules';

const conteudo: Pick<ZettelType, 'id' | 'levels'> = {
  id: 'c',
  levels: [
    { key: 'semente', label: 'Semente', emoji: '🤖', userOnly: false },
    { key: 'testado', label: 'Testado', emoji: '💾', userOnly: false },
    { key: 'consolidado', label: 'Consolidado', emoji: '🧠', userOnly: true },
  ],
};
const fonte: Pick<ZettelType, 'id' | 'levels'> = { id: 'f', levels: [] };

const base = {
  name: 'Trilha',
  slug: 'trilha',
  icon: TYPE_ICONS[0],
  color: TYPE_COLORS[0],
  template: '',
  protectedSections: [] as string[],
  levels: [] as ZettelType['levels'],
};

describe('validateType', () => {
  it('aceita um tipo simples', () => {
    expect(validateType(base)).toEqual([]);
  });
  it('recusa ícone e cor fora das listas', () => {
    expect(validateType({ ...base, icon: '🦄' })).toContain('o ícone não está na lista permitida');
    expect(validateType({ ...base, color: '#7df9ff' })).toContain('a cor não está na paleta permitida');
  });
  it('recusa chave de nível repetida', () => {
    const levels = [
      { key: 'a', label: 'A', userOnly: false },
      { key: 'a', label: 'B', userOnly: false },
    ];
    expect(validateType({ ...base, levels }).join()).toContain('repetido');
  });
  it('recusa mais níveis que o teto e template grande', () => {
    const levels = Array.from({ length: MAX_LEVELS + 1 }, (_, i) => ({ key: `n${i}`, label: `N${i}`, userOnly: false }));
    expect(validateType({ ...base, levels }).join()).toContain('níveis');
    expect(validateType({ ...base, template: 'x'.repeat(17 * 1024) }).join()).toContain('16 KB');
  });
  it('paleta não contém as cores reservadas', () => {
    for (const reservada of ['#7df9ff', '#00e5ff', '#ffb000', '#ff2bd6']) {
      expect((TYPE_COLORS as readonly string[]).includes(reservada)).toBe(false);
    }
  });
});

describe('slugify', () => {
  it('tira acento e normaliza', () => {
    expect(slugify('Prática de Código')).toBe('pratica-de-codigo');
    expect(isValidSlug(slugify('Conteúdo'))).toBe(true);
  });
});

describe('níveis', () => {
  it('tipo sem escada só aceita vazio', () => {
    expect(validateLevel(fonte, null)).toBeNull();
    expect(validateLevel(fonte, 'x')).toContain('não tem níveis');
  });
  it('nível inexistente lista os válidos', () => {
    expect(validateLevel(conteudo, 'publicado')).toContain('semente');
    expect(validateLevel(conteudo, 'testado')).toBeNull();
  });
  it('troca de tipo limpa o nível, salvo pedido válido', () => {
    expect(levelAfterTypeChange(fonte, 'testado')).toBeNull();
    expect(levelAfterTypeChange(conteudo, 'testado')).toBe('testado');
    expect(levelAfterTypeChange(conteudo, undefined)).toBeNull();
  });
  it('nível removido do tipo vira sem nível', () => {
    expect(effectiveLevel(conteudo, 'beta')).toBeNull();
    expect(effectiveLevel(conteudo, 'semente')).toBe('semente');
    expect(effectiveLevel(undefined, 'semente')).toBeNull();
  });
});

describe('checkLevelChange (autoria)', () => {
  const sem = { type: conteudo, level: 'semente' };
  const test = { type: conteudo, level: 'testado' };
  const cons = { type: conteudo, level: 'consolidado' };

  it('agente promove até um nível comum', () => {
    expect(checkLevelChange('agent', sem, test).ok).toBe(true);
  });
  it('agente não marca nível user_only', () => {
    expect(checkLevelChange('agent', test, cons).ok).toBe(false);
  });
  it('agente não tira de nível user_only (nível, tipo ou remoção)', () => {
    expect(checkLevelChange('agent', cons, sem).ok).toBe(false);
    expect(checkLevelChange('agent', cons, { type: fonte, level: null }).ok).toBe(false);
    expect(checkLevelChange('agent', cons, { type: null, level: null }).ok).toBe(false);
  });
  it('sem mudança sempre passa', () => {
    expect(checkLevelChange('agent', cons, cons).ok).toBe(true);
  });
  it('usuário pode tudo', () => {
    expect(checkLevelChange('ui', test, cons).ok).toBe(true);
    expect(checkLevelChange('ui', cons, sem).ok).toBe(true);
  });
  it('zettel sem tipo para nível comum passa', () => {
    expect(checkLevelChange('agent', { type: null, level: null }, sem).ok).toBe(true);
  });
});
