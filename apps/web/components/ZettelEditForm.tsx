'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { type Editor, useEditorState } from '@tiptap/react';
import { useOfflineRouter } from '../hooks/useOfflineRouter';
import { useZettelStore } from '../store/useZettelStore';
import { TagInput } from './TagInput';
import { LinkPickerModal } from './LinkPickerModal';
import { ExtractTitleModal } from './ExtractTitleModal';
import { MarkdownCheatsheet } from './MarkdownCheatsheet';
import { MarkdownRenderer } from './MarkdownRenderer';
import { TipTapEditor, type TipTapEditorHandle } from './TipTapEditor';
import { MobileFormattingToolbar, TOOLBAR_HEIGHT } from './MobileFormattingToolbar';
import { ChordKeypad, KEYPAD_HEIGHT } from './ChordKeypad';
import { useKeyboardOffset, KEYBOARD_OPEN_THRESHOLD } from '../hooks/useKeyboardOffset';
import { buildExtractedZettel, defaultExtractTitle } from '../lib/extractSelection';
import { TocDrawer } from './TocDrawer';
import { ScrollEdgeButton, scrollToEnd } from './ScrollEdgeButton';
import { extractHeadings } from '../lib/toc';
import { useReadingWidthClass } from '../lib/readingWidth';
import { eventInEmbedded, EMBEDDED_ATTR } from '../lib/embeddedFocus';
import { useEditorModeScrollSync } from '../hooks/useEditorModeScrollSync';
import { useEmbeds } from '../hooks/useEmbeds';
import { rewriteLinkTitle, type Zettel } from '@zettelkasten/core';

export interface ZettelEditFormProps {
  /** null = create mode (used by the map's split-edit panel right after a quick-create stub, or a future /zettel/new integration). */
  zettelId: string | null;
  /** 'page' = full-page route (default behavior: router navigation, native beforeunload guard, TOC drawer, scroll-edge FAB). 'panel' = docked map panel (no navigation, no fixed-position chrome that would escape the panel bounds — parent handles close/guard via callbacks). */
  layout: 'page' | 'panel';
  initialValues?: { title?: string; body?: string; tags?: string[] };
  onSaved?: (zettel: Zettel) => void;
  onCancel?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  autoFocusTitle?: boolean;
  /**
   * Formulário dentro de uma faixa de zettel embutido (ver `EmbeddedZettel`). Sem
   * toolbar fixa móvel, teclado de cifras, pill Editar/Preview nem Sumário — o
   * modo é da faixa, a altura vem dela — e os atalhos globais só reagem a
   * eventos cujo alvo esteja dentro da própria raiz.
   */
  embedded?: boolean;
}

export function ZettelEditForm({
  zettelId,
  layout,
  initialValues,
  onSaved,
  onCancel,
  onDirtyChange,
  autoFocusTitle,
  embedded = false,
}: ZettelEditFormProps) {
  const router = useOfflineRouter();
  const { controller, createZettel, updateZettel, zettels } = useZettelStore();
  const [title, setTitle] = useState(initialValues?.title ?? '');
  const [body, setBody] = useState(initialValues?.body ?? '');
  const [tags, setTags] = useState<string[]>(initialValues?.tags ?? []);
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
  const titleInputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Atalhos globais moram no `document`. Um form embutido só age em eventos de
  // dentro de si; os demais ignoram eventos vindos de uma faixa embutida.
  const shortcutApplies = (e: Event) =>
    embedded
      ? e.target instanceof Node && !!rootRef.current?.contains(e.target)
      : !eventInEmbedded(e);

  const isPage = layout === 'page';
  const widthClass = useReadingWidthClass();
  const hasHeadings = useMemo(() => isPage && extractHeadings(body).length > 0, [isPage, body]);

  useEffect(() => {
    if (!isPage) return;
    setTocOpen(localStorage.getItem('zettel_toc_open') === '1');
  }, [isPage]);

  const toggleToc = () => {
    setTocOpen((prev) => {
      const next = !prev;
      localStorage.setItem('zettel_toc_open', next ? '1' : '0');
      return next;
    });
  };

  const tocContainerRef = previewOpen ? previewRef : editorScrollRef;

  const originalValuesRef = useRef<{ title: string; body: string; tags: string[] }>({
    title: initialValues?.title ?? '',
    body: initialValues?.body ?? '',
    tags: initialValues?.tags ?? [],
  });
  const isDirtyRef = useRef(false);
  const { toolbarRef, offset: keyboardOffset, recompute: recomputeKeyboardOffset } = useKeyboardOffset();
  const keyboardOpen = !embedded && keyboardOffset > KEYBOARD_OPEN_THRESHOLD;
  const editorRef = useRef<TipTapEditorHandle>(null);
  const { captureAnchor } = useEditorModeScrollSync({
    previewOpen,
    previewRef,
    editorScrollRef,
    editorRef,
  });
  const [pendingImages, setPendingImages] = useState(0);

  // Renomear um filho reescreve `[[antigo]]` no pai salvo (rewriteLinks); o corpo
  // em edição aqui também precisa, senão salvar o pai desfaria a reescrita.
  const handleChildRenamed = useCallback((oldTitle: string, newTitle: string) => {
    setBody((prev) => rewriteLinkTitle(prev, oldTitle, newTitle));
    originalValuesRef.current = {
      ...originalValuesRef.current,
      body: rewriteLinkTitle(originalValuesRef.current.body, oldTitle, newTitle),
    };
  }, []);
  const { embed, wikiLinkAction, embedSlot, bridge, portals } = useEmbeds({
    parentId: zettelId ?? '',
    body,
    previewOpen,
    // Um nível só: o formulário de dentro de uma faixa não embute filhos.
    disabled: embedded,
    onChildRenamed: handleChildRenamed,
  });

  useEffect(() => {
    if (!controller) return;
    if (zettelId) {
      controller.getById(zettelId).then((z) => {
        if (z) {
          setTitle(z.title);
          setBody(z.body);
          setTags(z.tags);
          originalValuesRef.current = { title: z.title, body: z.body, tags: z.tags };
        }
      });
    }
  }, [zettelId, controller]);

  useEffect(() => {
    if (autoFocusTitle) titleInputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isDirty =
    title !== originalValuesRef.current.title ||
    body !== originalValuesRef.current.body ||
    JSON.stringify(tags) !== JSON.stringify(originalValuesRef.current.tags);
  useEffect(() => {
    isDirtyRef.current = isDirty;
    onDirtyChange?.(isDirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty]);

  useEffect(() => {
    if (!isPage) return;
    const handler = (e: BeforeUnloadEvent) => { if (isDirtyRef.current) e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isPage]);

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
    captureAnchor();
    setPreviewOpen(true);
  };

  const switchToEdit = () => {
    captureAnchor();
    setPreviewOpen(false);
  };

  const editorState = useEditorState({
    editor,
    selector: (ctx) => ({
      inChordsBlock: ctx.editor ? ctx.editor.isActive('codeBlock', { language: 'chords' }) : false,
    }),
  });
  const showChordKeypad = !embedded && chordKeypadOpen && (editorState?.inChordsBlock ?? false) && !previewOpen;

  useEffect(() => {
    if (previewOpen) setChordKeypadOpen(false);
  }, [previewOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || e.key !== 'p') return;
      // Embutido: o modo é do cabeçalho da faixa.
      if (embedded || !shortcutApplies(e)) return;
      e.preventDefault();
      if (previewOpen) switchToEdit();
      else switchToPreview();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
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

  const [isSaving, setIsSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const justSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSave = useCallback(async () => {
    if (!title.trim() || pendingImages > 0) return;
    const payload = { title: title.trim(), body, tags };
    // Salvar um zettel existente (página de edição ou painel do mapa) não
    // navega: o formulário continua na tela, então precisa do feedback. Só a
    // criação em página cheia sai dali — ainda não há id para ficar editando.
    const staysOnForm = !isPage || zettelId != null;
    if (staysOnForm) setIsSaving(true);
    try {
      const saved = zettelId ? await updateZettel(zettelId, payload) : await createZettel(payload);
      isDirtyRef.current = false;
      originalValuesRef.current = { title: saved.title, body: saved.body, tags: saved.tags };
      if (staysOnForm) {
        onSaved?.(saved);
        if (justSavedTimerRef.current) clearTimeout(justSavedTimerRef.current);
        setJustSaved(true);
        justSavedTimerRef.current = setTimeout(() => setJustSaved(false), 1600);
      } else {
        router.replace(`/zettel/${saved.id}`);
      }
    } finally {
      if (staysOnForm) setIsSaving(false);
    }
  }, [title, body, tags, zettelId, pendingImages, updateZettel, createZettel, router, isPage, onSaved]);

  useEffect(() => {
    return () => {
      if (justSavedTimerRef.current) clearTimeout(justSavedTimerRef.current);
    };
  }, []);

  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  const handleCancel = () => {
    isDirtyRef.current = false;
    if (isPage) {
      if (zettelId) router.replace(`/zettel/${zettelId}`);
      else router.push('/');
    } else {
      onCancel?.();
    }
  };
  const handleCancelRef = useRef(handleCancel);
  handleCancelRef.current = handleCancel;

  // Alt+E sai do modo edit (espelha o Alt+E da leitura, que entra). Compara
  // `e.code`: Option no macOS compõe caractere. Só na rota de página.
  useEffect(() => {
    if (!isPage) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || e.code !== 'KeyE' || !shortcutApplies(e)) return;
      e.preventDefault();
      if (isDirtyRef.current && !window.confirm('Descartar alterações não salvas?')) return;
      handleCancelRef.current();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isPage]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || e.key !== 's' || !shortcutApplies(e)) return;
      e.preventDefault();
      handleSaveRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || e.key !== 'h' || !shortcutApplies(e)) return;
      e.preventDefault();
      setCheatsheetOpen((prev) => !prev);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!isPage) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || e.code !== 'KeyT' || !shortcutApplies(e)) return;
      if (!hasHeadings) return;
      e.preventDefault();
      toggleToc();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isPage, hasHeadings]);

  useEffect(() => {
    if (!isPage) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || e.code !== 'KeyF' || !shortcutApplies(e)) return;
      e.preventDefault();
      scrollToEnd(tocContainerRef.current);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isPage, tocContainerRef]);

  const outerClassName = isPage
    ? `h-[100dvh] lg:h-full ${tocOpen && hasHeadings ? 'lg:pr-64' : ''}`
    : 'h-full';
  const innerClassName = isPage
    ? `mx-auto max-w-2xl px-4 pt-4 flex flex-col h-[100dvh] ${widthClass} lg:pt-6 lg:pb-4 lg:h-full`
    : 'flex flex-col h-full px-4 pt-4 pb-4';

  return (
    <div ref={rootRef} className={outerClassName} {...(embedded ? { [EMBEDDED_ATTR]: '' } : {})}>
      <div className={innerClassName}>
        {/* Nav */}
        <div className="mb-5 flex items-center justify-between">
          <button onClick={handleCancel} className="text-sm font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
            ← Cancelar
          </button>
          <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 lg:hidden">
            {zettelId ? 'Editar Zettel' : 'Novo Zettel'}
          </span>
          <div className={embedded ? 'hidden' : 'hidden lg:flex items-center gap-2'}>
            {embed.hasChildren && (
              <button
                onClick={embed.toggleGlobal}
                className={embed.globalOn ? 'text-brand' : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'}
                title={embed.globalOn ? 'Recolher zettels referenciados' : 'Renderizar zettels referenciados'}
                aria-pressed={embed.globalOn}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="12" x2="21" y2="12" />
                </svg>
              </button>
            )}
            {isPage && hasHeadings && (
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
            disabled={!title.trim() || pendingImages > 0 || isSaving}
            className={`rounded-xl px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40 hover:opacity-90 ${justSaved ? 'bg-green-600' : 'bg-brand'}`}
          >
            {pendingImages > 0
              ? `Aguardando ${pendingImages} imagem${pendingImages > 1 ? 'ns' : ''}…`
              : isSaving
              ? 'Salvando…'
              : justSaved
              ? 'Salvo ✓'
              : 'Salvar'}
          </button>
        </div>

        {/* Title — always visible */}
        <input
          ref={titleInputRef}
          className={`${keyboardOpen ? 'mb-2 pb-2 text-xl lg:mb-4 lg:pb-3 lg:text-2xl' : 'mb-4 pb-3 text-2xl'} w-full border-b border-zinc-200 bg-transparent font-bold text-zinc-900 outline-none placeholder:text-zinc-300 dark:border-zinc-700 dark:text-zinc-100`}
          placeholder="Título"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); editorRef.current?.focus(); } }}
          readOnly={previewOpen}
        />

        <div ref={previewRef} className={`flex-1 min-h-0 overflow-y-auto ${previewOpen ? '' : 'hidden'}`}>
          {body.trim() ? (
            <MarkdownRenderer
              body={body}
              onLinkPress={handleLinkPress}
              onBodyChange={handleChordsBodyChange}
              wikiLinkAction={embed.hasChildren ? wikiLinkAction : undefined}
              embedSlot={embed.hasChildren ? embedSlot : undefined}
            />
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
              embedBridge={bridge}
            />
            <div
              className="min-h-[12rem] cursor-text"
              onClick={() => editorRef.current?.focusEnd()}
            />
          </div>
        </div>

        {!previewOpen && !keyboardOpen && (
          <TagInput
            tags={tags}
            onChange={setTags}
            suggestions={Array.from(new Set(zettels.flatMap((z) => z.tags)))}
          />
        )}
        {!embedded && <div aria-hidden className="shrink-0 lg:hidden" style={{ height: `calc(${(showChordKeypad ? KEYPAD_HEIGHT : TOOLBAR_HEIGHT) + keyboardOffset}px + env(safe-area-inset-bottom, 0px))` }} />}
      </div>

      {embedded ? null : showChordKeypad ? (
        <ChordKeypad
          editor={editor}
          active={showChordKeypad}
          onRequestClose={() => setChordKeypadOpen(false)}
          keyboardOffset={keyboardOffset}
          onRecomputeOffset={recomputeKeyboardOffset}
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
          hasEmbeds={embed.hasChildren}
          embedsOn={embed.globalOn}
          onToggleEmbeds={embed.toggleGlobal}
        />
      )}

      {portals}

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

      {isPage && (
        <>
          <div
            className={`fixed right-4 z-10 bottom-[var(--fab-offset)] lg:bottom-6 ${tocOpen && hasHeadings ? 'lg:right-[17rem]' : ''}`}
            style={{ '--fab-offset': `calc(1.5rem + ${(showChordKeypad ? KEYPAD_HEIGHT : TOOLBAR_HEIGHT) + keyboardOffset}px + env(safe-area-inset-bottom, 0px))` } as React.CSSProperties}
          >
            <ScrollEdgeButton anchorRef={tocContainerRef} revision={`${previewOpen}:${body}`} />
          </div>

          <TocDrawer
            open={tocOpen}
            onClose={toggleToc}
            contentRef={tocContainerRef}
            scrollRef={tocContainerRef}
            revision={body}
          />
        </>
      )}
    </div>
  );
}
