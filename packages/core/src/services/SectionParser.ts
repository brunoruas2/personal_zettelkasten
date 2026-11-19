/**
 * Seções de um corpo Markdown. Uma seção começa num cabeçalho `#`…`######` e
 * vai até o próximo cabeçalho de nível igual ou menor (subseções fazem parte
 * dela) ou até o fim. Cabeçalhos dentro de cercas de código não contam.
 * O parser equivalente em Go está em `internal/zettel/sections.go`, com os
 * mesmos casos de teste — mudou aqui, mude lá.
 */
export interface Section {
  /** Texto do cabeçalho, sem os `#`. */
  title: string;
  level: number;
  /** Conteúdo abaixo do cabeçalho (inclui subseções), aparado. */
  content: string;
}

const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

/** Chave de comparação de um título: sem caixa, espaços colapsados. */
export function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function parseSections(body: string): Section[] {
  const lines = body.split(/\r?\n/);
  const heads: { idx: number; level: number; title: string }[] = [];
  let fence: { ch: string; len: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const f = FENCE_RE.exec(line);
    if (f) {
      const ch = f[1][0];
      const len = f[1].length;
      if (!fence) {
        fence = { ch, len };
        continue;
      }
      // Fecha só com a mesma cerca, de tamanho igual ou maior, sem texto depois.
      if (ch === fence.ch && len >= fence.len && line.trim() === f[1].trim()) fence = null;
      continue;
    }
    if (fence) continue;
    const h = HEADING_RE.exec(line);
    if (h) heads.push({ idx: i, level: h[1].length, title: h[2].trim() });
  }
  return heads.map((h, n) => {
    let end = lines.length;
    for (let m = n + 1; m < heads.length; m++) {
      if (heads[m].level <= h.level) {
        end = heads[m].idx;
        break;
      }
    }
    return {
      title: h.title,
      level: h.level,
      content: lines.slice(h.idx + 1, end).join('\n').trim(),
    };
  });
}

/** Conteúdos não vazios das seções com este título, na ordem em que aparecem. */
function contentsOf(sections: Section[], key: string): string[] {
  return sections.filter((s) => normalizeTitle(s.title) === key && s.content !== '').map((s) => s.content);
}

/**
 * Títulos protegidos cujo conteúdo mudou entre o corpo anterior e o novo.
 * Seção ausente vale como conteúdo vazio, então um cabeçalho vazio (template)
 * não conta como mudança. Título repetido protege todas as ocorrências.
 */
export function changedProtectedSections(oldBody: string, newBody: string, protectedTitles: string[]): string[] {
  if (protectedTitles.length === 0) return [];
  const before = parseSections(oldBody);
  const after = parseSections(newBody);
  const changed: string[] = [];
  for (const title of protectedTitles) {
    const key = normalizeTitle(title);
    const a = contentsOf(before, key);
    const b = contentsOf(after, key);
    if (a.length !== b.length || a.some((c, i) => c !== b[i])) changed.push(title);
  }
  return changed;
}
