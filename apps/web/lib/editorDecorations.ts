// Decorations do TipTap que aproximam o editor da leitura (MarkdownRenderer):
// wiki links pintados como link e blocos de código com syntax highlight.
// Só visual — nada aqui altera o documento nem o markdown serializado.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { highlightTokens, type HighlightToken } from './hljs';

// ── Wiki links ────────────────────────────────────────────────────────────────

// Mesma forma do grupo 1/2 do INLINE_RE (lib/markdownInline.ts), sem cruzar linha.
const WIKI_RE = /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g;

interface WikiSpec {
  wikiTarget: string;
}

function wikiDecorations(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (node.type.spec.code) return false;
    // Texto do bloco com offsets → posição no doc. Nó inline que não é texto
    // vira U+FFFC (ocupa 1 posição, nunca casa com o regex do link).
    let text = '';
    const codeRanges: Array<[number, number]> = [];
    node.forEach((child) => {
      const at = text.length;
      if (child.isText) {
        text += child.text ?? '';
        if (child.marks.some((m) => m.type.name === 'code')) codeRanges.push([at, text.length]);
      } else text += '￼';
    });
    // offset do texto → posição: texto e nós ocupam o mesmo tamanho, então
    // pos + 1 + índice no texto é a posição absoluta.
    const base = pos + 1;
    WIKI_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WIKI_RE.exec(text)) !== null) {
      const from = m.index;
      const to = from + m[0].length;
      if (codeRanges.some(([a, b]) => from < b && to > a)) continue;
      const raw = m[1];
      const target = (raw.startsWith('^') ? raw.slice(1) : raw).trim();
      if (!target) continue;
      const spec: WikiSpec = { wikiTarget: target };
      decos.push(
        Decoration.inline(base + from, base + to, { class: 'zk-wikilink', title: 'Ctrl/⌘+clique para abrir' }, spec),
      );
      // Sintaxe esmaecida: `[[` (+ `alvo|` quando há rótulo) e `]]`.
      const openEnd = m[2] !== undefined ? from + 2 + raw.length + 1 : from + 2;
      decos.push(Decoration.inline(base + from, base + openEnd, { class: 'zk-wikilink-syntax' }));
      decos.push(Decoration.inline(base + to - 2, base + to, { class: 'zk-wikilink-syntax' }));
    }
    return false;
  });
  return DecorationSet.create(doc, decos);
}

const wikiKey = new PluginKey<DecorationSet>('zkWikiLinkDecorations');

function wikiTargetAt(state: EditorState, pos: number): string | null {
  const set = wikiKey.getState(state);
  if (!set) return null;
  const hit = set.find(pos, pos, (spec: Partial<WikiSpec>) => typeof spec.wikiTarget === 'string');
  return hit.length > 0 ? (hit[0].spec as WikiSpec).wikiTarget : null;
}

/**
 * Pinta `[[link]]` como na leitura; Ctrl/⌘+clique chama `getOpen()` com o
 * título do alvo (`^` de link-pai removido, rótulo `|x` ignorado).
 */
export function createWikiLinkDecorations(getOpen: () => ((title: string) => void) | undefined) {
  return Extension.create({
    name: 'zkWikiLinkDecorations',
    addProseMirrorPlugins() {
      return [
        new Plugin<DecorationSet>({
          key: wikiKey,
          state: {
            init: (_, state) => wikiDecorations(state.doc),
            apply: (tr, old) => (tr.docChanged ? wikiDecorations(tr.doc) : old),
          },
          props: {
            decorations: (state) => wikiKey.getState(state),
            handleClick: (view, pos, event) => {
              if (!(event.ctrlKey || event.metaKey)) return false;
              const open = getOpen();
              if (!open) return false;
              const target = wikiTargetAt(view.state, pos);
              if (!target) return false;
              event.preventDefault();
              open(target);
              return true;
            },
          },
        }),
      ];
    },
  });
}

// ── Syntax highlight em blocos de código ──────────────────────────────────────

// Cache por (linguagem, código): digitar num bloco não refaz os outros.
const TOKEN_CACHE_MAX = 64;
const tokenCache = new Map<string, HighlightToken[] | null>();

function cachedTokens(code: string, lang: string): HighlightToken[] | null {
  const key = `${lang}\u0000${code}`;
  const hit = tokenCache.get(key);
  if (hit !== undefined) {
    tokenCache.delete(key);
    tokenCache.set(key, hit);
    return hit;
  }
  const tokens = highlightTokens(code, lang);
  tokenCache.set(key, tokens);
  if (tokenCache.size > TOKEN_CACHE_MAX) tokenCache.delete(tokenCache.keys().next().value as string);
  return tokens;
}

function codeDecorations(doc: PMNode, skip: readonly string[]): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return true;
    const lang = String(node.attrs.language ?? '').trim().toLowerCase();
    if (!lang || skip.includes(lang)) return false;
    const tokens = cachedTokens(node.textContent, lang);
    if (!tokens) return false;
    const base = pos + 1;
    for (const t of tokens) decos.push(Decoration.inline(base + t.from, base + t.to, { class: t.className }));
    return false;
  });
  return DecorationSet.create(doc, decos);
}

const codeKey = new PluginKey<DecorationSet>('zkCodeHighlight');

/**
 * Highlight.js nos blocos de código, com as mesmas classes `hljs-*` da leitura.
 * `skip`: linguagens com render próprio (diagramas, cifras, partituras).
 */
export function createCodeHighlight(skip: readonly string[]) {
  return Extension.create({
    name: 'zkCodeHighlight',
    addProseMirrorPlugins() {
      return [
        new Plugin<DecorationSet>({
          key: codeKey,
          state: {
            init: (_, state) => codeDecorations(state.doc, skip),
            apply: (tr, old) => (tr.docChanged ? codeDecorations(tr.doc, skip) : old),
          },
          props: {
            decorations: (state) => codeKey.getState(state),
          },
        }),
      ];
    },
  });
}
