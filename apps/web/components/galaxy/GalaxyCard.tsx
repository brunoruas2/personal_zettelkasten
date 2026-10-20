'use client';

import { memo, useEffect, useState } from 'react';
import { CARD_MAX_HEIGHT, CARD_WIDTH, type ZettelMeta } from '@zettelkasten/core';
import { useZettelBody } from '../../hooks/useZettelBody';
import { MarkdownRenderer } from '../MarkdownRenderer';

/** Altura do cabeçalho (título + tags) que sai da altura máxima do corpo. */
const HEADER_RESERVE = 96;

/**
 * Card de leitura da galáxia, em coordenadas de mundo dentro da `CardLayer`
 * (o transform da câmera fica no contêiner — este componente não re-renderiza
 * em pan/zoom). `data-*` dizem ao motor o que é do card: o corpo
 * (`data-card-body`) é seleção de texto com mouse; `data-card-scroll` rola com
 * a roda quando tem overflow.
 */
export const GalaxyCard = memo(function GalaxyCard({
  meta,
  idx,
  x,
  y,
  heavy,
  highlighted,
  onLink,
  onOpen,
  onHover,
}: {
  meta: ZettelMeta;
  idx: number;
  x: number;
  y: number;
  /** Câmera parada com zoom ≥ 60%: pode renderizar diagramas. */
  heavy: boolean;
  highlighted: boolean;
  onLink: (title: string) => void;
  onOpen: (id: string) => void;
  onHover: (idx: number) => void;
}) {
  const { body, status } = useZettelBody(meta.id);
  // Depois de renderizar os diagramas uma vez, não volta a código: desmontar
  // e remontar um diagrama a cada pan custaria mais que mantê-lo.
  const [heavyOnce, setHeavyOnce] = useState(heavy);
  useEffect(() => {
    if (heavy) setHeavyOnce(true);
  }, [heavy]);

  return (
    <article
      data-galaxy-card
      onPointerEnter={() => onHover(idx)}
      onPointerLeave={() => onHover(-1)}
      className={`absolute flex flex-col overflow-hidden rounded-xl border bg-[#0e121a] font-geist text-[#c9cfdb] shadow-2xl ${
        highlighted ? 'border-[#f5f3ff]/70' : 'border-white/[0.08]'
      }`}
      style={{
        left: x - CARD_WIDTH / 2,
        top: y - CARD_MAX_HEIGHT / 2,
        width: CARD_WIDTH,
        maxHeight: CARD_MAX_HEIGHT,
        contain: 'layout paint style',
      }}
    >
      <header className="flex shrink-0 items-start gap-3 px-6 pb-2 pt-5">
        <div className="min-w-0 flex-1">
          <h3 className="font-newsreader text-[22px] font-medium leading-snug text-[#f5f3ff]">
            {meta.title || 'Sem título'}
          </h3>
          {meta.tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {meta.tags.map((t) => (
                <span key={t} className="rounded-md bg-white/5 px-1.5 py-0.5 text-[11px] text-[#8b93a3]">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => onOpen(meta.id)}
          className="shrink-0 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-[#c9cfdb] hover:bg-white/5"
        >
          Abrir
        </button>
      </header>
      <div
        data-card-scroll
        className="min-h-0 overflow-y-auto overscroll-contain px-6 pb-5 text-[14px] leading-relaxed"
        style={{ maxHeight: CARD_MAX_HEIGHT - HEADER_RESERVE }}
      >
        <div data-card-body>
          {status === 'loading' ? (
            <p className="text-[#6f7787]">Carregando…</p>
          ) : status === 'missing' ? (
            <p className="text-[#6f7787]">Conteúdo ainda não disponível neste aparelho.</p>
          ) : (
            <>
              {status === 'stale' && (
                <p className="mb-2 text-[11px] text-amber-200/80">versão anterior — a mais recente ainda não foi baixada</p>
              )}
              {body.trim() ? (
                <MarkdownRenderer body={body} onLinkPress={onLink} disableHeavyBlocks={!heavyOnce} />
              ) : (
                <p className="italic text-[#6f7787]">Sem conteúdo.</p>
              )}
            </>
          )}
        </div>
      </div>
    </article>
  );
});
