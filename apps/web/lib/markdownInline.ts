// Groups: 1=wikiTarget 2=wikiLabel 3=bold 4=italic 5=code 6=strike 7=imgAlt 8=imgUrl 9=bareImgUrl 10=linkText 11=linkUrl 12=bareUrl 13=autolinkUrl 14=escapedChar
// O grupo 14 (`\` + pontuação ASCII, CommonMark) fica no fim para não renumerar os demais. Como
// o regex casa na posição mais à esquerda e o `\` precede o caractere escapado, o escape vence:
// `\*a\*` nunca abre itálico e `\[[x]]` nunca abre wiki link.
// O grupo 8 aceita http(s) e o scheme local zk:img/<id>. A alternância usa
// grupo NÃO-CAPTURANTE de propósito: capturar aqui deslocaria a numeração
// 1-13 acima e quebraria buildLineOffsetMap.
export const INLINE_RE =
  /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|~~(.+?)~~|!\[([^\]]*)\]\(((?:https?:\/\/|zk:img\/)[^)]+)\)|(https?:\/\/\S+\.(?:png|jpg|jpeg|gif|webp|svg)(?:[?#]\S*)?)|(?<!!)\[([^\]]+)\]\((https?:\/\/[^)]+)\)|(https?:\/\/[^\s<>"]+)|<(https?:\/\/[^>\s]+)>|\\([!-/:-@[-`{-~])/gi;

const ENTITY_NAMES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

// Escapes CommonMark e entidades em UMA passada: a saída de um não é reprocessada, então
// `&amp;lt;` vira `&lt;` e `\&lt;` mostra `&lt;` literal, como no CommonMark. O editor
// (prosemirror-markdown, html:false) emite os dois; o renderer não entendia nenhum.
const ESCAPE_OR_ENTITY_RE = /\\([!-/:-@[-`{-~])|&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi;

export function decodeText(s: string): string {
  if (!s.includes('\\') && !s.includes('&')) return s;
  return s.replace(ESCAPE_OR_ENTITY_RE, (whole, esc: string | undefined, ent: string | undefined) => {
    if (esc !== undefined) return esc;
    const e = ent!;
    if (e[0] !== '#') return ENTITY_NAMES[e.toLowerCase()];
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    // 0 e surrogates isolados não são caracteres válidos: deixa a entidade como escrita
    if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return whole;
    return String.fromCodePoint(code);
  });
}

/**
 * Maps each boundary position in the rendered (marker-free) text of a line
 * back to the corresponding offset in the raw markdown line.
 * map[k] = raw offset for rendered boundary k; map.length === renderedLength + 1.
 */
export function buildLineOffsetMap(line: string): number[] {
  const map: number[] = [0];
  let renderedLen = 0;
  let last = 0;
  INLINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;

  const pushPassthrough = (rawStart: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      renderedLen++;
      map[renderedLen] = rawStart + i + 1;
    }
  };

  while ((m = INLINE_RE.exec(line)) !== null) {
    if (m.index > last) {
      pushPassthrough(last, line.slice(last, m.index));
    }

    if (m[1] !== undefined) {
      // [[target]], [[target|label]], [[^target]] or [[^target|label]]
      const rawTarget = m[1];
      const isParentRef = rawTarget.startsWith('^');
      const target = isParentRef ? rawTarget.slice(1) : rawTarget;
      const label = m[2] ?? target;
      const caretLen = isParentRef ? 1 : 0;
      const labelRawStart = m[2] !== undefined
        ? m.index + 2 + caretLen + target.length + 1
        : m.index + 2 + caretLen;
      pushPassthrough(labelRawStart, label);
    } else if (m[3] !== undefined) {
      pushPassthrough(m.index + 2, m[3]);
    } else if (m[4] !== undefined) {
      pushPassthrough(m.index + 1, m[4]);
    } else if (m[5] !== undefined) {
      pushPassthrough(m.index + 1, m[5]);
    } else if (m[6] !== undefined) {
      pushPassthrough(m.index + 2, m[6]);
    } else if (m[8] !== undefined) {
      // ![alt](url) — renders as <img>, no selectable text
    } else if (m[9] !== undefined) {
      // bare image URL — renders as <img>, no selectable text
    } else if (m[10] !== undefined) {
      // [text](url)
      pushPassthrough(m.index + 1, m[10]);
    } else if (m[12] !== undefined) {
      // bare URL — label === raw text
      pushPassthrough(m.index, m[12]);
    } else if (m[13] !== undefined) {
      // <url> autolink — label === url, raw has surrounding < >
      pushPassthrough(m.index + 1, m[13]);
    }

    last = m.index + m[0].length;
  }

  if (last < line.length) {
    pushPassthrough(last, line.slice(last));
  }

  return map;
}
