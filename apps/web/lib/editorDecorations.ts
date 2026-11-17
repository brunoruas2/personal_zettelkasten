// Decorations do TipTap que aproximam o editor da leitura (MarkdownRenderer):
// wiki links, links markdown e URLs soltas pintados como link (com botão de
// abrir no hover) e blocos de código com syntax highlight.
// Só visual — nada aqui altera o documento nem o markdown serializado.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { highlightTokens, type HighlightToken } from './hljs';
import { chordRanges } from './chordSyntax';

// ── Links: wiki, markdown e URL solta ─────────────────────────────────────────

// Mesma forma do grupo 1/2 do INLINE_RE (lib/markdownInline.ts), sem cruzar linha.
const WIKI_RE = /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g;
// `[rótulo](http(s)://…)`. O editor guarda o link como texto puro (sem link mark —
// ver escapeMarkdownLinksForParse no TipTapEditor), então só a pintura o reconhece.
// `![alt](src)` fica de fora pelo lookbehind.
const MD_LINK_RE = /(?<![!\[])\[([^\[\]\n]+)\]\((https?:\/\/[^)\s]+)\)/gi;
// URL solta; pontuação final e `)` sem par são recortados em trimUrl.
const BARE_URL_RE = /https?:\/\/[^\s<>"\[\]]+/gi;
const HTTP_RE = /^https?:\/\/\S+$/i;

type ZkLink = { kind: 'wiki'; target: string } | { kind: 'url'; href: string };

interface LinkSpec {
  zkLink: ZkLink;
}

function trimUrl(url: string): string {
  let u = url;
  while (u.length > 0) {
    const last = u[u.length - 1];
    if (/[.,;:!?'"]/.test(last)) {
      u = u.slice(0, -1);
      continue;
    }
    if (last === ')') {
      const open = u.split('(').length - 1;
      const close = u.split(')').length - 1;
      if (close > open) {
        u = u.slice(0, -1);
        continue;
      }
    }
    break;
  }
  return u;
}

function linkDecorations(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (node.type.spec.code) return false;
    // Texto do bloco com offsets → posição no doc. Nó inline que não é texto
    // vira U+FFFC (ocupa 1 posição, nunca casa com o regex do link).
    let text = '';
    const taken: Array<[number, number]> = [];
    node.forEach((child) => {
      const at = text.length;
      if (child.isText) {
        text += child.text ?? '';
        if (child.marks.some((m) => m.type.name === 'code')) taken.push([at, text.length]);
      } else text += '￼';
    });
    // offset do texto → posição: texto e nós ocupam o mesmo tamanho, então
    // pos + 1 + índice no texto é a posição absoluta.
    const base = pos + 1;
    // Intervalos já usados (código, link anterior): wiki → markdown → URL solta.
    const free = (a: number, b: number) => !taken.some(([x, y]) => a < y && b > x);
    const push = (from: number, to: number, link: ZkLink, syntax: Array<[number, number]>) => {
      taken.push([from, to]);
      const spec: LinkSpec = { zkLink: link };
      const cls = link.kind === 'wiki' ? 'zk-wikilink' : 'zk-wikilink zk-extlink';
      decos.push(Decoration.inline(base + from, base + to, { class: cls, 'data-zk-link': link.kind }, spec));
      for (const [a, b] of syntax) {
        if (b > a) decos.push(Decoration.inline(base + a, base + b, { class: 'zk-wikilink-syntax' }));
      }
    };

    let m: RegExpExecArray | null;
    WIKI_RE.lastIndex = 0;
    while ((m = WIKI_RE.exec(text)) !== null) {
      const from = m.index;
      const to = from + m[0].length;
      if (!free(from, to)) continue;
      const raw = m[1];
      const target = (raw.startsWith('^') ? raw.slice(1) : raw).trim();
      if (!target) continue;
      // Sintaxe esmaecida: `[[` (+ `alvo|` quando há rótulo) e `]]`.
      const openEnd = m[2] !== undefined ? from + 2 + raw.length + 1 : from + 2;
      push(from, to, { kind: 'wiki', target }, [
        [from, openEnd],
        [to - 2, to],
      ]);
    }

    MD_LINK_RE.lastIndex = 0;
    while ((m = MD_LINK_RE.exec(text)) !== null) {
      const from = m.index;
      const to = from + m[0].length;
      if (!free(from, to)) continue;
      const labelEnd = from + 1 + m[1].length;
      // Sintaxe esmaecida: `[` e `](url)`.
      push(from, to, { kind: 'url', href: m[2] }, [
        [from, from + 1],
        [labelEnd, to],
      ]);
    }

    BARE_URL_RE.lastIndex = 0;
    while ((m = BARE_URL_RE.exec(text)) !== null) {
      const href = trimUrl(m[0]);
      if (!HTTP_RE.test(href) || /^https?:\/\/$/i.test(href)) continue;
      const from = m.index;
      const to = from + href.length;
      if (!free(from, to)) continue;
      push(from, to, { kind: 'url', href }, []);
    }
    return false;
  });
  return DecorationSet.create(doc, decos);
}

const linkKey = new PluginKey<DecorationSet>('zkWikiLinkDecorations');

function linkAt(state: EditorState, pos: number): Decoration | null {
  const set = linkKey.getState(state);
  if (!set) return null;
  const hit = set.find(pos, pos, (spec: Partial<LinkSpec>) => spec.zkLink !== undefined);
  return hit[0] ?? null;
}

/** Abre uma URL externa numa nova aba, sem acesso à janela de origem. Só http(s). */
export function openExternal(href: string): void {
  if (!HTTP_RE.test(href)) return;
  window.open(href, '_blank', 'noopener,noreferrer');
}

type GetOpen = () => ((title: string) => void) | undefined;

/** Executa o link: wiki → `getOpen()` (false se não houver), url → nova aba. */
function activate(link: ZkLink, getOpen: GetOpen): boolean {
  if (link.kind === 'url') {
    openExternal(link.href);
    return true;
  }
  const open = getOpen();
  if (!open) return false;
  open(link.target);
  return true;
}

const SHOW_DELAY = 300;
const HIDE_DELAY = 200;

/**
 * Botão "abrir ↗" que aparece ao parar o mouse sobre um link pintado. Um só
 * elemento imperativo em `document.body` (sem estado React por mousemove).
 * Só aparece com mouse; passar o mouse não abre nada.
 */
class LinkHoverView {
  private btn: HTMLButtonElement;
  private mq: MediaQueryList | null;
  private current: { key: string; link: ZkLink } | null = null;
  private pendingKey: string | null = null;
  private showTimer: ReturnType<typeof setTimeout> | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private view: EditorView,
    private getOpen: GetOpen,
  ) {
    this.mq = typeof window.matchMedia === 'function' ? window.matchMedia('(hover: hover) and (pointer: fine)') : null;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'zk-link-hover';
    btn.contentEditable = 'false';
    btn.textContent = 'abrir ↗';
    btn.style.display = 'none';
    btn.addEventListener('mousedown', this.onBtnMouseDown);
    btn.addEventListener('click', this.onBtnClick);
    btn.addEventListener('mouseenter', this.cancelHide);
    btn.addEventListener('mouseleave', this.scheduleHide);
    document.body.appendChild(btn);
    this.btn = btn;
    view.dom.addEventListener('mousemove', this.onMove);
    view.dom.addEventListener('mouseleave', this.onLeave);
    window.addEventListener('keydown', this.hide, true);
    window.addEventListener('scroll', this.hide, true);
  }

  update(view: EditorView, prev: EditorState) {
    this.view = view;
    if (view.state.doc !== prev.doc) this.hide();
  }

  destroy() {
    this.clearTimers();
    this.view.dom.removeEventListener('mousemove', this.onMove);
    this.view.dom.removeEventListener('mouseleave', this.onLeave);
    window.removeEventListener('keydown', this.hide, true);
    window.removeEventListener('scroll', this.hide, true);
    this.btn.remove();
  }

  private clearTimers() {
    if (this.showTimer) clearTimeout(this.showTimer);
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.showTimer = null;
    this.hideTimer = null;
  }

  private cancelHide = () => {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = null;
  };

  private scheduleHide = () => {
    if (this.showTimer) clearTimeout(this.showTimer);
    this.showTimer = null;
    this.pendingKey = null;
    if (!this.current || this.hideTimer) return;
    this.hideTimer = setTimeout(this.hide, HIDE_DELAY);
  };

  private hide = () => {
    this.clearTimers();
    this.pendingKey = null;
    this.current = null;
    this.btn.style.display = 'none';
  };

  private onLeave = (e: MouseEvent) => {
    if (e.relatedTarget === this.btn) return;
    this.scheduleHide();
  };

  private onMove = (e: MouseEvent) => {
    if (!this.mq?.matches || e.buttons !== 0) return;
    const el = e.target instanceof Element ? e.target.closest('[data-zk-link]') : null;
    if (!el || !this.view.dom.contains(el)) return this.scheduleHide();
    const at = this.view.posAtCoords({ left: e.clientX, top: e.clientY });
    const deco = at ? linkAt(this.view.state, at.pos) : null;
    if (!deco) return this.scheduleHide();
    const link = (deco.spec as LinkSpec).zkLink;
    if (link.kind === 'wiki' && !this.getOpen()) return this.scheduleHide();
    const key = `${deco.from}:${deco.to}`;
    if (this.current?.key === key) return this.cancelHide();
    if (this.pendingKey === key) return;
    this.clearTimers();
    this.pendingKey = key;
    // Retângulo da linha do link sob o ponteiro (link quebrado em várias linhas).
    const rects = Array.from(el.getClientRects());
    const rect = rects.find((r) => e.clientY >= r.top && e.clientY <= r.bottom) ?? el.getBoundingClientRect();
    const x = e.clientX;
    this.showTimer = setTimeout(() => this.show(key, link, rect, x), SHOW_DELAY);
  };

  private show(key: string, link: ZkLink, rect: DOMRect, x: number) {
    this.showTimer = null;
    this.pendingKey = null;
    this.current = { key, link };
    const btn = this.btn;
    const label = link.kind === 'wiki' ? `Abrir «${link.target}»` : `Abrir ${link.href}`;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.classList.toggle('zk-link-hover--zkos', this.view.dom.closest('.zk-edit') !== null);
    btn.style.display = 'block';
    const w = btn.offsetWidth;
    const h = btn.offsetHeight;
    const left = Math.min(Math.max(4, x - w / 2), window.innerWidth - w - 4);
    const top = rect.top - h - 4 >= 4 ? rect.top - h - 4 : rect.bottom + 4;
    btn.style.left = `${left}px`;
    btn.style.top = `${top}px`;
  }

  // Não tira o foco nem a seleção do editor.
  private onBtnMouseDown = (e: MouseEvent) => e.preventDefault();

  private onBtnClick = (e: MouseEvent) => {
    e.preventDefault();
    const link = this.current?.link;
    this.hide();
    if (link) activate(link, this.getOpen);
  };
}

/**
 * Pinta `[[link]]`, `[rótulo](http(s)://…)` e URLs soltas como na leitura.
 * Ctrl/⌘+clique (ou o botão "abrir ↗" do hover) abre: wiki link chama `getOpen()`
 * com o título do alvo (`^` de link-pai removido, rótulo `|x` ignorado); link
 * externo abre numa nova aba.
 */
export function createWikiLinkDecorations(getOpen: GetOpen) {
  return Extension.create({
    name: 'zkWikiLinkDecorations',
    addProseMirrorPlugins() {
      return [
        new Plugin<DecorationSet>({
          key: linkKey,
          state: {
            init: (_, state) => linkDecorations(state.doc),
            apply: (tr, old) => (tr.docChanged ? linkDecorations(tr.doc) : old),
          },
          view: (view) => new LinkHoverView(view, getOpen),
          props: {
            decorations: (state) => linkKey.getState(state),
            handleClick: (view, pos, event) => {
              if (!(event.ctrlKey || event.metaKey)) return false;
              const deco = linkAt(view.state, pos);
              if (!deco) return false;
              if (!activate((deco.spec as LinkSpec).zkLink, getOpen)) return false;
              event.preventDefault();
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

// ── Cifra (```chords) ─────────────────────────────────────────────────────────

// Cache por texto do bloco: digitar numa cifra não refaz as outras.
const CHORD_CACHE_MAX = 32;
const chordCache = new Map<string, Array<[number, number]>>();

function cachedChordRanges(text: string): Array<[number, number]> {
  const hit = chordCache.get(text);
  if (hit) {
    chordCache.delete(text);
    chordCache.set(text, hit);
    return hit;
  }
  const ranges = chordRanges(text);
  chordCache.set(text, ranges);
  if (chordCache.size > CHORD_CACHE_MAX) chordCache.delete(chordCache.keys().next().value as string);
  return ranges;
}

function chordDecorations(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return true;
    if (String(node.attrs.language ?? '').trim().toLowerCase() !== 'chords') return false;
    const base = pos + 1;
    for (const [from, to] of cachedChordRanges(node.textContent)) {
      if (to > from) decos.push(Decoration.inline(base + from, base + to, { class: 'zk-chord' }));
    }
    return false;
  });
  return DecorationSet.create(doc, decos);
}

const chordKey = new PluginKey<DecorationSet>('zkChordDecorations');

/**
 * Pinta acordes (linha de acorde inteira ou `[Am]` inline válido) dos blocos
 * ` ```chords ` com `.zk-chord`. Só o ZK//OS estiliza a classe (`zkos.css`).
 */
export function createChordDecorations() {
  return Extension.create({
    name: 'zkChordDecorations',
    addProseMirrorPlugins() {
      return [
        new Plugin<DecorationSet>({
          key: chordKey,
          state: {
            init: (_, state) => chordDecorations(state.doc),
            apply: (tr, old) => (tr.docChanged ? chordDecorations(tr.doc) : old),
          },
          props: {
            decorations: (state) => chordKey.getState(state),
          },
        }),
      ];
    },
  });
}
