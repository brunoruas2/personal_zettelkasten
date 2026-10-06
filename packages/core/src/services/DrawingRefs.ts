/**
 * Referências a desenhos no corpo: `![alt](zk:draw/<id>)`. Mesma sintaxe de
 * imagem, então `INLINE_RE` e `LinkParser` não mudam. Referências dentro de
 * code span ou code fence não contam — são texto literal.
 */

export function drawingRef(id: string, alt = ''): string {
  return `![${alt}](zk:draw/${id})`;
}

/** Remove code fences e code spans, preservando o resto do texto. */
function stripCode(body: string): string {
  return body
    .replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\1[^\n]*(?=\n|$)|$)/gm, '')
    .replace(/`[^`\n]*`/g, '');
}

/** Ids de desenho referenciados no corpo, sem repetição, na ordem de aparição. */
export function extractDrawingIds(body: string): string[] {
  const re = /!\[[^\]]*\]\(zk:draw\/([A-Za-z0-9]{1,64})\)/g;
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const m of stripCode(body).matchAll(re)) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      ids.push(m[1]);
    }
  }
  return ids;
}

/** Remove do corpo toda referência ao desenho `id` (e a linha que ficar vazia por causa dela). */
export function removeDrawingRef(body: string, id: string): string {
  const safe = id.replace(/[^A-Za-z0-9]/g, '');
  const wholeLine = new RegExp(`^[ \\t]*!\\[[^\\]]*\\]\\(zk:draw/${safe}\\)[ \\t]*\\n?`, 'gm');
  const inline = new RegExp(`!\\[[^\\]]*\\]\\(zk:draw/${safe}\\)`, 'g');
  return body.replace(wholeLine, '').replace(inline, '');
}
