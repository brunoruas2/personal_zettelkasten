import { describe, expect, it } from 'vitest';
import type { Link } from '../models/Link';
import type { Zettel } from '../models/Zettel';
import { analyzeSubtree, buildChildAdjacency, collectReachable } from './ZettelHierarchy';

const NOW = 1_757_000_000_000;

/** Título = id, para que a ordenação alfabética de irmãos seja a dos próprios ids. */
function zettel(id: string, title = id): Zettel {
  return { id, title, body: '', tags: [], createdAt: NOW, updatedAt: NOW };
}

/** `[[Título]]` escrito em `parent`: source=pai, target=filho. */
function childLink(parent: string, child: string): Link {
  return { sourceId: parent, targetId: child };
}

/** `[[^Título]]` escrito em `child`: source=filho, target=pai. */
function parentRefLink(child: string, parent: string): Link {
  return { sourceId: child, targetId: parent, type: 'parent-ref' };
}

function childrenOf(adjacency: Map<string, string[]>, id: string): string[] {
  return adjacency.get(id) ?? [];
}

describe('buildChildAdjacency', () => {
  it('link comum vira aresta pai → filho na direção gravada', () => {
    const adjacency = buildChildAdjacency([childLink('P', 'F')]);

    expect(childrenOf(adjacency, 'P')).toEqual(['F']);
    expect(childrenOf(adjacency, 'F')).toEqual([]);
  });

  it('link parent-ref vira aresta invertida em relação à linha gravada', () => {
    const adjacency = buildChildAdjacency([parentRefLink('F', 'P')]);

    expect(childrenOf(adjacency, 'P')).toEqual(['F']);
    expect(childrenOf(adjacency, 'F')).toEqual([]);
  });

  it('colapsa a mesma relação declarada dos dois lados', () => {
    const adjacency = buildChildAdjacency([childLink('P', 'F'), parentRefLink('F', 'P')]);

    expect(childrenOf(adjacency, 'P')).toEqual(['F']);
  });

  it('não altera as linhas de links recebidas', () => {
    const links: Link[] = [parentRefLink('F', 'P')];
    buildChildAdjacency(links);

    expect(links[0]).toEqual({ sourceId: 'F', targetId: 'P', type: 'parent-ref' });
  });

  it('acumula vários filhos do mesmo pai', () => {
    const adjacency = buildChildAdjacency([childLink('A', 'B'), childLink('A', 'C')]);

    expect(childrenOf(adjacency, 'A')).toEqual(['B', 'C']);
  });
});

describe('collectReachable', () => {
  it('inclui a raiz e toda a descendência transitiva', () => {
    const adjacency = buildChildAdjacency([
      childLink('A', 'B'),
      childLink('B', 'D'),
      parentRefLink('C', 'A'),
    ]);

    expect(collectReachable('A', adjacency)).toEqual(new Set(['A', 'B', 'C', 'D']));
  });

  it('raiz isolada devolve só a própria raiz', () => {
    expect(collectReachable('A', buildChildAdjacency([]))).toEqual(new Set(['A']));
  });

  it('não sobe para os pais', () => {
    const adjacency = buildChildAdjacency([childLink('A', 'B')]);

    expect(collectReachable('B', adjacency)).toEqual(new Set(['B']));
  });

  it('termina quando há ciclo', () => {
    const adjacency = buildChildAdjacency([childLink('A', 'B'), childLink('B', 'A')]);

    expect(collectReachable('A', adjacency)).toEqual(new Set(['A', 'B']));
  });
});

describe('analyzeSubtree — ordem', () => {
  it('árvore simples sai em pré-ordem: pai antes da própria subárvore', () => {
    const zettels = ['A', 'B', 'C', 'D'].map((id) => zettel(id));
    const links = [childLink('A', 'B'), childLink('A', 'C'), childLink('B', 'D')];

    expect(analyzeSubtree('A', zettels, links).ids).toEqual(['A', 'B', 'D', 'C']);
  });

  it('raiz sem filhos devolve só a raiz', () => {
    expect(analyzeSubtree('A', [zettel('A')], []).ids).toEqual(['A']);
  });

  it('losango inclui o zettel compartilhado uma única vez, na primeira visita', () => {
    const zettels = ['A', 'B', 'C', 'D'].map((id) => zettel(id));
    const links = [
      childLink('A', 'B'),
      childLink('A', 'C'),
      childLink('B', 'D'),
      childLink('C', 'D'),
    ];

    expect(analyzeSubtree('A', zettels, links).ids).toEqual(['A', 'B', 'D', 'C']);
  });

  it('a ordem não depende da ordem da lista de links', () => {
    const zettels = ['A', 'B', 'C', 'D'].map((id) => zettel(id));
    const links = [childLink('A', 'B'), childLink('A', 'C'), childLink('B', 'D')];
    const shuffled = [links[2], links[1], links[0]];

    expect(analyzeSubtree('A', zettels, shuffled).ids).toEqual(
      analyzeSubtree('A', zettels, links).ids,
    );
  });

  it('ordena irmãos por título, não por id', () => {
    const zettels = [
      zettel('z1', 'Alfa'),
      zettel('z2', 'Zulu'),
      zettel('z3', 'Bravo'),
    ];
    const links = [childLink('z1', 'z2'), childLink('z1', 'z3')];

    expect(analyzeSubtree('z1', zettels, links).ids).toEqual(['z1', 'z3', 'z2']);
  });

  it('ordena irmãos com acento pela colação pt-BR', () => {
    const zettels = [
      zettel('r', 'Raiz'),
      zettel('z1', 'Zebra'),
      zettel('a1', 'Água'),
      zettel('b1', 'Banana'),
    ];
    const links = [childLink('r', 'z1'), childLink('r', 'a1'), childLink('r', 'b1')];

    expect(analyzeSubtree('r', zettels, links).ids).toEqual(['r', 'a1', 'b1', 'z1']);
  });

  it('ignora ids de adjacência sem zettel carregado', () => {
    const zettels = [zettel('A'), zettel('B')];
    const links = [childLink('A', 'B'), childLink('A', 'fantasma')];

    const result = analyzeSubtree('A', zettels, links);

    expect(result.ids).toEqual(['A', 'B']);
    expect(result.cycles).toEqual([]);
  });

  it('raiz inexistente devolve resultado vazio', () => {
    expect(analyzeSubtree('sumiu', [zettel('A')], [])).toEqual({ ids: [], cycles: [], depth: 0 });
  });

  it('inclui filhos declarados por parent-ref', () => {
    const zettels = ['A', 'B'].map((id) => zettel(id));

    expect(analyzeSubtree('A', zettels, [parentRefLink('B', 'A')]).ids).toEqual(['A', 'B']);
  });
});

describe('analyzeSubtree — profundidade', () => {
  it('raiz sozinha tem profundidade 0', () => {
    expect(analyzeSubtree('A', [zettel('A')], []).depth).toBe(0);
  });

  it('conta o nível mais fundo alcançado, não o mais raso', () => {
    const zettels = ['A', 'B', 'C', 'D'].map((id) => zettel(id));
    const links = [childLink('A', 'B'), childLink('A', 'C'), childLink('B', 'D')];

    expect(analyzeSubtree('A', zettels, links).depth).toBe(2);
  });
});

describe('analyzeSubtree — ciclos', () => {
  it('detecta ciclo direto', () => {
    const zettels = ['A', 'B'].map((id) => zettel(id));
    const links = [childLink('A', 'B'), childLink('B', 'A')];

    expect(analyzeSubtree('A', zettels, links).cycles).toEqual([['A', 'B', 'A']]);
  });

  it('detecta ciclo indireto', () => {
    const zettels = ['A', 'B', 'C'].map((id) => zettel(id));
    const links = [childLink('A', 'B'), childLink('B', 'C'), childLink('C', 'A')];

    expect(analyzeSubtree('A', zettels, links).cycles).toEqual([['A', 'B', 'C', 'A']]);
  });

  it('detecta ciclo que não inclui a raiz', () => {
    const zettels = ['A', 'B', 'C'].map((id) => zettel(id));
    const links = [childLink('A', 'B'), childLink('B', 'C'), childLink('C', 'B')];

    expect(analyzeSubtree('A', zettels, links).cycles).toEqual([['B', 'C', 'B']]);
  });

  it('detecta auto-referência', () => {
    const links = [childLink('A', 'A')];

    expect(analyzeSubtree('A', [zettel('A')], links).cycles).toEqual([['A', 'A']]);
  });

  it('detecta ciclo formado por parent-ref escrito ao contrário', () => {
    const zettels = ['A', 'B'].map((id) => zettel(id));
    const links = [childLink('A', 'B'), parentRefLink('A', 'B')];

    expect(analyzeSubtree('A', zettels, links).cycles).toEqual([['A', 'B', 'A']]);
  });

  it('losango não é ciclo', () => {
    const zettels = ['A', 'B', 'C', 'D'].map((id) => zettel(id));
    const links = [
      childLink('A', 'B'),
      childLink('A', 'C'),
      childLink('B', 'D'),
      childLink('C', 'D'),
    ];

    expect(analyzeSubtree('A', zettels, links).cycles).toEqual([]);
  });

  it('árvore acíclica não reporta ciclo', () => {
    const zettels = ['A', 'B', 'C', 'D'].map((id) => zettel(id));
    const links = [childLink('A', 'B'), childLink('A', 'C'), childLink('B', 'D')];

    expect(analyzeSubtree('A', zettels, links).cycles).toEqual([]);
  });

  it('reporta o mesmo ciclo uma vez só quando alcançado por duas entradas', () => {
    const zettels = ['A', 'B', 'C', 'D'].map((id) => zettel(id));
    const links = [
      childLink('A', 'B'),
      childLink('A', 'C'),
      childLink('B', 'D'),
      childLink('C', 'D'),
      childLink('D', 'B'),
    ];

    expect(analyzeSubtree('A', zettels, links).cycles).toEqual([['B', 'D', 'B']]);
  });

  it('reporta ciclos distintos separadamente', () => {
    const zettels = ['A', 'B', 'C', 'D', 'E'].map((id) => zettel(id));
    const links = [
      childLink('A', 'B'),
      childLink('B', 'A'),
      childLink('A', 'C'),
      childLink('C', 'D'),
      childLink('D', 'C'),
      childLink('A', 'E'),
    ];

    expect(analyzeSubtree('A', zettels, links).cycles).toEqual([
      ['A', 'B', 'A'],
      ['C', 'D', 'C'],
    ]);
  });

  it('a travessia termina mesmo com ciclo e ainda devolve cada zettel uma vez', () => {
    const zettels = ['A', 'B', 'C'].map((id) => zettel(id));
    const links = [childLink('A', 'B'), childLink('B', 'C'), childLink('C', 'A')];

    const result = analyzeSubtree('A', zettels, links);

    expect(result.ids).toEqual(['A', 'B', 'C']);
    expect(result.cycles).toHaveLength(1);
  });
});

describe('pureza', () => {
  it('roda sem window e sem indexedDB', () => {
    const globals = globalThis as unknown as Record<string, unknown>;
    expect(globals.window).toBeUndefined();
    expect(globals.indexedDB).toBeUndefined();

    const zettels = ['A', 'B'].map((id) => zettel(id));
    const links = [childLink('A', 'B')];

    expect(analyzeSubtree('A', zettels, links).ids).toEqual(['A', 'B']);
    expect(collectReachable('A', buildChildAdjacency(links))).toEqual(new Set(['A', 'B']));
  });

  it('chamadas repetidas com a mesma entrada devolvem o mesmo resultado', () => {
    const zettels = ['A', 'B', 'C'].map((id) => zettel(id));
    const links = [childLink('A', 'B'), childLink('A', 'C')];

    expect(analyzeSubtree('A', zettels, links)).toEqual(analyzeSubtree('A', zettels, links));
  });
});
