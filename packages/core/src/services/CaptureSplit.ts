import { firstLine } from './FirstLine';

/**
 * Divide o texto da captura rápida em título e corpo: a 1ª linha não vazia
 * vira o título (sem marcadores nem sintaxe inline, máx. `FIRST_LINE_MAX`) e o
 * resto vira o corpo. Se o título foi truncado, ou a linha não rende texto
 * (só imagem, por exemplo), o corpo é o texto inteiro — nada se perde. Puro.
 */
export function splitCapture(text: string): { title: string; body: string } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const first = lines.findIndex((l) => l.trim() !== '');
  if (first < 0) return { title: '', body: '' };

  const full = lines.slice(first).join('\n').trim();
  const title = firstLine(lines[first]);
  if (!title || title.endsWith('…')) return { title, body: full };

  const rest = lines.slice(first + 1).join('\n').replace(/^\s*\n/, '').trim();
  return { title, body: rest };
}
