'use client';

import { type RefObject } from 'react';
import { type Editor, useEditorState } from '@tiptap/react';
import { canEscapeLeadingBlock, escapeLeadingBlock } from './TipTapEditor';

export const TOOLBAR_HEIGHT = 56;

interface Props {
  editor: Editor | null;
  previewOpen: boolean;
  onTogglePreview: () => void;
  onInsertLink: () => void;
  onInsertImage: () => void;
  onOpenCheatsheet: () => void;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  toolbarRef: RefObject<HTMLDivElement | null>;
  chordKeypadOpen: boolean;
  onToggleChordKeypad: () => void;
}

const NoteIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </svg>
);

const EyeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const Divider = () => (
  <div className="w-px h-6 bg-zinc-200 dark:bg-zinc-700 shrink-0 mx-0.5" />
);

export function MobileFormattingToolbar({
  editor,
  previewOpen,
  onTogglePreview,
  onInsertLink,
  onInsertImage,
  onOpenCheatsheet,
  fontSize,
  onFontSizeChange,
  toolbarRef,
  chordKeypadOpen,
  onToggleChordKeypad,
}: Props) {
  const state = useEditorState({
    editor,
    selector: (ctx) => {
      if (!ctx.editor) return null;
      return {
        bold: ctx.editor.isActive('bold'),
        italic: ctx.editor.isActive('italic'),
        strike: ctx.editor.isActive('strike'),
        code: ctx.editor.isActive('code'),
        h1: ctx.editor.isActive('heading', { level: 1 }),
        h2: ctx.editor.isActive('heading', { level: 2 }),
        h3: ctx.editor.isActive('heading', { level: 3 }),
        blockquote: ctx.editor.isActive('blockquote'),
        bulletList: ctx.editor.isActive('bulletList'),
        orderedList: ctx.editor.isActive('orderedList'),
        taskList: ctx.editor.isActive('taskList'),
        canUndo: ctx.editor.can().undo(),
        canRedo: ctx.editor.can().redo(),
        inChordsBlock: ctx.editor.isActive('codeBlock', { language: 'chords' }),
        canEscapeLeadingBlock: canEscapeLeadingBlock(ctx.editor),
      };
    },
  });

  const wrapClass =
    'fixed bottom-0 left-0 lg:left-80 right-0 z-10 flex items-center border-t border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 lg:hidden';
  const wrapStyle = { height: TOOLBAR_HEIGHT, paddingBottom: 'env(safe-area-inset-bottom)' };

  const base = 'flex w-11 h-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold transition-colors';
  const inactive = 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700';
  const active = 'bg-brand text-white';

  function fmtBtn(
    label: React.ReactNode,
    isActive: boolean,
    onClick: () => void,
    ariaLabel: string,
    extra = '',
  ) {
    return (
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        aria-label={ariaLabel}
        className={`${base} ${isActive ? active : inactive} ${extra}`}
      >
        {label}
      </button>
    );
  }

  if (previewOpen) {
    return (
      <div ref={toolbarRef} className={wrapClass} style={wrapStyle}>
        <div className="flex flex-1 items-center justify-end px-3">
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={onTogglePreview}
            aria-label="Voltar para edição"
            className={`${base} ${active}`}
          >
            <EyeIcon />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={toolbarRef} className={wrapClass} style={wrapStyle}>
      {/* Scrollable section */}
      <div className="flex flex-1 min-w-0 items-center gap-1 overflow-x-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">

        {/* Inline formatting */}
        {fmtBtn(<span className="font-bold">B</span>, state?.bold ?? false, () => editor?.chain().focus().toggleBold().run(), 'Negrito')}
        {fmtBtn(<span className="italic">I</span>, state?.italic ?? false, () => editor?.chain().focus().toggleItalic().run(), 'Itálico')}
        {fmtBtn(<span className="line-through">S</span>, state?.strike ?? false, () => editor?.chain().focus().toggleStrike().run(), 'Tachado')}
        {fmtBtn('`', state?.code ?? false, () => editor?.chain().focus().toggleCode().run(), 'Código inline')}

        <Divider />

        {/* Headings + blockquote */}
        {fmtBtn('H1', state?.h1 ?? false, () => editor?.chain().focus().toggleHeading({ level: 1 }).run(), 'Título 1', 'text-xs')}
        {fmtBtn('H2', state?.h2 ?? false, () => editor?.chain().focus().toggleHeading({ level: 2 }).run(), 'Título 2', 'text-xs')}
        {fmtBtn('H3', state?.h3 ?? false, () => editor?.chain().focus().toggleHeading({ level: 3 }).run(), 'Título 3', 'text-xs')}
        {fmtBtn(<span className="text-base leading-none">"</span>, state?.blockquote ?? false, () => editor?.chain().focus().toggleBlockquote().run(), 'Citação')}

        <Divider />

        {/* Lists */}
        {fmtBtn('•', state?.bulletList ?? false, () => editor?.chain().focus().toggleBulletList().run(), 'Lista')}
        {fmtBtn('1.', state?.orderedList ?? false, () => editor?.chain().focus().toggleOrderedList().run(), 'Lista numerada', 'text-xs')}
        {fmtBtn('☐', state?.taskList ?? false, () => editor?.chain().focus().toggleTaskList().run(), 'Lista de tarefas')}
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor?.chain().focus().setHorizontalRule().run()}
          aria-label="Inserir linha horizontal"
          className={`${base} ${inactive} text-brand text-xl leading-none`}
        >
          ―
        </button>

        <Divider />

        {/* Wiki link + specials */}
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={onInsertLink}
          aria-label="Inserir wiki link"
          className={`${base} ${inactive} text-brand text-xl leading-none`}
        >
          ⟦⟧
        </button>
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor?.chain().focus().insertContent({ type: 'codeBlock', attrs: { language: 'plantuml' }, content: [{ type: 'text', text: '@startuml\n\n@enduml' }] }).run()}
          aria-label="Inserir diagrama PlantUML"
          className={`${base} ${inactive} text-brand text-xl leading-none`}
        >
          ◈
        </button>
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor?.chain().focus().insertContent({ type: 'codeBlock', attrs: { language: 'chords' }, content: [] }).run()}
          aria-label="Inserir cifra"
          className={`${base} ${inactive} text-brand text-xl leading-none`}
        >
          ♪
        </button>
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor?.chain().focus().insertContent({ type: 'codeBlock', attrs: { language: 'abc' }, content: [] }).run()}
          aria-label="Inserir partitura"
          className={`${base} ${inactive} text-brand text-xl leading-none`}
        >
          ♩
        </button>
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={onInsertImage}
          aria-label="Inserir imagem"
          className={`${base} ${inactive} text-brand text-xl leading-none`}
        >
          🖼
        </button>

        <Divider />

        {/* Undo / Redo */}
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor?.chain().focus().undo().run()}
          disabled={!(state?.canUndo ?? false)}
          aria-label="Desfazer"
          className={`${base} ${inactive} text-lg disabled:opacity-30`}
        >
          ↩
        </button>
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor?.chain().focus().redo().run()}
          disabled={!(state?.canRedo ?? false)}
          aria-label="Refazer"
          className={`${base} ${inactive} text-lg disabled:opacity-30`}
        >
          ↪
        </button>

        {/* Font size */}
        <div className="flex shrink-0 items-center overflow-hidden rounded-xl bg-zinc-100 dark:bg-zinc-800 ml-0.5">
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onFontSizeChange(Math.max(16, fontSize - 1))}
            aria-label="Diminuir fonte do editor"
            className="flex h-11 w-9 items-center justify-center text-xs font-bold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 active:bg-zinc-200 dark:active:bg-zinc-700"
          >
            A−
          </button>
          <span className="min-w-[1.5rem] text-center text-xs font-semibold tabular-nums text-zinc-400">
            {fontSize}
          </span>
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onFontSizeChange(Math.min(26, fontSize + 1))}
            aria-label="Aumentar fonte do editor"
            className="flex h-11 w-9 items-center justify-center text-sm font-bold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 active:bg-zinc-200 dark:active:bg-zinc-700"
          >
            A+
          </button>
        </div>
      </div>

      {/* Fixed right section */}
      <div className="flex shrink-0 items-center gap-2 border-l border-zinc-200 px-3 dark:border-zinc-800">
        {state?.inChordsBlock && (
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={onToggleChordKeypad}
            aria-label="Teclado de cifras"
            className={`${base} ${chordKeypadOpen ? active : inactive}`}
          >
            <NoteIcon />
          </button>
        )}
        {state?.canEscapeLeadingBlock && (
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor && escapeLeadingBlock(editor)}
            aria-label="Adicionar linha acima do bloco"
            className={`${base} ${inactive} text-brand text-lg leading-none`}
          >
            ↑¶
          </button>
        )}
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={onTogglePreview}
          aria-label="Visualizar preview"
          className={`${base} ${inactive} text-brand`}
        >
          <EyeIcon />
        </button>
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={onOpenCheatsheet}
          aria-label="Guia de formatação"
          className={`${base} bg-zinc-100 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:bg-zinc-800 dark:hover:bg-zinc-700`}
        >
          ?
        </button>
      </div>
    </div>
  );
}
