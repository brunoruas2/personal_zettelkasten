import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { extractPlainWikiTitles } from '@zettelkasten/core';
import type { EmbedHoverBridge } from './embedHoverExtension';

/**
 * Modo Editar: ancora o slot de cada filho aberto logo depois do parágrafo que
 * contém a primeira referência a ele. O widget é só o ponto de ancoragem (um
 * `<div>` vazio registrado no `EmbedSlotRegistry`); a faixa em si é movida para
 * dentro dele por `useEmbedHosts`, então nada de React vive no DOM do
 * ProseMirror e o documento nunca é alterado.
 *
 * As decorations são recalculadas a cada estado novo do editor. O TipTapEditor
 * força uma transação vazia quando o `bridge` muda (abrir/fechar um filho), que é
 * o que leva o plugin a se reavaliar sem o texto ter mudado.
 */
export function createEmbedSlotExtension(getBridge: () => EmbedHoverBridge | null) {
  return Extension.create({
    name: 'embedSlots',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey('embedSlots'),
          props: {
            decorations(state) {
              const bridge = getBridge();
              if (!bridge) return DecorationSet.empty;

              const decorations: Decoration[] = [];
              const seen = new Set<string>();

              state.doc.descendants((node, pos) => {
                if (!node.isTextblock) return true;
                if (node.type.spec.code) return false;

                const text = node.textBetween(0, node.content.size, '\n', '￼');
                const titles = extractPlainWikiTitles(text);
                if (titles.length === 0) return false;

                // Depois do parágrafo; em tabela, depois da tabela inteira — uma
                // faixa larga dentro de uma célula estouraria a coluna.
                let boundary = pos + node.nodeSize;
                const $pos = state.doc.resolve(pos);
                for (let d = $pos.depth; d > 0; d--) {
                  if ($pos.node(d).type.name === 'table') {
                    boundary = $pos.after(d);
                    break;
                  }
                }

                for (const title of titles) {
                  const child = bridge.resolve(title);
                  if (!child || seen.has(child.id)) continue;
                  seen.add(child.id); // a primeira referência decide, aberto ou não
                  if (!bridge.isOpen(child.id)) continue;

                  const id = child.id;
                  decorations.push(
                    Decoration.widget(
                      boundary,
                      () => {
                        const el = document.createElement('div');
                        el.contentEditable = 'false';
                        el.setAttribute('data-embed-slot', '');
                        bridge.registry.register('edit', id, el);
                        return el;
                      },
                      {
                        side: 1,
                        // Chave estável por filho: o ProseMirror reaproveita o DOM
                        // do widget quando o texto ao redor muda.
                        key: `embed-slot-${id}`,
                        ignoreSelection: true,
                        // Os eventos do formulário do filho não são do editor do pai.
                        stopEvent: () => true,
                        destroy: (dom) => bridge.registry.unregister('edit', id, dom as HTMLElement),
                      },
                    ),
                  );
                }
                return false;
              });

              return DecorationSet.create(state.doc, decorations);
            },
          },
        }),
      ];
    },
  });
}
