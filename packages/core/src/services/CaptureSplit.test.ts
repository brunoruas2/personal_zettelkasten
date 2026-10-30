import { describe, expect, it } from 'vitest';
import { splitCapture } from './CaptureSplit';
import { FIRST_LINE_MAX } from './FirstLine';

describe('splitCapture', () => {
  it('1ª linha vira título e o resto vira corpo', () => {
    expect(splitCapture('Ideia de busca\nusar fuzzy no [[autocomplete]]')).toEqual({
      title: 'Ideia de busca',
      body: 'usar fuzzy no [[autocomplete]]',
    });
  });

  it('linha única: corpo vazio', () => {
    expect(splitCapture('Comprar café')).toEqual({ title: 'Comprar café', body: '' });
  });

  it('1ª linha longa: título truncado e corpo com o texto completo', () => {
    const long = 'a'.repeat(FIRST_LINE_MAX + 20);
    const r = splitCapture(`${long}\noutra linha`);
    expect(r.title.length).toBe(FIRST_LINE_MAX);
    expect(r.title.endsWith('…')).toBe(true);
    expect(r.body).toBe(`${long}\noutra linha`);
  });

  it('remove marcadores do título', () => {
    expect(splitCapture('## Plano\npasso 1').title).toBe('Plano');
    expect(splitCapture('- item solto').title).toBe('item solto');
  });

  it('ignora linhas vazias iniciais e entre título e corpo', () => {
    expect(splitCapture('\n\nTítulo\n\n\ncorpo')).toEqual({ title: 'Título', body: 'corpo' });
  });

  it('texto vazio ou só com espaços', () => {
    expect(splitCapture('')).toEqual({ title: '', body: '' });
    expect(splitCapture('  \n \n')).toEqual({ title: '', body: '' });
  });

  it('linha sem texto (só imagem): corpo guarda tudo', () => {
    const r = splitCapture('![x](zk:img/abc)\nlegenda');
    expect(r.title).toBe('');
    expect(r.body).toBe('![x](zk:img/abc)\nlegenda');
  });

  it('aceita CRLF', () => {
    expect(splitCapture('Título\r\ncorpo')).toEqual({ title: 'Título', body: 'corpo' });
  });
});
