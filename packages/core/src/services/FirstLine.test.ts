import { describe, expect, it } from 'vitest';
import { FIRST_LINE_MAX, firstLine } from './FirstLine';

describe('firstLine', () => {
  it('devolve a primeira linha não vazia', () => {
    expect(firstLine('\n\nOlá, mundo\nsegunda')).toBe('Olá, mundo');
  });

  it('remove marcadores de título, lista, citação e tarefa', () => {
    expect(firstLine('## Introdução')).toBe('Introdução');
    expect(firstLine('- item de lista')).toBe('item de lista');
    expect(firstLine('1. primeiro passo')).toBe('primeiro passo');
    expect(firstLine('> citação')).toBe('citação');
    expect(firstLine('- [ ] tarefa pendente')).toBe('tarefa pendente');
  });

  it('limpa a sintaxe inline mantendo o texto', () => {
    expect(firstLine('Veja [[Teologia]] e **muito** `código`')).toBe('Veja Teologia e muito código');
    expect(firstLine('[[Teologia|a teologia]] ~~não~~')).toBe('a teologia não');
    expect(firstLine('[[^Pai]] filho')).toBe('Pai filho');
    expect(firstLine('um [site](https://x.com) bom')).toBe('um site bom');
  });

  it('ignora imagens, desenhos e cercas de código', () => {
    expect(firstLine('![foto](zk:img/abc)\ntexto')).toBe('texto');
    expect(firstLine('![](zk:draw/abc)\n\ntexto')).toBe('texto');
    expect(firstLine('```js\nconst a = 1\n```\nprosa')).toBe('prosa');
  });

  it('pula a linha igual ao título, sem diferenciar caixa', () => {
    expect(firstLine('# Meu Título\n\nCorpo de verdade', 'meu título')).toBe('Corpo de verdade');
  });

  it('trunca no teto', () => {
    const out = firstLine('a'.repeat(300));
    expect(out.length).toBe(FIRST_LINE_MAX);
    expect(out.endsWith('…')).toBe(true);
  });

  it('corpo sem texto devolve vazio', () => {
    expect(firstLine('')).toBe('');
    expect(firstLine('\n\n![x](zk:img/a)\n')).toBe('');
    expect(firstLine('```\nsó código\n```')).toBe('');
  });
});
