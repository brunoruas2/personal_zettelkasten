'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import type { Zettel } from '@zettelkasten/core';
import { useZettelStore } from '../../store/useZettelStore';
import { TipTapEditor, type TipTapEditorHandle } from '../TipTapEditor';
import { TagInput } from '../TagInput';
import { DrawingEditHost } from '../../hooks/useDrawingEditHost';
import { MobileFormattingToolbar, TOOLBAR_HEIGHT } from '../MobileFormattingToolbar';
import { useKeyboardOffset } from '../../hooks/useKeyboardOffset';
import { LinkPickerModal } from '../LinkPickerModal';
import { MarkdownCheatsheet } from '../MarkdownCheatsheet';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'offline' | 'error';

export interface InplaceEditorHandle {
  /** Salva na hora o que estiver pendente (corpo, tags e título). */
  flush: () => Promise<void>;
  focusTitle: () => void;
}

const AUTOSAVE_MS = 1000;

/**
 * Editor da galáxia, compartilhado entre o card (desktop) e a tela cheia
 * (mobile). Autosave do corpo/tags com debounce; o título é aplicado só no
 * blur/Enter, porque renomear reescreve os `[[links]]` da base inteira.
 */
export const InplaceEditor = forwardRef<
  InplaceEditorHandle,
  {
    zettel: Zettel;
    variant: 'card' | 'mobile';
    autoFocusTitle?: boolean;
    onStatus: (s: SaveStatus) => void;
    onCreateLink: (title: string) => void | Promise<void>;
  }
>(function InplaceEditor({ zettel, variant, autoFocusTitle, onStatus, onCreateLink }, ref) {
  const updateZettel = useZettelStore((s) => s.updateZettel);
  const zettels = useZettelStore((s) => s.zettels);
  const allTags = useMemo(() => [...new Set(zettels.flatMap((z) => z.tags))].sort(), [zettels]);

  const [title, setTitle] = useState(zettel.title);
  const [body, setBody] = useState(zettel.body);
  const [tags, setTags] = useState<string[]>(zettel.tags);
  const [pendingImages, setPendingImages] = useState(0);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false);
  const [fontSize, setFontSize] = useState(16);

  const editorRef = useRef<TipTapEditorHandle>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  // O que já está salvo — o autosave compara contra isto.
  const savedRef = useRef({ title: zettel.title, body: zettel.body, tags: zettel.tags });
  const latestRef = useRef({ title, body, tags });
  latestRef.current = { title, body, tags };
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef<Promise<void> | null>(null);
  const pendingImagesRef = useRef(0);
  pendingImagesRef.current = pendingImages;
  const { toolbarRef } = useKeyboardOffset();

  const report = useCallback(
    (ok: boolean) => onStatus(!ok ? 'error' : navigator.onLine ? 'saved' : 'offline'),
    [onStatus],
  );

  /** Corpo e tags. Espera os anexos (o corpo não pode citar bytes que o servidor não tem). */
  const saveContent = useCallback(async () => {
    if (pendingImagesRef.current > 0) return;
    const { body: b, tags: t } = latestRef.current;
    const saved = savedRef.current;
    if (b === saved.body && JSON.stringify(t) === JSON.stringify(saved.tags)) return;
    onStatus('saving');
    try {
      await updateZettel(zettel.id, { body: b, tags: t });
      savedRef.current = { ...savedRef.current, body: b, tags: t };
      report(true);
    } catch {
      report(false);
    }
  }, [onStatus, report, updateZettel, zettel.id]);

  const saveTitle = useCallback(async () => {
    const t = latestRef.current.title.trim();
    if (t === savedRef.current.title) return;
    onStatus('saving');
    try {
      await updateZettel(zettel.id, { title: t });
      savedRef.current = { ...savedRef.current, title: t };
      report(true);
    } catch {
      report(false);
    }
  }, [onStatus, report, updateZettel, zettel.id]);

  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      savingRef.current = saveContent();
    }, AUTOSAVE_MS);
  }, [saveContent]);

  // Anexos terminaram: o save que esperava por eles sai agora.
  useEffect(() => {
    if (pendingImages === 0) schedule();
  }, [pendingImages, schedule]);

  useImperativeHandle(
    ref,
    () => ({
      flush: async () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
        await savingRef.current;
        await saveContent();
        await saveTitle();
      },
      focusTitle: () => titleRef.current?.focus(),
    }),
    [saveContent, saveTitle],
  );

  useEffect(() => {
    if (autoFocusTitle) titleRef.current?.focus();
    else editorRef.current?.focus({ scrollIntoView: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mark = (cmd: 'bold' | 'italic' | 'strike' | 'code') => {
    if (!editor) return;
    const chain = editor.chain().focus();
    if (cmd === 'bold') chain.toggleBold().run();
    else if (cmd === 'italic') chain.toggleItalic().run();
    else if (cmd === 'strike') chain.toggleStrike().run();
    else chain.toggleCode().run();
  };

  const isMobile = variant === 'mobile';
  const btn = 'rounded-md px-2 py-1 text-xs text-[#c9cfdb] hover:bg-white/5';

  return (
    <div className={`dark flex min-h-0 flex-col ${isMobile ? 'h-full' : ''}`}>
      <div className={isMobile ? 'px-5 pt-4' : 'px-6 pt-5'}>
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => void saveTitle()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void saveTitle();
              editorRef.current?.focus();
            }
          }}
          placeholder="Título"
          className="w-full bg-transparent font-newsreader text-[22px] font-medium leading-snug text-[#f5f3ff] outline-none placeholder:text-[#6f7787]"
        />
        <div className="mt-2" data-no-pan>
          <TagInput
            tags={tags}
            onChange={(t) => {
              setTags(t);
              schedule();
            }}
            suggestions={allTags}
          />
        </div>
      </div>

      <div
        data-card-scroll
        className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${isMobile ? 'px-5 pb-4' : 'px-6 pb-3'}`}
      >
        <div data-card-body>
          <DrawingEditHost>
            <TipTapEditor
              ref={editorRef}
              value={body}
              onChange={(v) => {
                setBody(v);
                schedule();
              }}
              placeholder="Escreva…"
              fontSize={isMobile ? fontSize : 15}
              zettels={zettels}
              onEditorReady={setEditor}
              onPendingImagesChange={setPendingImages}
              onCreateLink={onCreateLink}
            />
          </DrawingEditHost>
        </div>
        {isMobile && <div style={{ height: `calc(${TOOLBAR_HEIGHT}px + env(safe-area-inset-bottom))` }} />}
      </div>

      {!isMobile && (
        <div className="flex shrink-0 items-center gap-1 border-t border-white/10 px-4 py-1.5" data-no-pan>
          <button type="button" className={`${btn} font-bold`} onMouseDown={(e) => e.preventDefault()} onClick={() => mark('bold')}>B</button>
          <button type="button" className={`${btn} italic`} onMouseDown={(e) => e.preventDefault()} onClick={() => mark('italic')}>I</button>
          <button type="button" className={`${btn} line-through`} onMouseDown={(e) => e.preventDefault()} onClick={() => mark('strike')}>S</button>
          <button type="button" className={`${btn} font-mono`} onMouseDown={(e) => e.preventDefault()} onClick={() => mark('code')}>&lt;/&gt;</button>
          <button
            type="button"
            className={btn}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor?.chain().focus().insertContent('[[').run()}
          >
            [[ ]]
          </button>
          {pendingImages > 0 && (
            <span className="ml-auto text-[11px] text-[#8b93a3]">
              Aguardando {pendingImages} anexo{pendingImages > 1 ? 's' : ''}…
            </span>
          )}
        </div>
      )}

      {isMobile && (
        <MobileFormattingToolbar
          editor={editor}
          previewOpen={false}
          onTogglePreview={() => {}}
          onInsertLink={() => setLinkPickerOpen(true)}
          onInsertImage={() => editorRef.current?.pickImages()}
          onInsertDrawing={() => editorRef.current?.insertDrawing()}
          onOpenCheatsheet={() => setCheatsheetOpen(true)}
          fontSize={fontSize}
          onFontSizeChange={setFontSize}
          toolbarRef={toolbarRef}
          chordKeypadOpen={false}
          onToggleChordKeypad={() => {}}
          hasHeadings={false}
          tocOpen={false}
          onToggleToc={() => {}}
        />
      )}

      <LinkPickerModal
        open={linkPickerOpen}
        zettels={zettels}
        onSelect={(z, asParent) => {
          editor?.chain().focus().insertContent(`[[${asParent ? '^' : ''}${z.title}]]`).run();
          setLinkPickerOpen(false);
        }}
        onClose={() => setLinkPickerOpen(false)}
      />
      <MarkdownCheatsheet open={cheatsheetOpen} onClose={() => setCheatsheetOpen(false)} />
    </div>
  );
});
