'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import ReactDOM from 'react-dom';
import { useEditor, EditorContent, type Editor, ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import CodeBlockExtension from '@tiptap/extension-code-block';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import Image from '@tiptap/extension-image';
import Paragraph from '@tiptap/extension-paragraph';
import { Markdown } from 'tiptap-markdown';
import Suggestion, {
  type SuggestionKeyDownProps,
  type SuggestionProps,
} from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import type { Slice } from '@tiptap/pm/model';
import type { Zettel } from '@zettelkasten/core';
import { PlantUmlBlock } from './PlantUmlBlock';
import { isImageFile, ImageCompressError } from '../lib/imageCompress';
import { importImage, ImageUploadError } from '../lib/imageSync';
import { ZK_IMG_PREFIX } from './ZettelImage';

// ── Types ─────────────────────────────────────────────────────────────────────

// When the doc's first node is a non-paragraph leaf textblock (e.g. a
// codeBlock inserted via /diagrama as the very first thing in a body),
// there is no ProseMirror position "before" it — clicking above it or
// pressing ArrowUp from inside it both resolve to pos 1 (its own
// start). These give the user an escape hatch to add a line above it,
// shared by the ArrowUp keyboard shortcut and the mobile toolbar button.
export function canEscapeLeadingBlock(editor: Editor | null): boolean {
  if (!editor) return false;
  const { selection, doc } = editor.state;
  if (!selection.empty) return false;
  const { $from } = selection;
  if ($from.pos !== 1 || $from.depth !== 1) return false;
  const firstNode = doc.firstChild;
  return !!firstNode && firstNode.type.name !== 'paragraph';
}

export function escapeLeadingBlock(editor: Editor): boolean {
  return editor.chain().insertContentAt(0, { type: 'paragraph' }).setTextSelection(1).run();
}

export interface TipTapEditorHandle {
  focus: () => void;
  focusEnd: () => void;
  insertCodeBlock: (language: string, template?: string) => void;
  /** Abre o seletor de arquivos de imagem (usado pela toolbar mobile). */
  pickImages: () => void;
}

interface Props {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
  spellCheck?: boolean;
  fontSize?: number;
  zettels?: Zettel[];
  onEditorReady?: (editor: Editor) => void;
  onExtract?: (selectedText: string, range: { from: number; to: number }) => void;
  /** Quantas imagens estão comprimindo ou com upload em voo. Usado para travar o Salvar. */
  onPendingImagesChange?: (count: number) => void;
}

interface WikiPopupState {
  items: Zettel[];
  command: (zettel: Zettel) => void;
  clientRect: (() => DOMRect | null) | null | undefined;
}

interface SlashCommand {
  id: string;
  label: string;
  description: string;
  icon: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { id: 'diagrama', label: 'Diagrama', description: 'Bloco PlantUML', icon: '◈' },
  { id: 'cifra', label: 'Cifra', description: 'Bloco de cifra musical', icon: '♪' },
  { id: 'partitura', label: 'Partitura', description: 'Bloco ABC notation', icon: '♩' },
  { id: 'link', label: 'Link', description: 'Wiki link [[...]]', icon: '⟦⟧' },
  { id: 'tabela', label: 'Tabela', description: 'Insere tabela vazia', icon: '⊞' },
  { id: 'codigo', label: 'Código', description: 'Bloco de código genérico', icon: '{}' },
  { id: 'imagem', label: 'Imagem', description: 'Importa imagem do dispositivo', icon: '🖼' },
];

interface SlashPopupState {
  items: SlashCommand[];
  command: (cmd: SlashCommand) => void;
  clientRect: (() => DOMRect | null) | null | undefined;
}

// ── WikiLinkPopup ─────────────────────────────────────────────────────────────

interface WikiPopupHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

const WikiLinkPopup = forwardRef<WikiPopupHandle, WikiPopupState>(
  function WikiLinkPopup({ items, command, clientRect }, ref) {
    const [activeIndex, setActiveIndex] = useState(0);
    const activeIndexRef = useRef(0);

    useEffect(() => { setActiveIndex(0); }, [items]);
    useEffect(() => { activeIndexRef.current = activeIndex; }, [activeIndex]);

    useImperativeHandle(ref, () => ({
      onKeyDown({ event }) {
        const len = items.length;
        if (event.key === 'ArrowDown') {
          setActiveIndex((i) => Math.min(i + 1, len - 1));
          return true;
        }
        if (event.key === 'ArrowUp') {
          setActiveIndex((i) => Math.max(i - 1, 0));
          return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          const item = items[activeIndexRef.current];
          if (item) { command(item); return true; }
        }
        if (event.key === 'Escape') return true;
        return false;
      },
    }), [items, command]);

    const rect = clientRect?.();
    if (!rect || items.length === 0) return null;

    return ReactDOM.createPortal(
      <div
        style={{ position: 'fixed', top: rect.bottom + 4, left: rect.left, zIndex: 9999 }}
        className="min-w-[220px] max-h-64 overflow-y-auto rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
      >
        {items.map((zettel, i) => (
          <button
            key={zettel.id}
            onClick={() => command(zettel)}
            className={`w-full px-3 py-2 text-left text-sm truncate transition-colors ${
              i === activeIndex
                ? 'bg-brand/10 text-brand'
                : 'text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800'
            }`}
          >
            {zettel.title}
          </button>
        ))}
      </div>,
      document.body,
    );
  },
);

// ── SlashCommandPopup ─────────────────────────────────────────────────────────

interface SlashPopupHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

const SlashCommandPopup = forwardRef<SlashPopupHandle, SlashPopupState>(
  function SlashCommandPopup({ items, command, clientRect }, ref) {
    const [activeIndex, setActiveIndex] = useState(0);
    const activeIndexRef = useRef(0);

    useEffect(() => { setActiveIndex(0); }, [items]);
    useEffect(() => { activeIndexRef.current = activeIndex; }, [activeIndex]);

    useImperativeHandle(ref, () => ({
      onKeyDown({ event }) {
        const len = items.length;
        if (event.key === 'ArrowDown') {
          setActiveIndex((i) => Math.min(i + 1, len - 1));
          return true;
        }
        if (event.key === 'ArrowUp') {
          setActiveIndex((i) => Math.max(i - 1, 0));
          return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          const item = items[activeIndexRef.current];
          if (item) { command(item); return true; }
        }
        if (event.key === 'Escape') return true;
        return false;
      },
    }), [items, command]);

    const rect = clientRect?.();
    if (!rect || items.length === 0) return null;

    return ReactDOM.createPortal(
      <div
        style={{ position: 'fixed', top: rect.bottom + 4, left: rect.left, zIndex: 9999 }}
        className="min-w-[220px] rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
      >
        {items.map((cmd, i) => (
          <button
            key={cmd.id}
            onClick={() => command(cmd)}
            className={`w-full flex items-center gap-3 px-3 py-2 text-left text-sm transition-colors ${
              i === activeIndex
                ? 'bg-brand/10 text-brand'
                : 'text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800'
            }`}
          >
            <span className="text-base w-5 text-center shrink-0">{cmd.icon}</span>
            <span className="flex flex-col">
              <span className="font-medium">{cmd.label}</span>
              <span className="text-xs text-zinc-400">{cmd.description}</span>
            </span>
          </button>
        ))}
      </div>,
      document.body,
    );
  },
);

// tiptap-markdown escapes [ as \[ when serializing; this restores [[wiki links]]
function normalizeWikiLinks(md: string): string {
  return md.replace(/\\\[\\\[([^\n]*?)\\\]\\\]/g, '[[$1]]');
}

// ProseMirror serializes bare URLs as <url> (CommonMark autolink); strip the angle brackets
function normalizeAutolinks(md: string): string {
  return md.replace(/<(https?:\/\/[^>\s]+)>/g, '$1');
}

// tiptap-markdown escapes literal * as \* when serializing; this restores it
function normalizeAsterisks(md: string): string {
  return md.replace(/\\\*/g, '*');
}

// tiptap-markdown escapes [label](url) typed as literal text (no Link mark) as \[label\](url) or \[label\]\(url\); this restores it
function normalizeMarkdownLinks(md: string): string {
  return md.replace(/\\\[([^\]\n]+)\\\]\\?\(([^)\n]+?)\\?\)/g, '[$1]($2)');
}

// inverse of normalizeMarkdownLinks: escapes real [label](url) before it reaches markdown-it,
// so the parser treats it as inert text instead of emitting <a> (the schema has no link mark
// to receive it — see TipTapEditor design doc for fix-tiptap-link-url-loss). Skips [[wiki links]]
// and ![alt](src): the schema DOES have an image node, so escaping images would turn them into
// inert text and they would stop rendering.
function escapeMarkdownLinksForParse(md: string): string {
  return md.replace(/(?<![[!])\[([^[\]\n]+)\]\(([^)\n]+?)\)(?!\])/g, '\\[$1\\]($2)');
}

// ── Code block clipboard ──────────────────────────────────────────────────────

// tiptap-markdown's transformCopiedText replaces the clipboard's text/plain with
// the Markdown serialization of the copied slice — which wraps a codeBlock in
// ``` fences. ProseMirror pastes text/plain verbatim when the target is a code
// context, so copying a line inside a ```plantuml block and pasting it back into
// the same block injected the fences. These two helpers keep code slices raw.
function isCodeOnlySlice(slice: Slice): boolean {
  if (slice.content.childCount === 0) return false;
  let codeOnly = true;
  slice.content.forEach((node) => {
    if (node.type.name !== 'codeBlock') codeOnly = false;
  });
  return codeOnly;
}

const FENCE_OPEN_RE = /^```[\w-]*\s*$/;
const FENCE_CLOSE_RE = /^```\s*$/;

// Strips the fences only when they delimit the whole payload — text carrying
// fences in the middle is a Markdown excerpt where they are real content.
function stripSingleFence(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  if (lines.length < 2) return text;
  if (!FENCE_OPEN_RE.test(lines[0]) || !FENCE_CLOSE_RE.test(lines[lines.length - 1])) return text;
  const inner = lines.slice(1, -1);
  if (inner.some((line) => line.trimStart().startsWith('```'))) return text;
  return inner.join('\n');
}

// ── Image import ──────────────────────────────────────────────────────────────

// Comprime e insere cada arquivo. A referência gravada no body é
// ![alt](zk:img/<id>) — os bytes ficam no IndexedDB e no SQLite, nunca inline.
async function insertImageFiles(
  editor: Editor,
  files: File[],
  dropPos: number | null,
  onPendingDelta: (delta: number) => void,
  onError: (msg: string) => void,
): Promise<void> {
  const images = files.filter(isImageFile);
  if (images.length === 0) return;

  let pos = dropPos;
  for (const file of images) {
    onPendingDelta(1);
    try {
      const { id } = await importImage(file);
      const content = { type: 'image', attrs: { src: `${ZK_IMG_PREFIX}${id}`, alt: '' } };
      if (pos === null) {
        editor.chain().focus().insertContent(content).run();
      } else {
        editor.chain().focus().insertContentAt(pos, content).run();
        pos = null; // as próximas seguem o cursor, já posicionado após a anterior
      }
    } catch (err) {
      // ImageUploadError = o servidor recusou de vez. A inserção acima não
      // chegou a acontecer (importImage lança antes), então o corpo não fica
      // com uma referência a bytes que só existem neste aparelho.
      onError(
        err instanceof ImageCompressError || err instanceof ImageUploadError
          ? err.message
          : 'Falha ao importar a imagem.',
      );
    } finally {
      onPendingDelta(-1);
    }
  }
}

// ── TableBubbleMenu ───────────────────────────────────────────────────────────

function TableBubbleMenu({ editor }: { editor: Editor }) {
  const btnClass =
    'px-2 py-1 text-xs rounded hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors whitespace-nowrap';
  const dividerClass = 'w-px bg-zinc-300 dark:bg-zinc-600 self-stretch mx-0.5';

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor: e }) =>
        e.isActive('tableCell') || e.isActive('tableHeader')
      }
      className="flex items-center gap-0.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 shadow-lg px-1 py-1 text-zinc-700 dark:text-zinc-200"
    >
      <button type="button" className={btnClass} onClick={() => editor.chain().focus().addColumnBefore().run()} title="Coluna antes">← Col</button>
      <button type="button" className={btnClass} onClick={() => editor.chain().focus().addColumnAfter().run()} title="Coluna depois">Col →</button>
      <button type="button" className={`${btnClass} text-red-500 dark:text-red-400`} onClick={() => editor.chain().focus().deleteColumn().run()} title="Deletar coluna">✕ Col</button>
      <div className={dividerClass} />
      <button type="button" className={btnClass} onClick={() => editor.chain().focus().addRowBefore().run()} title="Linha antes">↑ Linha</button>
      <button type="button" className={btnClass} onClick={() => editor.chain().focus().addRowAfter().run()} title="Linha depois">Linha ↓</button>
      <button type="button" className={`${btnClass} text-red-500 dark:text-red-400`} onClick={() => editor.chain().focus().deleteRow().run()} title="Deletar linha">✕ Linha</button>
      <div className={dividerClass} />
      <button type="button" className={`${btnClass} text-red-600 dark:text-red-500 font-medium`} onClick={() => editor.chain().focus().deleteTable().run()} title="Deletar tabela">✕ Tabela</button>
    </BubbleMenu>
  );
}

// ── SelectionExtractBubbleMenu ────────────────────────────────────────────────

function SelectionExtractBubbleMenu({
  editor,
  onExtract,
}: {
  editor: Editor;
  onExtract: (selectedText: string, range: { from: number; to: number }) => void;
}) {
  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor: e, state }) => {
        const { selection } = state;
        if (selection.empty) return false;
        if (e.isActive('codeBlock') || e.isActive('table')) return false;
        const text = state.doc.textBetween(selection.from, selection.to, ' ');
        return text.trim().length >= 3;
      }}
      className="flex items-center rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 shadow-lg px-1 py-1"
    >
      <button
        type="button"
        className="px-2 py-1 text-xs font-medium rounded hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors whitespace-nowrap text-brand"
        onClick={() => {
          const { from, to } = editor.state.selection;
          const text = editor.state.doc.textBetween(from, to, ' ');
          onExtract(text, { from, to });
        }}
      >
        + Extrair para novo zettel
      </button>
    </BubbleMenu>
  );
}

// ── CodeBlockNodeView ─────────────────────────────────────────────────────────

function CodeBlockNodeView({ node, updateAttributes }: {
  node: { attrs: { language?: string }; textContent: string };
  updateAttributes: (attrs: { language: string }) => void;
}) {
  const language = node.attrs.language ?? '';
  const isPlantUml = language === 'plantuml';

  // Debounced so a live PlantUML preview doesn't re-render on every keystroke —
  // the render engine (plantuml-render-client) serializes renders in a queue.
  const [debouncedSource, setDebouncedSource] = useState(node.textContent);
  useEffect(() => {
    if (!isPlantUml) return;
    const timer = setTimeout(() => setDebouncedSource(node.textContent), 500);
    return () => clearTimeout(timer);
  }, [node.textContent, isPlantUml]);

  const codeArea = (
    <>
      <div
        contentEditable={false}
        className="flex items-center gap-1 px-4 pt-3 pb-0 font-mono text-sm text-zinc-400 dark:text-zinc-500 select-none"
      >
        <span>```</span>
        <input
          value={node.attrs.language ?? ''}
          onChange={(e) => updateAttributes({ language: e.target.value })}
          placeholder="linguagem"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          className="bg-transparent outline-none text-zinc-600 dark:text-zinc-400 placeholder:text-zinc-300 dark:placeholder:text-zinc-600 w-28 min-w-0 font-mono text-sm"
        />
      </div>
      <NodeViewContent
        className="block px-4 py-2 font-mono text-sm text-zinc-800 dark:text-zinc-200 whitespace-pre"
      />
      <div
        contentEditable={false}
        className="px-4 pb-3 font-mono text-sm text-zinc-400 dark:text-zinc-500 select-none"
      >
        ```
      </div>
    </>
  );

  if (!isPlantUml) {
    return (
      <NodeViewWrapper as="div" className="my-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 overflow-x-auto">
        {codeArea}
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      as="div"
      className="my-2 flex flex-col lg:flex-row rounded-lg bg-zinc-100 dark:bg-zinc-800 overflow-hidden"
    >
      <div className="lg:w-1/2 min-w-0 overflow-x-auto">{codeArea}</div>
      <div
        contentEditable={false}
        className="lg:w-1/2 min-w-0 max-h-64 lg:max-h-none overflow-y-auto p-2 border-t border-zinc-200 dark:border-zinc-700 lg:border-t-0 lg:border-l"
      >
        <PlantUmlBlock source={debouncedSource} />
      </div>
    </NodeViewWrapper>
  );
}

const CustomCodeBlock = CodeBlockExtension.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockNodeView);
  },
});

// ── Image chip ────────────────────────────────────────────────────────────────

// No editor a imagem vira um chip compacto em vez da imagem de verdade. Dois
// motivos: `<img src="zk:img/...">` não carrega (o navegador não conhece o
// scheme) e o nó ficava com altura zero — uma linha em branco invisível, que
// não dava nem para selecionar e apagar. Resolver o blob aqui também obrigaria
// a ler o IndexedDB a cada montagem enquanto se digita.
function ImageChipNodeView({ node, selected }: {
  node: { attrs: { src?: string; alt?: string } };
  selected: boolean;
}) {
  const src = node.attrs.src ?? '';
  const alt = node.attrs.alt ?? '';
  const id = src.startsWith(ZK_IMG_PREFIX) ? src.slice(ZK_IMG_PREFIX.length) : src;

  return (
    <NodeViewWrapper as="div" className="my-2">
      <span
        contentEditable={false}
        title={alt || src}
        className={`inline-flex select-none items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
          selected
            ? 'border-brand bg-brand/10 text-brand'
            : 'border-zinc-300 bg-zinc-100 text-zinc-600 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
        }`}
      >
        <span aria-hidden>🖼</span>
        <span className="font-medium">{alt || 'Imagem'}</span>
        <code className="rounded bg-black/5 px-1 py-0.5 text-xs dark:bg-white/10">
          {id.slice(0, 8)}
        </code>
      </span>
    </NodeViewWrapper>
  );
}

// tiptap-markdown herda `defaultMarkdownSerializer.nodes.image`, que só faz
// `state.write("![alt](src)")`. Isso é correto no schema padrão, onde a imagem
// é inline — mas aqui ela é registrada com `inline: false` (ver a lista de
// extensões), ou seja, é um nó de bloco. Sem `closeBlock`, `state.closed` nunca
// é setado, o `flushClose()` do bloco seguinte não emite `\n\n` e o próximo
// bloco sai colado na mesma linha (`![alt](zk:img/x)# Título`) — o heading vira
// texto cru no preview. A guarda `isInline` mantém a serialização correta caso
// a config volte um dia para imagem inline.
const ImageChip = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ImageChipNodeView);
  },
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialize(state: any, node: any) {
          const alt = state.esc(node.attrs.alt || '');
          const src = String(node.attrs.src || '').replace(/[()]/g, '\\$&');
          const title = node.attrs.title
            ? ` "${String(node.attrs.title).replace(/"/g, '\\"')}"`
            : '';
          state.write(`![${alt}](${src}${title})`);
          if (!node.type.isInline) state.closeBlock(node);
        },
        parse: {
          // markdown-it cuida do parse
        },
      },
    };
  },
});

// ── Linha em branco ───────────────────────────────────────────────────────────

// Markdown não representa parágrafo vazio: o serializador colapsa qualquer
// número deles num único `\n\n` e o markdown-it descarta linhas em branco no
// parse — uma linha em branco intencional sumia ao salvar. O NBSP é o menor
// caractere que sobrevive aos dois lados (`html: false` descarta `<br>`) e não
// colide com nenhuma sintaxe markdown. `state.write()` não escapa, então ele
// sai literal no body.
const BLANK_LINE_SENTINEL = '\u00A0';

const CustomParagraph = Paragraph.extend({
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialize(state: any, node: any, parent: any) {
          // Só no nível do doc: parágrafo vazio dentro de list item ou
          // blockquote é estrutura, não linha em branco — marcá-lo deixaria um
          // NBSP visível dentro do item. Célula de tabela nem passa por aqui
          // (o serializer de table chama renderInline direto no conteúdo).
          const isBlankLine = node.content.size === 0 && parent?.type?.name === 'doc';
          if (isBlankLine) state.write(BLANK_LINE_SENTINEL);
          else state.renderInline(node);
          state.closeBlock(node);
        },
        parse: {
          // markdown-it cuida do parse
        },
      },
    };
  },
});

// O markdown-it transforma a linha de sentinela em `<p> </p>`, ou seja, um
// parágrafo com um caractere de texto. Sem desfazer isso, o cursor encostaria
// num caractere invisível (Backspace apagaria o NBSP antes do parágrafo). Roda
// depois de cada setContent, fora do histórico para o Ctrl+Z não trazer o NBSP
// de volta.
function normalizeSentinelParagraphs(editor: Editor): void {
  const ranges: Array<{ from: number; to: number }> = [];
  // Só filhos diretos do doc, espelhando a regra do CustomParagraph: NBSP
  // dentro de list item ou blockquote é conteúdo do usuário, não sentinela.
  editor.state.doc.forEach((node, offset) => {
    if (node.type.name !== 'paragraph') return;
    if (node.textContent === BLANK_LINE_SENTINEL) {
      ranges.push({ from: offset + 1, to: offset + 1 + node.content.size });
    }
  });
  if (ranges.length === 0) return;

  const tr = editor.state.tr;
  // De trás para frente: apagar o último range não desloca os anteriores.
  for (let i = ranges.length - 1; i >= 0; i--) {
    tr.delete(ranges[i].from, ranges[i].to);
  }
  tr.setMeta('addToHistory', false);
  editor.view.dispatch(tr);
}

// ── TipTapEditor ──────────────────────────────────────────────────────────────

export const TipTapEditor = forwardRef<TipTapEditorHandle, Props>(
  function TipTapEditor({ value, onChange, placeholder, className, spellCheck, fontSize, zettels, onEditorReady, onExtract, onPendingImagesChange }, ref) {
    const isExternalUpdate = useRef(false);

    // Keep current zettels accessible inside extensions without recreating them
    const zettelsSuggestionRef = useRef<Zettel[]>([]);
    zettelsSuggestionRef.current = zettels ?? [];

    // Popup state
    const [wikiPopup, setWikiPopup] = useState<WikiPopupState | null>(null);
    const [slashPopup, setSlashPopup] = useState<SlashPopupState | null>(null);

    // Stable refs to popup setters (used inside extension closures)
    const setWikiPopupRef = useRef(setWikiPopup);
    setWikiPopupRef.current = setWikiPopup;
    const setSlashPopupRef = useRef(setSlashPopup);
    setSlashPopupRef.current = setSlashPopup;

    // Refs to popup component keyboard handlers
    const wikiPopupRef = useRef<WikiPopupHandle>(null);
    const slashPopupRef = useRef<SlashPopupHandle>(null);

    // ── Imagens ──
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [pendingImages, setPendingImages] = useState(0);
    const [imageError, setImageError] = useState<string | null>(null);

    // Ref estável: o slash command é criado uma vez só (useMemo com deps vazias)
    // e não pode fechar sobre uma função recriada a cada render.
    const pickImagesRef = useRef<() => void>(() => {});
    pickImagesRef.current = () => fileInputRef.current?.click();

    const onPendingImagesChangeRef = useRef(onPendingImagesChange);
    onPendingImagesChangeRef.current = onPendingImagesChange;

    const bumpPending = useRef((delta: number) => {
      setPendingImages((n) => {
        const next = Math.max(0, n + delta);
        onPendingImagesChangeRef.current?.(next);
        return next;
      });
    }).current;

    // Extensions — stable (empty deps), communicate via refs
    const extensions = useMemo(() => {
      const wikiLinkPluginKey = new PluginKey('wikiLinkSuggestion');
      const slashCommandPluginKey = new PluginKey('slashCommandSuggestion');

      const WikiLinkExtension = Extension.create({
        name: 'wikiLinkSuggestion',
        addProseMirrorPlugins() {
          return [
            Suggestion<Zettel, Zettel>({
              pluginKey: wikiLinkPluginKey,
              editor: this.editor,
              char: '[[',
              allowSpaces: true,
              allowedPrefixes: null,
              items: ({ query }) => {
                const q = (query.startsWith('^') ? query.slice(1) : query).toLowerCase();
                return zettelsSuggestionRef.current
                  .filter((z) => !q || z.title.toLowerCase().includes(q))
                  .slice(0, 8);
              },
              command: ({ editor, range, props: zettel }) => {
                const typed = editor.state.doc.textBetween(range.from + 2, range.to);
                const prefix = typed.startsWith('^') ? '^' : '';
                editor
                  .chain()
                  .focus()
                  .deleteRange(range)
                  .insertContent(`[[${prefix}${zettel.title}]]`)
                  .run();
              },
              render: () => ({
                onStart: (props: SuggestionProps<Zettel, Zettel>) => {
                  setWikiPopupRef.current({
                    items: props.items,
                    command: props.command,
                    clientRect: props.clientRect,
                  });
                },
                onUpdate: (props: SuggestionProps<Zettel, Zettel>) => {
                  setWikiPopupRef.current({
                    items: props.items,
                    command: props.command,
                    clientRect: props.clientRect,
                  });
                },
                onExit: () => {
                  setWikiPopupRef.current(null);
                },
                onKeyDown: (props: SuggestionKeyDownProps) => {
                  if (props.event.key === 'Escape') {
                    setWikiPopupRef.current(null);
                    return true;
                  }
                  return wikiPopupRef.current?.onKeyDown(props) ?? false;
                },
              }),
            }),
          ];
        },
      });

      const SlashCommandExtension = Extension.create({
        name: 'slashCommandSuggestion',
        addProseMirrorPlugins() {
          return [
            Suggestion<SlashCommand, SlashCommand>({
              pluginKey: slashCommandPluginKey,
              editor: this.editor,
              char: '/',
              startOfLine: true,
              items: ({ query }) => {
                const q = query.toLowerCase();
                return SLASH_COMMANDS.filter(
                  (c) => !q || c.label.toLowerCase().includes(q) || c.id.includes(q),
                );
              },
              command: ({ editor, range, props: cmd }) => {
                // deleteRange + insert must be one chained transaction, not two
                // separate .run() calls — a render cycle between them lets the
                // controlled-component value-sync effect reset the doc and
                // invalidate the second transaction's positions (RangeError).
                if (cmd.id === 'diagrama') {
                  editor.chain().focus().deleteRange(range).insertContent({
                    type: 'codeBlock',
                    attrs: { language: 'plantuml' },
                    content: [{ type: 'text', text: '@startuml\n\n@enduml' }],
                  }).run();
                } else if (cmd.id === 'cifra') {
                  editor.chain().focus().deleteRange(range).insertContent({
                    type: 'codeBlock',
                    attrs: { language: 'chords' },
                    content: [],
                  }).run();
                } else if (cmd.id === 'partitura') {
                  editor.chain().focus().deleteRange(range).insertContent({
                    type: 'codeBlock',
                    attrs: { language: 'abc' },
                    content: [],
                  }).run();
                } else if (cmd.id === 'link') {
                  editor.chain().focus().deleteRange(range).insertContent('[[').run();
                } else if (cmd.id === 'tabela') {
                  editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run();
                } else if (cmd.id === 'codigo') {
                  editor.chain().focus().deleteRange(range).insertContent({
                    type: 'codeBlock',
                    attrs: { language: '' },
                    content: [],
                  }).run();
                } else if (cmd.id === 'imagem') {
                  // Remove o /... na mesma transação; o seletor de arquivo abre
                  // depois e a inserção acontece quando a compressão termina.
                  editor.chain().focus().deleteRange(range).run();
                  pickImagesRef.current();
                }
              },
              render: () => ({
                onStart: (props: SuggestionProps<SlashCommand, SlashCommand>) => {
                  setSlashPopupRef.current({
                    items: props.items,
                    command: props.command,
                    clientRect: props.clientRect,
                  });
                },
                onUpdate: (props: SuggestionProps<SlashCommand, SlashCommand>) => {
                  setSlashPopupRef.current({
                    items: props.items,
                    command: props.command,
                    clientRect: props.clientRect,
                  });
                },
                onExit: () => {
                  setSlashPopupRef.current(null);
                },
                onKeyDown: (props: SuggestionKeyDownProps) => {
                  if (props.event.key === 'Escape') {
                    setSlashPopupRef.current(null);
                    return true;
                  }
                  return slashPopupRef.current?.onKeyDown(props) ?? false;
                },
              }),
            }),
          ];
        },
      });

      // MarkdownTightLists (inside tiptap-markdown) only covers bulletList/orderedList.
      // Without tight:true on taskList, renderList() outputs blank lines between items.
      const TaskListTightFix = Extension.create({
        name: 'taskListTightFix',
        addGlobalAttributes() {
          return [{
            types: ['taskList'],
            attributes: {
              tight: {
                default: true,
                parseHTML: (el) => el.getAttribute('data-tight') === 'true' || !el.querySelector('p'),
                renderHTML: (attrs) => attrs.tight ? { 'data-tight': 'true' } : {},
              },
            },
          }];
        },
      });

      // Neither TaskItem nor ListItem bind Tab by default; without this, Tab inside
      // a checklist falls through to the browser's default focus traversal.
      const ListKeymap = Extension.create({
        name: 'listKeymap',
        addKeyboardShortcuts() {
          return {
            Tab: () => this.editor.commands.sinkListItem('taskItem'),
            'Shift-Tab': () => this.editor.commands.liftListItem('taskItem'),
          };
        },
      });

      const LeadingNodeEscape = Extension.create({
        name: 'leadingNodeEscape',
        addKeyboardShortcuts() {
          return {
            ArrowUp: () => canEscapeLeadingBlock(this.editor) ? escapeLeadingBlock(this.editor) : false,
          };
        },
      });

      return [
        // paragraph desligado no StarterKit para o CustomParagraph assumir a
        // serialização markdown (parágrafo vazio → sentinela NBSP).
        StarterKit.configure({ codeBlock: false, link: false, paragraph: false }),
        CustomParagraph,
        CustomCodeBlock,
        Table.configure({ resizable: false }),
        TableRow,
        TableHeader,
        TableCell,
        TaskList,
        TaskItem.configure({ nested: true, HTMLAttributes: { 'data-type': 'taskItem' } }),
        TaskListTightFix,
        ListKeymap,
        LeadingNodeEscape,
        // allowBase64 desligado de propósito: bytes inline no body multiplicariam
        // tamanho em cada salto (IndexedDB, fila de sync, SQLite, export, PDF).
        ImageChip.configure({ inline: false, allowBase64: false }),
        Markdown.configure({ html: false, transformCopiedText: true }),
        Placeholder.configure({ placeholder: placeholder ?? '' }),
        WikiLinkExtension,
        SlashCommandExtension,
      ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const onEditorReadyRef = useRef(onEditorReady);
    onEditorReadyRef.current = onEditorReady;

    // editorProps é montado antes de `editor` existir; a ref quebra o ciclo.
    const editorRef = useRef<Editor | null>(null);

    const editor = useEditor({
      extensions,
      content: escapeMarkdownLinksForParse(value),
      editorProps: {
        attributes: {
          spellcheck: spellCheck ? 'true' : 'false',
          class: 'tiptap-body',
        },
        // View-level props win over plugin props in EditorView.someProp, so this
        // runs before tiptap-markdown's serializer. Returning '' is falsy, so
        // non-code slices fall through to it and still copy as Markdown.
        clipboardTextSerializer: (slice) =>
          isCodeOnlySlice(slice)
            ? slice.content.textBetween(0, slice.content.size, '\n')
            : '',
        // Safety net for text copied from outside the app that arrives fenced.
        handlePaste: (view, event) => {
          const inCode = view.state.selection.$from.parent.type.spec.code;
          // Arquivos de imagem são tratados antes do early-return de código:
          // dentro de um code block a colagem de imagem não faz sentido, então
          // só interceptamos fora dele.
          if (!inCode) {
            const files = Array.from(event.clipboardData?.files ?? []).filter(isImageFile);
            if (files.length > 0 && editorRef.current) {
              event.preventDefault();
              void insertImageFiles(editorRef.current, files, null, bumpPending, setImageError);
              return true;
            }
          }
          if (!inCode) return false;
          const text = event.clipboardData?.getData('text/plain');
          if (!text) return false;
          const stripped = stripSingleFence(text);
          if (stripped === text) return false; // nothing to strip — native paste
          view.dispatch(view.state.tr.insertText(stripped).scrollIntoView());
          return true;
        },
        handleDrop: (view, event) => {
          const dragEvent = event as DragEvent;
          const files = Array.from(dragEvent.dataTransfer?.files ?? []).filter(isImageFile);
          if (files.length === 0 || !editorRef.current) return false;
          event.preventDefault();
          const coords = view.posAtCoords({ left: dragEvent.clientX, top: dragEvent.clientY });
          void insertImageFiles(
            editorRef.current,
            files,
            coords?.pos ?? null,
            bumpPending,
            setImageError,
          );
          return true;
        },
      },
      onCreate({ editor }) {
        editorRef.current = editor;
        // O `content:` inicial já passou pelo markdown-it: as sentinelas viraram
        // parágrafos com um NBSP dentro. isExternalUpdate silencia o onUpdate da
        // transação — o valor serializado seria idêntico ao recebido de qualquer
        // forma, mas não faz sentido notificar mudança que o usuário não fez.
        isExternalUpdate.current = true;
        normalizeSentinelParagraphs(editor);
        isExternalUpdate.current = false;
        onEditorReadyRef.current?.(editor);
      },
      onUpdate({ editor }) {
        if (isExternalUpdate.current) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const md = normalizeMarkdownLinks(normalizeAsterisks(normalizeWikiLinks(normalizeAutolinks((editor.storage as any).markdown.getMarkdown() as string))));
        onChange(md);
      },
    });

    // Sync external value changes without resetting caret mid-typing
    useEffect(() => {
      if (!editor) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const current = normalizeMarkdownLinks(normalizeAsterisks(normalizeWikiLinks(normalizeAutolinks((editor.storage as any).markdown.getMarkdown() as string))));
      if (current.trim() === value.trim()) return;
      const anchor = editor.state.selection.anchor;
      isExternalUpdate.current = true;
      editor.commands.setContent(escapeMarkdownLinksForParse(value));
      normalizeSentinelParagraphs(editor);
      isExternalUpdate.current = false;
      const maxPos = editor.state.doc.content.size;
      editor.commands.setTextSelection(Math.min(anchor, maxPos));
    }, [value, editor]);

    useImperativeHandle(ref, () => ({
      focus() { editor?.commands.focus('start'); },
      focusEnd() { editor?.commands.focus('end'); },
      insertCodeBlock(language: string, template = '') {
        if (!editor) return;
        editor
          .chain()
          .focus()
          .insertContent({
            type: 'codeBlock',
            attrs: { language },
            content: template ? [{ type: 'text', text: template }] : [],
          })
          .run();
      },
      pickImages() { pickImagesRef.current(); },
    }), [editor, pickImagesRef]);

    return (
      <>
        <EditorContent
          editor={editor}
          className={className}
          style={fontSize ? ({ '--input-font-size': `${fontSize}px` } as React.CSSProperties) : undefined}
        />
        {wikiPopup && (
          <WikiLinkPopup
            ref={wikiPopupRef}
            items={wikiPopup.items}
            command={wikiPopup.command}
            clientRect={wikiPopup.clientRect}
          />
        )}
        {slashPopup && (
          <SlashCommandPopup
            ref={slashPopupRef}
            items={slashPopup.items}
            command={slashPopup.command}
            clientRect={slashPopup.clientRect}
          />
        )}
        {editor && <TableBubbleMenu editor={editor} />}
        {editor && onExtract && <SelectionExtractBubbleMenu editor={editor} onExtract={onExtract} />}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = ''; // permite reescolher o mesmo arquivo depois
            if (files.length > 0 && editor) {
              void insertImageFiles(editor, files, null, bumpPending, setImageError);
            }
          }}
        />
        {imageError && (
          <div
            role="alert"
            className="mt-2 flex items-start justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
          >
            <span>{imageError}</span>
            <button
              type="button"
              onClick={() => setImageError(null)}
              className="shrink-0 font-medium underline"
            >
              Fechar
            </button>
          </div>
        )}
      </>
    );
  },
);
