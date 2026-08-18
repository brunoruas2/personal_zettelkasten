'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { type Editor, useEditorState } from '@tiptap/react';
import { useOfflineRouter } from '../../../hooks/useOfflineRouter';
import { useZettelStore } from '../../../store/useZettelStore';
import { TagInput } from '../../../components/TagInput';
import { LinkPickerModal } from '../../../components/LinkPickerModal';
import { ExtractTitleModal } from '../../../components/ExtractTitleModal';
import { MarkdownCheatsheet } from '../../../components/MarkdownCheatsheet';
import { MarkdownRenderer } from '../../../components/MarkdownRenderer';
import { TipTapEditor, type TipTapEditorHandle } from '../../../components/TipTapEditor';
import { MobileFormattingToolbar, TOOLBAR_HEIGHT } from '../../../components/MobileFormattingToolbar';
import { ChordKeypad, KEYPAD_HEIGHT } from '../../../components/ChordKeypad';
import { useKeyboardOffset } from '../../../hooks/useKeyboardOffset';
import { api } from '../../../lib/api';
import { buildExtractedZettel, defaultExtractTitle } from '../../../lib/extractSelection';
import type { Zettel } from '@zettelkasten/core';

function getCursorFraction(text: string, cursor: number): number {
  const lines = text.split('\n');
  if (lines.length <= 1) return 0;
  return (text.slice(0, cursor).split('\n').length - 1) / (lines.length - 1);
}

export default function NewZettelPage() {
  const router = useOfflineRouter();
  const { createZettel, zettels, controller } = useZettelStore();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [extractPending, setExtractPending] = useState<{ selectedText: string; range: { from: number; to: number } } | null>(null);
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [editorFontSize, setEditorFontSize] = useState(16);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [chordKeypadOpen, setChordKeypadOpen] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const savedCursorRef = useRef(0);
  const originalBodyRef = useRef('');
  const isDirtyRef = useRef(false);
  const { toolbarRef } = useKeyboardOffset();
  const editorRef = useRef<TipTapEditorHandle>(null);

  useEffect(() => {
    const timer = setTimeout(() => titleRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    api.get('/api/auth/settings')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.zettel_template) {
          setBody(data.zettel_template);
          originalBodyRef.current = data.zettel_template;
        }
      })
      .catch(() => {});
  }, []);

  const isDirty = title.trim() !== '' || body !== originalBodyRef.current;
  useEffect(() => { isDirtyRef.current = isDirty; }, [isDirty]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { if (isDirtyRef.current) e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const handleLinkSelect = (zettel: Zettel, asParent: boolean) => {
    editor?.chain().focus().insertContent(`[[${asParent ? '^' : ''}${zettel.title}]]`).run();
    setLinkPickerOpen(false);
  };

  const handleExtractSelection = (selectedText: string, range: { from: number; to: number }) => {
    setExtractPending({ selectedText, range });
  };

  const handleConfirmExtract = async (newTitle: string) => {
    if (!extractPending) return;
    const { selectedText, range } = extractPending;
    setExtractPending(null);
    const { payload } = buildExtractedZettel({
      sourceTitle: title,
      sourceTags: tags,
      selectedText,
      newTitle,
    });
    await createZettel(payload);
    editor?.chain().focus().insertContentAt(range, `[[${newTitle}]]`).run();
  };

  const switchToPreview = () => {
    savedCursorRef.current = 0;
    setPreviewOpen(true);
  };

  const switchToEdit = () => setPreviewOpen(false);

  const editorState = useEditorState({
    editor,
    selector: (ctx) => ({
      inChordsBlock: ctx.editor ? ctx.editor.isActive('codeBlock', { language: 'chords' }) : false,
    }),
  });
  const showChordKeypad = chordKeypadOpen && (editorState?.inChordsBlock ?? false) && !previewOpen;

  useEffect(() => {
    if (previewOpen) setChordKeypadOpen(false);
  }, [previewOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || e.key !== 'p') return;
      e.preventDefault();
      if (previewOpen) switchToEdit();
      else switchToPreview();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewOpen]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (previewOpen) {
      const doScroll = () => {
        if (!previewRef.current || !body.trim()) return;
        const fraction = getCursorFraction(body, savedCursorRef.current);
        const el = previewRef.current;
        el.scrollTop = Math.max(0, el.scrollHeight * fraction - el.clientHeight * 0.3);
      };

      let done = false;
      let settleTimer: ReturnType<typeof setTimeout>;
      const vv = window.visualViewport;

      const onVVResize = () => {
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          if (done) return;
          done = true;
          vv?.removeEventListener('resize', onVVResize);
          clearTimeout(timer);
          doScroll();
        }, 100);
      };

      if (vv) vv.addEventListener('resize', onVVResize);

      timer = setTimeout(() => {
        if (done) return;
        done = true;
        vv?.removeEventListener('resize', onVVResize);
        clearTimeout(settleTimer);
        doScroll();
      }, 500);

      return () => {
        done = true;
        vv?.removeEventListener('resize', onVVResize);
        clearTimeout(timer);
        clearTimeout(settleTimer);
      };
    } else {
      timer = setTimeout(() => editorRef.current?.focus(), 50);
    }
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewOpen]);

  const handleLinkPress = async (linkTitle: string) => {
    if (!controller) return;
    const results = await controller.search(linkTitle);
    const exact = results.find((z) => z.title.toLowerCase() === linkTitle.toLowerCase());
    if (exact) router.push(`/zettel/${exact.id}`);
  };

  const handleChordsBodyChange = (rawStart: number, rawEnd: number, newContent: string) => {
    setBody((prev) => prev.slice(0, rawStart) + newContent + prev.slice(rawEnd));
  };

  const handleSave = useCallback(async () => {
    if (!title.trim()) return;
    await createZettel({ title: title.trim(), body, tags });
    isDirtyRef.current = false;
    router.push('/');
  }, [title, body, tags, createZettel, router]);

  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || e.key !== 's') return;
      e.preventDefault();
      handleSaveRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || e.key !== 'h') return;
      e.preventDefault();
      setCheatsheetOpen((prev) => !prev);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <>
      <div className="mx-auto max-w-2xl px-4 pt-4 flex flex-col h-[100dvh] lg:max-w-4xl lg:pt-6 lg:pb-4 lg:h-full">
        {/* Nav */}
        <div className="mb-5 flex items-center justify-between">
          <button onClick={() => { isDirtyRef.current = false; router.push('/'); }} className="text-sm font-medium text-brand hover:opacity-80">
            Cancelar
          </button>
          <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 lg:hidden">Novo Zettel</span>
          <div className="hidden lg:flex rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-700 text-xs font-semibold">
            <button
              onClick={switchToEdit}
              className={`px-3 py-1.5 transition-colors ${!previewOpen ? 'bg-brand text-white' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'}`}
            >
              Editar
            </button>
            <button
              onClick={switchToPreview}
              className={`px-3 py-1.5 transition-colors ${previewOpen ? 'bg-brand text-white' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'}`}
            >
              Preview
            </button>
          </div>
          <button
            onClick={handleSave}
            disabled={!title.trim()}
            className="rounded-xl bg-brand px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40 hover:opacity-90"
          >
            Salvar
          </button>
        </div>

        {/* Title — always visible */}
        <input
          ref={titleRef}
          autoFocus
          className="mb-4 w-full border-b border-zinc-200 bg-transparent pb-3 text-2xl font-bold text-zinc-900 outline-none placeholder:text-zinc-300 dark:border-zinc-700 dark:text-zinc-100"
          placeholder="Título do zettel"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); editorRef.current?.focus(); } }}
          readOnly={previewOpen}
        />

        <div ref={previewRef} className={`flex-1 min-h-0 overflow-y-auto ${previewOpen ? '' : 'hidden'}`}>
          {body.trim() ? (
            <MarkdownRenderer body={body} onLinkPress={handleLinkPress} onBodyChange={handleChordsBodyChange} />
          ) : (
            <p className="text-sm text-zinc-400 italic">Nenhum conteúdo ainda.</p>
          )}
        </div>

        <div className={`relative flex-1 min-h-0 flex flex-col ${previewOpen ? 'hidden' : ''}`}>
          <div
            className="flex-1 min-h-0 overflow-y-auto"
            style={{ '--input-font-size': `${editorFontSize}px` } as React.CSSProperties}
          >
            <TipTapEditor
              ref={editorRef}
              value={body}
              onChange={setBody}
              onEditorReady={setEditor}
              onExtract={handleExtractSelection}
              placeholder="Escreva aqui... use [[título]] para links ou / para inserir blocos"
              className="w-full"
              spellCheck
              fontSize={editorFontSize}
              zettels={zettels}
            />
            <div
              className="min-h-[12rem] cursor-text"
              onClick={() => editorRef.current?.focusEnd()}
            />
          </div>
        </div>

        {!previewOpen && (
          <TagInput
            tags={tags}
            onChange={setTags}
            suggestions={Array.from(new Set(zettels.flatMap((z) => z.tags)))}
          />
        )}
        <div aria-hidden className="shrink-0 lg:hidden" style={{ height: `calc(${showChordKeypad ? KEYPAD_HEIGHT : TOOLBAR_HEIGHT}px + env(safe-area-inset-bottom, 0px))` }} />
      </div>

      {showChordKeypad ? (
        <ChordKeypad
          editor={editor}
          active={showChordKeypad}
          onRequestClose={() => setChordKeypadOpen(false)}
        />
      ) : (
        <MobileFormattingToolbar
          editor={editor}
          previewOpen={previewOpen}
          onTogglePreview={previewOpen ? switchToEdit : switchToPreview}
          onInsertLink={() => setLinkPickerOpen(true)}
          onOpenCheatsheet={() => setCheatsheetOpen(true)}
          fontSize={editorFontSize}
          onFontSizeChange={setEditorFontSize}
          toolbarRef={toolbarRef}
          chordKeypadOpen={chordKeypadOpen}
          onToggleChordKeypad={() => setChordKeypadOpen((v) => !v)}
        />
      )}

      <LinkPickerModal
        open={linkPickerOpen}
        zettels={zettels}
        onSelect={handleLinkSelect}
        onClose={() => setLinkPickerOpen(false)}
      />
      <MarkdownCheatsheet open={cheatsheetOpen} onClose={() => setCheatsheetOpen(false)} />
      <ExtractTitleModal
        open={extractPending !== null}
        defaultTitle={extractPending ? defaultExtractTitle(extractPending.selectedText) : ''}
        onConfirm={handleConfirmExtract}
        onClose={() => setExtractPending(null)}
      />
    </>
  );
}
