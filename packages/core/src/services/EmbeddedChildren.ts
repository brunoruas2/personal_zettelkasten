import type { Link } from '../models/Link';
import type { Zettel } from '../models/Zettel';
import { parseLinks } from './LinkParser';

/**
 * Filhos que o leitor pode embutir dentro do zettel pai: alvos de links de
 * saída comuns (`[[Título]]`, sem `type`). `[[^Título]]` declara o alvo como
 * *pai* de quem escreve, então nunca gera filho. Auto-link e título sem zettel
 * correspondente são ignorados; cada filho aparece uma vez, na ordem da
 * primeira ocorrência no corpo.
 *
 * A ordem vem do corpo e a existência da relação vem da tabela de links, para
 * que a lista só contenha o que o sync/`_syncLinks` de fato resolveu.
 *
 * `links = null` dispensa a tabela e confia só no corpo: é o modo do editor,
 * onde o texto ainda não salvo é a verdade e a tabela persistida está defasada
 * (um zettel novo nem tem linha nela).
 */
export function selectEmbeddableChildren(
  parentId: string,
  body: string,
  links: Link[] | null,
  zettels: Zettel[],
): Zettel[] {
  let linkedIds: Set<string> | null = null;
  if (links) {
    linkedIds = new Set<string>();
    for (const l of links) {
      if (l.sourceId === parentId && l.type === undefined && l.targetId !== parentId) {
        linkedIds.add(l.targetId);
      }
    }
    if (linkedIds.size === 0) return [];
  }

  const byTitle = new Map<string, Zettel>();
  for (const z of zettels) {
    if (z.id === parentId) continue;
    if (linkedIds && !linkedIds.has(z.id)) continue;
    const key = z.title.trim().toLowerCase();
    if (!byTitle.has(key)) byTitle.set(key, z);
  }

  const result: Zettel[] = [];
  const seen = new Set<string>();
  for (const p of parseLinks(body)) {
    if (p.isParentRef) continue;
    const child = byTitle.get(p.target.trim().toLowerCase());
    if (!child || seen.has(child.id)) continue;
    seen.add(child.id);
    result.push(child);
  }
  return result;
}

/**
 * Títulos dos `[[links]]` comuns de um trecho de texto (um bloco do Markdown ou
 * um parágrafo do editor), na ordem em que aparecem. Exclui `[[^pai]]` e o que
 * está em code span, onde `[[x]]` é código. É o que decide em qual bloco cada
 * filho é ancorado: tanto o `MarkdownRenderer` quanto o editor usam esta função,
 * cada um contando só a primeira ocorrência de cada título.
 */
export function extractPlainWikiTitles(text: string): string[] {
  if (!text.includes('[[')) return [];
  const withoutCode = text.replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));
  return parseLinks(withoutCode)
    .filter((p) => !p.isParentRef)
    .map((p) => p.target);
}
