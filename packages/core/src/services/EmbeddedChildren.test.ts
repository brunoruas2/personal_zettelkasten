import { describe, expect, it } from 'vitest';
import type { Link } from '../models/Link';
import type { Zettel } from '../models/Zettel';
import { selectEmbeddableChildren } from './EmbeddedChildren';

const NOW = 1_757_000_000_000;

function zettel(id: string, title = id): Zettel {
  return { id, title, body: '', tags: [], createdAt: NOW, updatedAt: NOW };
}

function link(source: string, target: string): Link {
  return { sourceId: source, targetId: target };
}

function parentRef(source: string, target: string): Link {
  return { sourceId: source, targetId: target, type: 'parent-ref' };
}

const ids = (zs: Zettel[]) => zs.map((z) => z.id);

describe('selectEmbeddableChildren', () => {
  const all = [zettel('P'), zettel('F1'), zettel('F2'), zettel('G')];

  it('link comum gera filho', () => {
    const result = selectEmbeddableChildren('P', 'veja [[F1]]', [link('P', 'F1')], all);
    expect(ids(result)).toEqual(['F1']);
  });

  it('parent-ref não gera filho', () => {
    const result = selectEmbeddableChildren('P', '[[^G]]', [parentRef('P', 'G')], all);
    expect(result).toEqual([]);
  });

  it('referência repetida aparece uma vez', () => {
    const result = selectEmbeddableChildren('P', '[[F1]] e [[F1]]', [link('P', 'F1')], all);
    expect(ids(result)).toEqual(['F1']);
  });

  it('segue a ordem de primeira aparição no corpo, não a dos links', () => {
    const result = selectEmbeddableChildren(
      'P',
      '[[F2]] depois [[F1]]',
      [link('P', 'F1'), link('P', 'F2')],
      all,
    );
    expect(ids(result)).toEqual(['F2', 'F1']);
  });

  it('título sem zettel é ignorado', () => {
    const result = selectEmbeddableChildren('P', '[[Inexistente]]', [], all);
    expect(result).toEqual([]);
  });

  it('auto-link é ignorado', () => {
    const result = selectEmbeddableChildren('P', '[[P]]', [link('P', 'P')], all);
    expect(result).toEqual([]);
  });

  it('casa título sem diferenciar caixa e com alias', () => {
    const zs = [zettel('P'), zettel('F1', 'Meu Filho')];
    const result = selectEmbeddableChildren('P', '[[meu filho|texto]]', [link('P', 'F1')], zs);
    expect(ids(result)).toEqual(['F1']);
  });

  it('link de outro zettel não conta', () => {
    const result = selectEmbeddableChildren('P', '[[F1]]', [link('G', 'F1')], all);
    expect(result).toEqual([]);
  });

  it('ciclo pai↔filho: o filho lista o pai, e o pai lista o filho', () => {
    const links = [link('P', 'F1'), link('F1', 'P')];
    expect(ids(selectEmbeddableChildren('P', '[[F1]]', links, all))).toEqual(['F1']);
    expect(ids(selectEmbeddableChildren('F1', '[[P]]', links, all))).toEqual(['P']);
  });

  it('links = null usa só o corpo (editor com texto não salvo)', () => {
    const result = selectEmbeddableChildren('P', '[[F2]] [[^G]] [[F1]] [[P]]', null, all);
    expect(ids(result)).toEqual(['F2', 'F1']);
  });

  it('links = null com pai novo (sem id salvo) não embute a si mesmo', () => {
    const result = selectEmbeddableChildren('', '[[F1]]', null, all);
    expect(ids(result)).toEqual(['F1']);
  });
});
