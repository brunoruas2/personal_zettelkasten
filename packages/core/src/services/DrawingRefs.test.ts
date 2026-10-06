import { describe, expect, it } from 'vitest';
import { drawingRef, extractDrawingIds, removeDrawingRef } from './DrawingRefs';

describe('extractDrawingIds', () => {
  it('acha referências na ordem de aparição, sem repetir', () => {
    const body = 'a ![x](zk:draw/abc123) b\n\n![](zk:draw/def456) ![y](zk:draw/abc123)';
    expect(extractDrawingIds(body)).toEqual(['abc123', 'def456']);
  });

  it('ignora zk:img e imagens http', () => {
    expect(extractDrawingIds('![a](zk:img/aaaa) ![b](https://x/y.png)')).toEqual([]);
  });

  it('ignora code span e code fence', () => {
    const body = '`![x](zk:draw/inline1)`\n\n```md\n![x](zk:draw/fenced1)\n```\n\n![x](zk:draw/real1)';
    expect(extractDrawingIds(body)).toEqual(['real1']);
  });

  it('considera fence não fechado no fim do documento', () => {
    expect(extractDrawingIds('![x](zk:draw/real1)\n```\n![x](zk:draw/open1)')).toEqual(['real1']);
  });

  it('aceita ids de 18 caracteres do generateId', () => {
    expect(extractDrawingIds('![](zk:draw/20260517143022k7p2)')).toEqual(['20260517143022k7p2']);
  });
});

describe('removeDrawingRef', () => {
  it('remove a linha inteira quando a referência está sozinha', () => {
    expect(removeDrawingRef('antes\n![](zk:draw/abc)\ndepois', 'abc')).toBe('antes\ndepois');
  });

  it('remove só a referência quando há texto na linha', () => {
    expect(removeDrawingRef('veja ![](zk:draw/abc) aqui', 'abc')).toBe('veja  aqui');
  });

  it('não mexe em outros desenhos', () => {
    expect(removeDrawingRef('![](zk:draw/abc)\n![](zk:draw/def)', 'abc')).toBe('![](zk:draw/def)');
  });
});

describe('drawingRef', () => {
  it('monta a referência', () => {
    expect(drawingRef('abc', 'croqui')).toBe('![croqui](zk:draw/abc)');
  });
});
