import { describe, expect, it } from 'vitest';
import { changedProtectedSections, parseSections } from './SectionParser';

const TEMPLATE = '## Captura\n\n## Minha síntese\n\n## Testes\n';

describe('parseSections', () => {
  it('separa seções do mesmo nível', () => {
    const s = parseSections('## A\ntexto a\n## B\ntexto b');
    expect(s.map((x) => [x.title, x.content])).toEqual([
      ['A', 'texto a'],
      ['B', 'texto b'],
    ]);
  });

  it('subseção faz parte da seção', () => {
    const s = parseSections('## Síntese\nintro\n### Mapa\nramo\n## Fim\nx');
    expect(s[0].content).toBe('intro\n### Mapa\nramo');
    expect(s[1].title).toBe('Mapa');
    expect(s[2].title).toBe('Fim');
  });

  it('ignora cabeçalho dentro de cerca de código', () => {
    const s = parseSections('## Captura\n```md\n## Minha síntese\nfalso\n```\nfim');
    expect(s.map((x) => x.title)).toEqual(['Captura']);
    expect(s[0].content).toContain('falso');
  });

  it('cerca de ~~~ e cerca maior só fecha com a mesma', () => {
    const s = parseSections('~~~\n## X\n~~~\n## Real\nok');
    expect(s.map((x) => x.title)).toEqual(['Real']);
  });

  it('seção no fim do texto vai até o fim', () => {
    const s = parseSections('## A\nx\n## Minha síntese\nlinha 1\nlinha 2');
    expect(s[1].content).toBe('linha 1\nlinha 2');
  });

  it('cabeçalho vazio tem conteúdo vazio', () => {
    expect(parseSections(TEMPLATE).map((x) => x.content)).toEqual(['', '', '']);
  });
});

describe('changedProtectedSections', () => {
  const P = ['Minha síntese'];

  it('agente preenche a síntese: mudou', () => {
    const novo = '## Captura\n\n## Minha síntese\nconsegui!\n\n## Testes\n';
    expect(changedProtectedSections(TEMPLATE, novo, P)).toEqual(['Minha síntese']);
  });

  it('editar outra seção não conta', () => {
    const novo = '## Captura\ntexto novo\n\n## Minha síntese\n\n## Testes\n';
    expect(changedProtectedSections(TEMPLATE, novo, P)).toEqual([]);
  });

  it('seção ausente equivale a vazia (template com cabeçalho vazio passa)', () => {
    expect(changedProtectedSections('', TEMPLATE, P)).toEqual([]);
    expect(changedProtectedSections('## Captura\nx', TEMPLATE, P)).toEqual([]);
  });

  it('síntese idêntica com resto mudado: não mudou', () => {
    const antes = '## Captura\na\n## Minha síntese\n- ponto\n';
    const depois = '## Captura\nb\n\n## Minha síntese\n- ponto\n\n## Testes\n[[T]]';
    expect(changedProtectedSections(antes, depois, P)).toEqual([]);
  });

  it('apagar a síntese conta como mudança', () => {
    const antes = '## Minha síntese\n- ponto\n';
    expect(changedProtectedSections(antes, '## Captura\nx', P)).toEqual(['Minha síntese']);
  });

  it('subseção alterada conta como mudança da seção', () => {
    const antes = '## Minha síntese\n### Mapa\nramo\n';
    const depois = '## Minha síntese\n### Mapa\nramo editado\n';
    expect(changedProtectedSections(antes, depois, P)).toEqual(['Minha síntese']);
  });

  it('acrescentar texto depois da síntese no fim conta como mudança', () => {
    const antes = '## Captura\nx\n## Minha síntese\n- a';
    const depois = '## Captura\nx\n## Minha síntese\n- a\n- b';
    expect(changedProtectedSections(antes, depois, P)).toEqual(['Minha síntese']);
  });

  it('título repetido protege todas as ocorrências', () => {
    const antes = '## Minha síntese\nA\n## Outra\nx\n## Minha síntese\nB';
    const depois = '## Minha síntese\nA\n## Outra\nx\n## Minha síntese\nB alterado';
    expect(changedProtectedSections(antes, depois, P)).toEqual(['Minha síntese']);
  });

  it('compara título sem diferenciar caixa', () => {
    const antes = '## MINHA SÍNTESE\nA';
    const depois = '## minha síntese\nA!';
    expect(changedProtectedSections(antes, depois, ['Minha Síntese'])).toEqual(['Minha Síntese']);
  });

  it('cabeçalho falso em cerca de código não protege nem é alterado', () => {
    const antes = '```\n## Minha síntese\nx\n```';
    const depois = '```\n## Minha síntese\ny\n```';
    expect(changedProtectedSections(antes, depois, P)).toEqual([]);
  });

  it('sem seções protegidas, nunca muda', () => {
    expect(changedProtectedSections('a', 'b', [])).toEqual([]);
  });
});
