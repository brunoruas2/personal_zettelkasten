'use client';

import { useEffect, useRef } from 'react';
import type { ZettelMeta } from '@zettelkasten/core';
import { useZettelBody } from '../../hooks/useZettelBody';
import { MarkdownRenderer } from '../MarkdownRenderer';

/**
 * Leitura em tela cheia (botão Maximizar do card). Só leitura: não monta o
 * editor, então mostra também corpo stale. Fecha pelo voltar do sistema —
 * uma entrada de histórico é empilhada ao abrir; "← Galáxia", `Esc`, "Editar"
 * e links fazem `history.back()` e a ação seguinte só roda depois do
 * `popstate` (senão o editor em tela cheia empilharia a sua entrada antes de a
 * nossa sair).
 */
export function MaximizedReader({
  meta,
  onClose,
  onEdit,
  onLink,
}: {
  meta: ZettelMeta;
  onClose: () => void;
  onEdit: (id: string) => void;
  onLink: (title: string) => void;
}) {
  const { body, status } = useZettelBody(meta.id);
  const afterCloseRef = useRef<(() => void) | null>(null);
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    window.history.pushState({ galaxyReader: meta.id }, '', window.location.href);
    const onPop = () => {
      onCloseRef.current();
      afterCloseRef.current?.();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
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

  return (
    <div className="dark fixed inset-0 z-50 flex h-[100dvh] flex-col bg-[#05070c] font-geist text-[#c9cfdb]">
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
        <button type="button" onClick={() => close()} className="text-sm text-[#c9cfdb]">
          ← Galáxia
        </button>
        <button
          type="button"
          onClick={() => close(() => onEdit(meta.id))}
          className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
        >
          Editar
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
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
                <MarkdownRenderer body={body} onLinkPress={(title) => close(() => onLink(title))} />
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
    </div>
  );
}
