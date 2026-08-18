'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useZettelStore } from '../../../store/useZettelStore';
import { useOfflineRouter } from '../../../hooks/useOfflineRouter';
import { MarkdownRenderer } from '../../../components/MarkdownRenderer';
import type { Zettel } from '@zettelkasten/core';

const PRINT_TIMEOUT_MS = 20000;
const POLL_INTERVAL_MS = 150;

function formatDate(ms: number) {
  return new Date(ms).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function ExportPdfContent() {
  const searchParams = useSearchParams();
  const offlineRouter = useOfflineRouter();
  const { zettels } = useZettelStore();
  const [pendingCount, setPendingCount] = useState(1);
  const [printed, setPrinted] = useState(false);
  const printedRef = useRef(false);

  const idsParam = searchParams.get('ids');
  let selected: Zettel[];
  if (idsParam) {
    const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean);
    const byId = new Map(zettels.map((z) => [z.id, z]));
    selected = ids.map((id) => byId.get(id)).filter((z): z is Zettel => !!z);
  } else {
    selected = zettels;
  }

  const doPrint = () => {
    if (printedRef.current) return;
    printedRef.current = true;
    setPrinted(true);
    window.print();
  };

  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => {
      const loading = document.querySelectorAll('[data-render-state="loading"]').length;
      setPendingCount(loading);
      if (loading === 0 || Date.now() - start > PRINT_TIMEOUT_MS) {
        clearInterval(interval);
        doPrint();
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected.length]);

  return (
    <div className="min-h-screen bg-white text-zinc-900">
      <div className="no-print sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-zinc-200 bg-zinc-50 px-4 py-3">
        <div className="text-sm text-zinc-600">
          {printed
            ? 'Escolha "Salvar como PDF" na janela de impressão.'
            : `Preparando PDF… ${pendingCount} diagrama${pendingCount === 1 ? '' : 's'} renderizando`}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={doPrint}
            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            Imprimir agora
          </button>
          <button
            onClick={() => offlineRouter.push('/')}
            className="text-sm text-zinc-500 hover:text-zinc-800"
          >
            Voltar
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-6 py-8">
        {selected.length === 0 && (
          <p className="text-zinc-500">Nenhum zettel encontrado para exportar.</p>
        )}
        {selected.map((zettel, idx) => (
          <article
            key={zettel.id}
            style={idx < selected.length - 1 ? { breakAfter: 'page' } : undefined}
            className="pb-8"
          >
            <h1 className="mb-1 text-3xl font-extrabold">{zettel.title}</h1>
            <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              {zettel.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-zinc-100 px-2 py-0.5">
                  #{tag}
                </span>
              ))}
              <span>Criado em {formatDate(zettel.createdAt)}</span>
              <span>· Atualizado em {formatDate(zettel.updatedAt)}</span>
            </div>
            <MarkdownRenderer body={zettel.body} onLinkPress={() => {}} disableWikiLinks />
          </article>
        ))}
      </div>
    </div>
  );
}

export default function ExportPdfPage() {
  return (
    <Suspense>
      <ExportPdfContent />
    </Suspense>
  );
}
