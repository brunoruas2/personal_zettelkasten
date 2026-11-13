import type { Editor } from '@tiptap/react';

/**
 * Ponto clicado na leitura, descrito por texto (não por coordenada): a leitura
 * (MarkdownRenderer) e a edição (ProseMirror) têm DOM diferente, mas ambas
 * têm a mesma sequência de blocos de topo e o mesmo texto visível.
 */
export interface CaretAnchor {
  /** Índice do bloco de topo dentro do corpo (blocos vazios não contam). */
  index: number;
  /** Texto do bloco, com espaços normalizados. */
  text: string;
  /** Caracteres (normalizados) do início do bloco até o ponto clicado. */
  before: number;
  /** O clique caiu num bloco "pesado" (código, diagrama, imagem…): abrir o código. */
  widget: boolean;
  /** Coordenadas de tela, usadas só como último recurso. */
  x: number;
  y: number;
}

const WIDGET_SELECTOR = 'pre,svg,canvas,img,[data-widget]';

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

function hasContent(el: Element): boolean {
  return !!el.textContent?.trim() || !!el.querySelector('svg,canvas,img,hr');
}

function caretFromPoint(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const pos = doc.caretPositionFromPoint?.(x, y);
  if (pos) return { node: pos.offsetNode, offset: pos.offset };
  const range = doc.caretRangeFromPoint?.(x, y);
  if (range) return { node: range.startContainer, offset: range.startOffset };
  return null;
}

/** Captura o ponto do clique dentro do corpo renderizado (`root` = `.zk-md`). */
export function captureCaretAnchor(e: { clientX: number; clientY: number; target: EventTarget | null }, root: HTMLElement): CaretAnchor | null {
  const container = (root.firstElementChild as HTMLElement | null) ?? root;
  const blocks = Array.from(container.children).filter(hasContent);
  const target = e.target as Node | null;
  const hit = target && root.contains(target) ? target : null;
  if (!hit) return null;
  const blockEl = blocks.find((b) => b.contains(hit));
  if (!blockEl) return null;

  const widget = !!(hit instanceof Element ? hit : hit.parentElement)?.closest(WIDGET_SELECTOR);
  let before = 0;
  const caret = caretFromPoint(e.clientX, e.clientY);
  if (caret && blockEl.contains(caret.node)) {
    const r = document.createRange();
    r.setStart(blockEl, 0);
    try {
      r.setEnd(caret.node, caret.offset);
      before = norm(r.toString()).length;
    } catch {
      before = 0;
    }
  }
  return {
    index: blocks.indexOf(blockEl),
    text: norm(blockEl.textContent ?? ''),
    before,
    widget,
    x: e.clientX,
    y: e.clientY,
  };
}

interface Block {
  node: import('@tiptap/pm/model').Node;
  pos: number;
}

function topBlocks(editor: Editor): Block[] {
  const out: Block[] = [];
  editor.state.doc.forEach((node, pos) => {
    // Parágrafo vazio (linha em branco) não aparece na leitura.
    if (node.isTextblock && !node.textContent.trim()) return;
    out.push({ node, pos });
  });
  return out;
}

/** Posição ProseMirror após `before` caracteres normalizados do bloco. */
function posInBlock(b: Block, before: number): number {
  let count = 0;
  let prevSpace = true; // espaço inicial é descartado, como em norm()
  let result: number | null = null;
  b.node.descendants((n, rel) => {
    if (result !== null) return false;
    if (!n.isText) return true;
    const text = n.text ?? '';
    const base = b.pos + 1 + rel;
    for (let i = 0; i < text.length; i++) {
      if (count >= before) {
        result = base + i;
        return false;
      }
      const space = /\s/.test(text[i]);
      if (space && prevSpace) continue;
      prevSpace = space;
      count++;
    }
    return true;
  });
  return result ?? b.pos + b.node.nodeSize - 1;
}

/** Resolve a âncora numa posição do documento; `null` = sem correspondência. */
export function resolveCaretAnchor(editor: Editor, a: CaretAnchor): number | null {
  const blocks = topBlocks(editor);
  if (blocks.length === 0) return null;

  // 1) Mesmo texto, o mais próximo do índice original.
  if (a.text && !a.widget) {
    let best: number | null = null;
    blocks.forEach((b, i) => {
      if (b.node.type.name === 'codeBlock' || !b.node.isTextblock && !b.node.childCount) return;
      if (norm(b.node.textContent) !== a.text) return;
      if (best === null || Math.abs(i - a.index) < Math.abs(best - a.index)) best = i;
    });
    if (best !== null) return posInBlock(blocks[best], a.before);
  }

  // 2) Mesmo índice: bloco pesado abre o código; texto com prefixo igual segue o offset.
  const b = blocks[Math.min(a.index, blocks.length - 1)];
  if (b.node.type.name === 'codeBlock') return b.pos + 1;
  if (a.widget || b.node.type.name === 'image') return null;
  if (b.node.textContent && norm(b.node.textContent).slice(0, 12) === a.text.slice(0, 12)) {
    return posInBlock(b, a.before);
  }
  return null;
}

/** Cursor por âncora; cai em coordenadas e, por fim, no início. */
export function placeCaret(editor: Editor, a: CaretAnchor | null | undefined): void {
  if (!a) {
    editor.commands.focus('start', { scrollIntoView: false });
    return;
  }
  let pos = resolveCaretAnchor(editor, a);
  if (pos === null) {
    const hit = editor.view.posAtCoords({ left: a.x, top: a.y });
    pos = hit?.pos ?? null;
  }
  if (pos === null) {
    editor.commands.focus('start', { scrollIntoView: false });
    return;
  }
  const max = editor.state.doc.content.size;
  editor.chain().focus().setTextSelection(Math.min(pos, max)).scrollIntoView().run();
}
