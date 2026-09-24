import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

/**
 * Ponte entre o editor e o estado de "zettels embutidos" da página. Chega ao
 * plugin por ref (o TipTap cria as extensões uma vez só), então o plugin sempre
 * consulta o valor atual sem recriar o editor a cada digitação.
 */
export interface EmbedHoverBridge {
  /** Resolve o título de um `[[link]]` para um filho embutível. */
  resolve: (title: string) => { id: string } | undefined;
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
}

interface HoverRange {
  from: number;
  to: number;
  id: string;
}

const WIKI_RE = /\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g;
/** Tempo para o mouse ir do link até o botão sem que ele suma no caminho. */
const CLEAR_DELAY_MS = 300;

const pluginKey = new PluginKey<HoverRange | null>('embedHoverAction');

const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="12" x2="21" y2="12"/></svg>';

function findLinkAt(doc: PMNode, pos: number, bridge: EmbedHoverBridge): HoverRange | null {
  const $pos = doc.resolve(pos);
  const parent = $pos.parent;
  // Em code block `[[x]]` é código, não link.
  if (!parent.isTextblock || parent.type.spec.code) return null;
  const start = $pos.start();
  // Placeholder de 1 caractere para nós inline sem texto, para os offsets do
  // texto continuarem batendo com as posições do documento.
  const text = parent.textBetween(0, parent.content.size, '\n', '￼');
  const offset = pos - start;

  WIKI_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKI_RE.exec(text)) !== null) {
    const end = m.index + m[0].length;
    if (offset < m.index || offset > end) continue;
    const raw = m[1].trim();
    if (raw.startsWith('^')) return null; // link de pai nunca embute
    const child = bridge.resolve(raw);
    return child ? { from: start + m.index, to: start + end, id: child.id } : null;
  }
  return null;
}

function sameRange(a: HoverRange | null, b: HoverRange | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.from === b.from && a.to === b.to && a.id === b.id;
}

export function createEmbedHoverExtension(getBridge: () => EmbedHoverBridge | null) {
  return Extension.create({
    name: 'embedHoverAction',
    addProseMirrorPlugins() {
      let clearTimer: ReturnType<typeof setTimeout> | null = null;
      const cancelClear = () => {
        if (clearTimer) clearTimeout(clearTimer);
        clearTimer = null;
      };
      const setHover = (view: EditorView, next: HoverRange | null) => {
        view.dispatch(view.state.tr.setMeta(pluginKey, { hover: next }));
      };

      const buildButton = (view: EditorView, range: HoverRange): HTMLElement => {
        const bridge = getBridge();
        const open = bridge?.isOpen(range.id) ?? false;
        const wrap = document.createElement('span');
        wrap.className = 'relative inline-block h-[1em] w-0 align-middle';
        wrap.contentEditable = 'false';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('data-embed-action', '');
        const label = open ? 'Recolher zettel embutido' : 'Renderizar zettel aqui';
        btn.title = label;
        btn.setAttribute('aria-label', label);
        btn.setAttribute('aria-pressed', String(open));
        btn.className =
          'absolute left-1 top-1/2 z-10 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md border shadow-sm ' +
          (open
            ? 'border-brand bg-brand text-white'
            : 'border-zinc-300 bg-white text-zinc-500 hover:text-brand dark:border-zinc-600 dark:bg-zinc-800');
        btn.innerHTML = ICON;
        // Não rouba foco nem seleção do editor.
        btn.addEventListener('mousedown', (e) => e.preventDefault());
        btn.addEventListener('mouseenter', cancelClear);
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          getBridge()?.toggle(range.id);
          // A decoration só se recalcula numa transação; força uma para o botão
          // refletir o novo estado (a chave do widget inclui `open`). Adiado: o
          // React ainda não re-renderizou, e o `isOpen` do bridge ainda é o velho.
          cancelClear();
          setTimeout(() => {
            if (!view.isDestroyed) setHover(view, range);
          }, 0);
        });
        wrap.appendChild(btn);
        return wrap;
      };

      return [
        new Plugin<HoverRange | null>({
          key: pluginKey,
          state: {
            init: () => null,
            apply(tr, prev) {
              const meta = tr.getMeta(pluginKey) as { hover: HoverRange | null } | undefined;
              if (meta) return meta.hover;
              // Editar o texto invalida os offsets guardados.
              return tr.docChanged ? null : prev;
            },
          },
          props: {
            decorations(state) {
              const hover = pluginKey.getState(state);
              const bridge = getBridge();
              if (!hover || !bridge) return DecorationSet.empty;
              const open = bridge.isOpen(hover.id);
              return DecorationSet.create(state.doc, [
                Decoration.widget(hover.to, (view) => buildButton(view, hover), {
                  side: 1,
                  ignoreSelection: true,
                  stopEvent: () => true,
                  key: `embed-${hover.from}-${hover.to}-${hover.id}-${open ? 1 : 0}`,
                }),
              ]);
            },
            handleDOMEvents: {
              mousemove(view, event) {
                const bridge = getBridge();
                if (!bridge) return false;
                if ((event.target as HTMLElement | null)?.closest?.('[data-embed-action]')) {
                  cancelClear();
                  return false;
                }
                const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
                const next = coords ? findLinkAt(view.state.doc, coords.pos, bridge) : null;
                const prev = pluginKey.getState(view.state) ?? null;
                if (next) {
                  cancelClear();
                  if (!sameRange(prev, next)) setHover(view, next);
                } else if (prev && !clearTimer) {
                  clearTimer = setTimeout(() => {
                    clearTimer = null;
                    setHover(view, null);
                  }, CLEAR_DELAY_MS);
                }
                return false;
              },
              mouseleave(view, event) {
                // Saindo do editor para o próprio botão não conta como sair.
                const to = (event as MouseEvent).relatedTarget as HTMLElement | null;
                if (to?.closest?.('[data-embed-action]')) return false;
                if (!pluginKey.getState(view.state) || clearTimer) return false;
                clearTimer = setTimeout(() => {
                  clearTimer = null;
                  setHover(view, null);
                }, CLEAR_DELAY_MS);
                return false;
              },
            },
          },
          view() {
            return { destroy: cancelClear };
          },
        }),
      ];
    },
  });
}
