'use client';

import { useEffect } from 'react';
import { type Editor } from '@tiptap/react';

export const KEYPAD_HEIGHT = 280;

interface Props {
  editor: Editor | null;
  active: boolean;
  onRequestClose: () => void;
}

const ROOTS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const QUALITIES = ['#', 'b', 'm', '7', 'maj7', 'dim', 'aug'];
const EXTENSIONS = ['sus2', 'sus4', '/', '[', ']'];

export function ChordKeypad({ editor, active, onRequestClose }: Props) {
  useEffect(() => {
    if (!editor || !active) return;
    const dom = editor.view.dom as HTMLElement;
    const prev = dom.getAttribute('inputmode');
    dom.setAttribute('inputmode', 'none');
    const wasFocused = document.activeElement === dom;
    if (wasFocused) {
      dom.blur();
      requestAnimationFrame(() => dom.focus());
    }
    return () => {
      if (prev) dom.setAttribute('inputmode', prev);
      else dom.removeAttribute('inputmode');
    };
  }, [editor, active]);

  function insertText(text: string) {
    // Insere via node de texto direto (não string/HTML) — o parser HTML do
    // insertContent(string) descarta texto só-de-espaço/quebra de linha por
    // ser "whitespace insignificante", o que quebrava os botões espaço/enter.
    editor?.chain().focus().insertContent({ type: 'text', text }).run();
  }

  function handleBackspace() {
    editor?.chain().focus().command(({ tr, state }) => {
      const { from, to } = state.selection;
      if (from !== to) {
        tr.delete(from, to);
        return true;
      }
      if (from <= 1) return false;
      tr.delete(from - 1, from);
      return true;
    }).run();
  }

  function handleClose() {
    const dom = editor?.view.dom as HTMLElement | undefined;
    dom?.removeAttribute('inputmode');
    onRequestClose();
    if (dom) {
      dom.blur();
      requestAnimationFrame(() => dom.focus());
    }
  }

  const base = 'flex h-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold transition-colors px-2';
  const keyClass = `${base} bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700`;

  function key(label: string, onClick: () => void, extra = '') {
    return (
      <button
        key={label}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        className={`${keyClass} ${extra}`}
      >
        {label}
      </button>
    );
  }

  return (
    <div
      className="fixed bottom-0 left-0 lg:left-80 right-0 z-10 flex flex-col gap-1.5 border-t border-zinc-200 bg-white px-2 pt-1.5 dark:border-zinc-800 dark:bg-zinc-950 lg:hidden"
      style={{ height: KEYPAD_HEIGHT, paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)' }}
    >
      <div className="flex flex-1 items-center justify-between gap-1">
        {ROOTS.map((r) => key(r, () => insertText(r), 'flex-1'))}
      </div>
      <div className="flex flex-1 items-center justify-between gap-1">
        {QUALITIES.map((q) => key(q, () => insertText(q), 'flex-1'))}
      </div>
      <div className="flex flex-1 items-center justify-between gap-1">
        {EXTENSIONS.map((ex) => key(ex, () => insertText(ex), 'flex-1'))}
      </div>
      <div className="flex flex-1 items-center justify-between gap-1">
        {key('espaço', () => insertText(' '), 'flex-[2]')}
        {key('↵', () => insertText('\n'), 'flex-1')}
        {key('⌫', handleBackspace, 'flex-1')}
      </div>
      <div className="flex flex-1 items-center justify-between gap-1">
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleClose}
          className="flex h-11 flex-1 shrink-0 items-center justify-center rounded-xl bg-brand text-sm font-bold text-white"
        >
          Teclado normal
        </button>
      </div>
    </div>
  );
}
