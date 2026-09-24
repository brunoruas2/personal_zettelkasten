'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Zettel } from '@zettelkasten/core';
import { useZettelStore } from '../store/useZettelStore';
import { useOfflineRouter } from '../hooks/useOfflineRouter';
import { EMBEDDED_ATTR } from '../lib/embeddedFocus';
import { MarkdownRenderer } from './MarkdownRenderer';
import { OfflineLink } from './OfflineLink';
import { ZettelEditForm } from './ZettelEditForm';

interface EmbeddedZettelProps {
  zettel: Zettel;
  onCollapse: () => void;
  /** O título do filho mudou ao salvar: o corpo do pai pode ter sido reescrito. */
  onTitleChanged?: (oldTitle: string, newTitle: string) => void;
}

/**
 * Faixa de largura total com um zettel filho dentro do leitor/editor do pai.
 * Preview e Editar próprios; a edição é o `ZettelEditForm` do painel do mapa,
 * em versão `embedded`.
 */
export function EmbeddedZettel({ zettel: initial, onCollapse, onTitleChanged }: EmbeddedZettelProps) {
  const { controller } = useZettelStore();
  const offlineRouter = useOfflineRouter();
  const [zettel, setZettel] = useState<Zettel>(initial);
  const [mode, setMode] = useState<'preview' | 'edit'>('preview');
  const [dirty, setDirty] = useState(false);

  // Mudanças externas (ex.: o pai reescreveu um link) chegam pela lista do
  // store; só ressincroniza em preview, para nunca pisar numa edição aberta.
  useEffect(() => {
    if (mode === 'preview') setZettel(initial);
  }, [initial, mode]);

  const confirmDiscard = () => !dirty || window.confirm('Descartar alterações não salvas deste zettel?');

  const goPreview = () => {
    if (mode === 'preview' || !confirmDiscard()) return;
    setDirty(false);
    setMode('preview');
  };

  const collapse = () => {
    if (!confirmDiscard()) return;
    setDirty(false);
    onCollapse();
  };

  const handleSaved = useCallback(
    (saved: Zettel) => {
      const oldTitle = zettel.title;
      setZettel(saved);
      setDirty(false);
      setMode('preview');
      if (saved.title !== oldTitle) onTitleChanged?.(oldTitle, saved.title);
    },
    [zettel.title, onTitleChanged],
  );

  const handleLinkPress = async (title: string) => {
    if (!controller) return;
    const results = await controller.search(title);
    const exact = results.find((z) => z.title.toLowerCase() === title.toLowerCase());
    if (exact) offlineRouter.push(`/zettel/${exact.id}`);
  };

  const pill = (active: boolean) =>
    `px-3 py-1 transition-colors ${active ? 'bg-brand text-white' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'}`;

  return (
    <div
      {...{ [EMBEDDED_ATTR]: '' }}
      data-embedded-band=""
      // Fora do sumário do pai: os headings do filho não são do pai.
      data-toc-ignore=""
      className="my-3 overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50/60 dark:border-zinc-700 dark:bg-zinc-900/40"
    >
      <div className="flex items-center gap-3 border-b border-zinc-200 px-4 py-2 dark:border-zinc-700">
        <OfflineLink
          href={`/zettel/${zettel.id}`}
          className="min-w-0 flex-1 truncate text-sm font-semibold text-brand-light hover:underline"
        >
          {zettel.title}
        </OfflineLink>
        {dirty && <span className="text-[11px] text-amber-500">não salvo</span>}
        <div className="flex overflow-hidden rounded-xl border border-zinc-200 text-xs font-semibold dark:border-zinc-700">
          <button type="button" onClick={goPreview} className={pill(mode === 'preview')}>
            Preview
          </button>
          <button type="button" onClick={() => setMode('edit')} className={pill(mode === 'edit')}>
            Editar
          </button>
        </div>
        <button
          type="button"
          onClick={collapse}
          aria-label="Recolher"
          title="Recolher"
          className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {mode === 'preview' ? (
        <div className="max-h-[70vh] overflow-y-auto px-4 py-3">
          {zettel.body.trim() ? (
            <MarkdownRenderer body={zettel.body} onLinkPress={handleLinkPress} disableHeavyBlocks />
          ) : (
            <p className="text-sm italic text-zinc-400">Nenhum conteúdo ainda.</p>
          )}
          {zettel.tags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {zettel.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-brand/10 px-3 py-1 text-xs font-medium text-brand dark:text-brand-light">
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="h-[70vh]">
          <ZettelEditForm
            zettelId={zettel.id}
            layout="panel"
            embedded
            onSaved={handleSaved}
            onCancel={() => {
              setDirty(false);
              setMode('preview');
            }}
            onDirtyChange={setDirty}
          />
        </div>
      )}
    </div>
  );
}

/** Botão do hover sobre um `[[link]]`: renderiza o filho no lugar ou o recolhe. */
export function EmbedActionButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const label = open ? 'Recolher zettel embutido' : 'Renderizar zettel aqui';
  return (
    <button
      type="button"
      // Não rouba o foco/seleção do editor ao clicar.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onToggle}
      aria-label={label}
      title={label}
      aria-pressed={open}
      className={`flex h-5 w-5 items-center justify-center rounded-md border text-[10px] shadow-sm ${
        open
          ? 'border-brand bg-brand text-white'
          : 'border-zinc-300 bg-white text-zinc-500 hover:text-brand dark:border-zinc-600 dark:bg-zinc-800'
      }`}
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="12" x2="21" y2="12" />
      </svg>
    </button>
  );
}
