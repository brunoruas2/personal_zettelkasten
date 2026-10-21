'use client';

import { useEffect, useRef, useState } from 'react';
import type { ZettelMeta } from '@zettelkasten/core';
import { useZettelBody } from '../../hooks/useZettelBody';
import { MarkdownRenderer } from '../MarkdownRenderer';
import { FocusHeader, FocusList, type FocusView } from './FocusPanel';

/**
 * Leitura em tela cheia (botão Maximizar do card). Só leitura: não monta o
 * editor, então mostra também corpo stale. Uma sessão de leitura = uma
 * entrada de histórico, empilhada na montagem: navegar entre zettels
 * (`[[link]]`, lista do foco) só troca `meta` e não empilha nada. Fecha pelo
 * voltar do sistema; "← Galáxia", `Esc` e "Editar" fazem `history.back()` e a
 * ação seguinte só roda depois do `popstate` (senão o editor em tela cheia
 * empilharia a sua entrada antes de a nossa sair). `hidden` esconde a leitura
 * durante o voo da galáxia sem desmontar (o histórico continua o mesmo).
 */
export function MaximizedReader({
  meta,
  hidden = false,
  focus,
  onClose,
  onEdit,
  onNavigate,
  onPick,
}: {
  meta: ZettelMeta;
  hidden?: boolean;
  /** Presente só com o modo foco ativo. */
  focus?: FocusView;
  onClose: () => void;
  onEdit: (id: string) => void;
  /** `[[link]]` clicado: o pai resolve o título e navega. */
  onNavigate: (title: string) => void;
  /** Item da lista do foco escolhido. */
  onPick: (id: string) => void;
}) {
  const { body, status } = useZettelBody(meta.id);
  const afterCloseRef = useRef<(() => void) | null>(null);
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    window.history.pushState({ galaxyReader: true }, '', window.location.href);
    const onPop = () => {
      onCloseRef.current();
      afterCloseRef.current?.();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Outro zettel: volta ao topo (trocar a key remontaria os diagramas por nada).
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [meta.id]);

  const close = (after?: () => void) => {
    if (closingRef.current) return;
    closingRef.current = true;
    afterCloseRef.current = after ?? null;
    window.history.back();
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  // Captura + preventDefault: o Esc da galáxia (bolha) não sai do foco junto.
  // Continua valendo escondido: Esc durante o voo sai da leitura.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const pick = (id: string) => {
    setDrawerOpen(false);
    onPick(id);
  };

  return (
    <div
      className={`dark fixed inset-0 z-50 flex h-[100dvh] flex-col bg-[#05070c] font-geist text-[#c9cfdb] ${
        hidden ? 'invisible pointer-events-none' : ''
      }`}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
        <button type="button" onClick={() => close()} className="text-sm text-[#c9cfdb]">
          ← Galáxia
        </button>
        <div className="flex items-center gap-2">
          {focus && (
            <button
              type="button"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen((o) => !o)}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-[#c9cfdb] hover:bg-white/5 lg:hidden"
            >
              Foco · {focus.items.length}
            </button>
          )}
          <button
            type="button"
            onClick={() => close(() => onEdit(meta.id))}
            className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
          >
            Editar
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div ref={scrollRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
          <article className="mx-auto w-full max-w-4xl px-6 pb-16 pt-8 text-[15px] leading-relaxed">
            <h1 className="mb-6 font-newsreader text-[32px] font-medium leading-tight text-[#f5f3ff]">
              {meta.title || 'Sem título'}
            </h1>
            {status === 'loading' ? (
              <p className="text-[#6f7787]">Carregando…</p>
            ) : status === 'missing' ? (
              <p className="text-[#6f7787]">Conteúdo ainda não disponível neste aparelho.</p>
            ) : (
              <>
                {status === 'stale' && (
                  <p className="mb-3 text-xs text-amber-200/80">versão anterior — a mais recente ainda não foi baixada</p>
                )}
                {body.trim() ? (
                  <MarkdownRenderer body={body} onLinkPress={onNavigate} />
                ) : (
                  <p className="italic text-[#6f7787]">Sem conteúdo.</p>
                )}
              </>
            )}
            {meta.tags.length > 0 && (
              <div className="mt-8 flex flex-wrap gap-1.5">
                {meta.tags.map((t) => (
                  <span key={t} className="rounded-md bg-white/5 px-2 py-0.5 text-xs text-[#8b93a3]">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </article>
        </div>
        {focus && (
          <aside className="hidden w-72 shrink-0 flex-col border-l border-white/10 bg-[#0e121a] text-[#e6e9f0] lg:flex">
            <FocusHeader {...focus} />
            <FocusList items={focus.items} activeId={meta.id} onPick={pick} className="min-h-0 flex-1 overflow-y-auto py-1" />
          </aside>
        )}
      </div>
      {focus && drawerOpen && (
        <aside className="absolute inset-x-0 bottom-0 flex max-h-[45vh] flex-col border-t border-white/10 bg-[#0e121a] text-[#e6e9f0] shadow-2xl lg:hidden">
          <FocusHeader {...focus} />
          <FocusList items={focus.items} activeId={meta.id} onPick={pick} className="min-h-0 flex-1 overflow-y-auto py-1" />
        </aside>
      )}
    </div>
  );
}
