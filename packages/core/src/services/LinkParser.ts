// Matches [[any text]] or [[text|alias]]
const WIKI_LINK_REGEX = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;

export interface ParsedLink {
  raw: string;         // full match: [[target|alias]]
  target: string;      // the zettel title or id being referenced
  alias?: string;      // optional display text
  isParentRef: boolean; // true when written as [[^target]] — target is the parent
  index: number;       // position in the string
}

export function parseLinks(body: string): ParsedLink[] {
  const links: ParsedLink[] = [];
  let match: RegExpExecArray | null;

  WIKI_LINK_REGEX.lastIndex = 0;
  while ((match = WIKI_LINK_REGEX.exec(body)) !== null) {
    const rawTarget = match[1].trim();
    const isParentRef = rawTarget.startsWith('^');
    const target = isParentRef ? rawTarget.slice(1).trim() : rawTarget;
    links.push({
      raw: match[0],
      target,
      alias: match[2]?.trim(),
      isParentRef,
      index: match.index,
    });
  }

  return links;
}

/**
 * Detects if the cursor is inside an opening [[...
 * Returns the partial text typed so far, or null if not inside a link.
 */
export function detectLinkTrigger(text: string, cursorPos: number): string | null {
  const before = text.slice(0, cursorPos);
  const openIdx = before.lastIndexOf('[[');
  if (openIdx === -1) return null;

  const afterOpen = before.slice(openIdx + 2);
  // If there's a closing ]] before cursor, we're not inside a link
  if (afterOpen.includes(']]')) return null;

  return afterOpen;
}

/**
 * Replaces the current [[partial with [[title]] in the text.
 */
export function completeLinkInText(
  text: string,
  cursorPos: number,
  title: string,
): { newText: string; newCursorPos: number } {
  const before = text.slice(0, cursorPos);
  const openIdx = before.lastIndexOf('[[');
  const replacement = `[[${title}]]`;
  const newText = text.slice(0, openIdx) + replacement + text.slice(cursorPos);
  const newCursorPos = openIdx + replacement.length;
  return { newText, newCursorPos };
}
