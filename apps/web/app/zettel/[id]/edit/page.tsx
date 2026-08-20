'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { type Editor, useEditorState } from '@tiptap/react';
import { useParams } from 'next/navigation';
import { useOfflineRouter } from '../../../../hooks/useOfflineRouter';
import { useZettelStore } from '../../../../store/useZettelStore';
import { TagInput } from '../../../../components/TagInput';
import { LinkPickerModal } from '../../../../components/LinkPickerModal';
import { ExtractTitleModal } from '../../../../components/ExtractTitleModal';
import { MarkdownCheatsheet } from '../../../../components/MarkdownCheatsheet';
import { MarkdownRenderer } from '../../../../components/MarkdownRenderer';
import { TipTapEditor, type TipTapEditorHandle } from '../../../../components/TipTapEditor';
import { MobileFormattingToolbar, TOOLBAR_HEIGHT } from '../../../../components/MobileFormattingToolbar';
import { ChordKeypad, KEYPAD_HEIGHT } from '../../../../components/ChordKeypad';
import { useKeyboardOffset } from '../../../../hooks/useKeyboardOffset';
import { buildExtractedZettel, defaultExtractTitle } from '../../../../lib/extractSelection';
import { TocDrawer } from '../../../../components/TocDrawer';
import { extractHeadings } from '../../../../lib/toc';
import type { Zettel } from '@zettelkasten/core';

function getCursorFraction(text: string, cursor: number): number {
  const lines = text.split('\n');
  if (lines.length <= 1) return 0;
  return (text.slice(0, cursor).split('\n').length - 1) / (lines.length - 1);
}

export default function EditZettelPage() {
  const { id } = useParams<{ id: string }>();
  const router = useOfflineRouter();
  const { controller, createZettel, updateZettel, zettels } = useZettelStore();
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
  const previewRef = useRef<HTMLDivElement>(null);
  const editorScrollRef = useRef<HTMLDivElement>(null);
  const [tocOpen, setTocOpen] = useState(false);

  const hasHeadings = useMemo(() => extractHeadings(body).length > 0, [body]);

  // Mesma chave da leitura: ligar o sumário aqui deixa ligado lá. Lida só
  // depois da montagem para não divergir do HTML do servidor.
  useEffect(() => {
    setTocOpen(localStorage.getItem('zettel_toc_open') === '1');
  }, []);

  const toggleToc = () => {
    setTocOpen((prev) => {
      const next = !prev;
      localStorage.setItem('zettel_toc_open', next ? '1' : '0');
      return next;
    });
  };

  // O preview e o editor ficam os dois montados (só `hidden` alterna), então o
  // sumário precisa apontar para o container do modo visível — a troca de
  // identidade do ref é o que faz o TocDrawer reconsultar.
  const tocContainerRef = previewOpen ? previewRef : editorScrollRef;
  const savedCursorRef = useRef(0);
  const originalValuesRef = useRef<{ title: string; body: string; tags: string[] } | null>(null);
  const isDirtyRef = useRef(false);
  const { toolbarRef } = useKeyboardOffset();
  const editorRef = useRef<TipTapEditorHandle>(null);
  // Imagens ainda comprimindo ou com upload em voo. Salvar com pendências
  // gravaria um body referenciando blob que o servidor não tem.
  const [pendingImages, setPendingImages] = useState(0);

  useEffect(() => {
    if (!controller || !id) return;
    controller.getById(id).then((z) => {
      if (z) {
        setTitle(z.title);
        setBody(z.body);
        setTags(z.tags);
        originalValuesRef.current = { title: z.title, body: z.body, tags: z.tags };
      }
    });
  }, [id, controller]);

  const isDirty =
    originalValuesRef.current !== null && (
      title !== originalValuesRef.current.title ||
      body !== originalValuesRef.current.body ||
      JSON.stringify(tags) !== JSON.stringify(originalValuesRef.current.tags)
    );
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
    if (!title.trim() || !id || pendingImages > 0) return;
    await updateZettel(id, { title: title.trim(), body, tags });
    isDirtyRef.current = false;
    router.replace(`/zettel/${id}`);
  }, [title, body, tags, id, pendingImages, updateZettel, router]);

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
      {/* O recuo do drawer vive no wrapper: no mesmo elemento que tem `mx-auto`
          ele fixaria a margem direita e a coluna encostaria no drawer em vez de
          centralizar. O `lg:h-full` precisa ser repetido aqui para a cadeia de
          altura continuar chegando ao container. */}
      <div className={`h-[100dvh] lg:h-full ${tocOpen && hasHeadings ? 'lg:pr-64' : ''}`}>
      <div className="mx-auto max-w-2xl px-4 pt-4 flex flex-col h-[100dvh] lg:max-w-4xl lg:pt-6 lg:pb-4 lg:h-full">
        {/* Nav */}
        <div className="mb-5 flex items-center justify-between">
          <button onClick={() => { isDirtyRef.current = false; router.replace(`/zettel/${id}`); }} className="text-sm font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
            ← Cancelar
          </button>
          <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 lg:hidden">Editar Zettel</span>
          <div className="hidden lg:flex items-center gap-2">
          {hasHeadings && (
            <button
              onClick={toggleToc}
              className={tocOpen ? 'text-brand' : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'}
              title="Sumário"
              aria-expanded={tocOpen}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="9" y1="6" x2="21" y2="6" /><line x1="9" y1="12" x2="21" y2="12" /><line x1="9" y1="18" x2="21" y2="18" />
                <circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" />
              </svg>
            </button>
          )}
          <div className="flex rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-700 text-xs font-semibold">
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
          </div>
          <button
            onClick={handleSave}
            disabled={!title.trim() || pendingImages > 0}
            className="rounded-xl bg-brand px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40 hover:opacity-90"
          >
            {pendingImages > 0
              ? `Aguardando ${pendingImages} imagem${pendingImages > 1 ? 'ns' : ''}…`
              : 'Salvar'}
          </button>
        </div>

        {/* Title — always visible */}
        <input
          className="mb-4 w-full border-b border-zinc-200 bg-transparent pb-3 text-2xl font-bold text-zinc-900 outline-none placeholder:text-zinc-300 dark:border-zinc-700 dark:text-zinc-100"
          placeholder="Título"
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
            ref={editorScrollRef}
            className="flex-1 min-h-0 overflow-y-auto"
            style={{ '--input-font-size': `${editorFontSize}px` } as React.CSSProperties}
          >
            <TipTapEditor
              ref={editorRef}
              value={body}
              onChange={setBody}
              onEditorReady={setEditor}
              onPendingImagesChange={setPendingImages}
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
          onInsertImage={() => editorRef.current?.pickImages()}
          onOpenCheatsheet={() => setCheatsheetOpen(true)}
          fontSize={editorFontSize}
          onFontSizeChange={setEditorFontSize}
          toolbarRef={toolbarRef}
          chordKeypadOpen={chordKeypadOpen}
          onToggleChordKeypad={() => setChordKeypadOpen((v) => !v)}
          hasHeadings={hasHeadings}
          tocOpen={tocOpen}
          onToggleToc={toggleToc}
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
      <TocDrawer
        open={tocOpen}
        onClose={toggleToc}
        contentRef={tocContainerRef}
        scrollRef={tocContainerRef}
        revision={body}
      />
    </>
  );
}
