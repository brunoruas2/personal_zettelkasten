/**
 * Primeira linha significativa do corpo, para a silhueta da galáxia.
 *
 * É a primeira linha não vazia depois de tirar marcadores de título, lista,
 * citação e tarefa e a sintaxe inline (`[[link]]`, `**negrito**`, imagens…),
 * ignorando a linha que só repete o título. Cercas de código e diagramas não
 * contam: o texto de dentro não é prosa. Puro, sem browser.
 */

export const FIRST_LINE_MAX = 90;

const FENCE = /^\s*(```|~~~)/;
// Imagem/desenho não tem texto; link `[rótulo](url)` fica com o rótulo.
const IMAGE = /!\[[^\]]*\]\([^)]*\)/g;
const MD_LINK = /\[([^\]]*)\]\([^)]*\)/g;
const WIKI = /\[\[\^?([^\]|]*)(?:\|([^\]]*))?\]\]/g;
const INLINE_MARKS = /(\*\*|__|~~|\*|`)/g;
const BLOCK_PREFIX = /^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)+/;

function plain(line: string): string {
  return line
    .replace(IMAGE, '')
    .replace(WIKI, (_, target: string, label?: string) => label || target)
    .replace(MD_LINK, '$1')
    .replace(INLINE_MARKS, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const norm = (s: string) => s.trim().toLowerCase();

export function firstLine(body: string, title = ''): string {
  const sameAsTitle = norm(title);
  let inFence = false;
  for (const raw of body.split('\n')) {
    if (FENCE.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const text = plain(raw.replace(BLOCK_PREFIX, ''));
    if (!text) continue;
    if (sameAsTitle && norm(text) === sameAsTitle) continue;
    return text.length > FIRST_LINE_MAX ? text.slice(0, FIRST_LINE_MAX - 1).trimEnd() + '…' : text;
  }
  return '';
}
