// Extração dos headings de um corpo markdown para a Table of Contents.
//
// Esta é a ÚNICA fonte dos ids de heading: `MarkdownRenderer` monta o mapa
// `line -> id` a partir daqui e o `TocDrawer` consome a mesma lista. Slugificar
// dos dois lados exigiria dois algoritmos de dedupe concordando, e o primeiro
// heading repetido quebraria o salto em silêncio.

export interface TocItem {
  /** id aplicado ao elemento no DOM (prefixado com `zk-h-`). */
  id: string;
  /** Texto do heading sem marcação inline. */
  text: string;
  /** 1, 2 ou 3 — os únicos níveis que o renderer suporta. */
  level: 1 | 2 | 3;
  /** Índice da linha no corpo, usado como chave do mapa no renderer. */
  line: number;
}

const HEADING_RE = /^(#{1,3}) (.+)$/;

/** Remove a marcação inline que o renderer não exibe dentro de um heading. */
function stripInline(raw: string): string {
  return raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')      // ![alt](url)
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2') // [[alvo|rótulo]]
    .replace(/\[\[([^\]]+)\]\]/g, '$1')            // [[alvo]]
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')       // [texto](url)
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/~~([^~]*)~~/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .trim();
}

function slugify(text: string): string {
  const base = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'h';
}

/**
 * Percorre o corpo linha a linha alternando o flag de bloco cercado, com a
 * mesma regra do laço principal de `MarkdownRenderer` — um `# comentário`
 * dentro de ``` não é heading nem lá nem aqui.
 */
export function extractHeadings(body: string): TocItem[] {
  const items: TocItem[] = [];
  const seen = new Map<string, number>();
  let inCodeBlock = false;

  const lines = body.split('\n');
  for (let line = 0; line < lines.length; line++) {
    const raw = lines[line];

    if (raw.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const match = raw.match(HEADING_RE);
    if (!match) continue;

    const text = stripInline(match[2]);
    if (!text) continue;

    const slug = slugify(text);
    const count = (seen.get(slug) ?? 0) + 1;
    seen.set(slug, count);

    items.push({
      id: count === 1 ? `zk-h-${slug}` : `zk-h-${slug}-${count}`,
      text,
      level: match[1].length as 1 | 2 | 3,
      line,
    });
  }

  return items;
}

/** Mapa `linha -> id` consumido pelo renderer ao emitir os headings. */
export function headingIdsByLine(body: string): Map<number, string> {
  return new Map(extractHeadings(body).map((h) => [h.line, h.id]));
}
