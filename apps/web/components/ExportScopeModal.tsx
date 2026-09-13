'use client';

import { useEffect, useMemo } from 'react';
import { analyzeSubtree } from '@zettelkasten/core';
import { useZettelStore } from '../store/useZettelStore';
import { useOfflineRouter } from '../hooks/useOfflineRouter';

interface Props {
  open: boolean;
  zettelId: string;
  onClose: () => void;
}

export function ExportScopeModal({ open, zettelId, onClose }: Props) {
  const { zettels, links } = useZettelStore();
  const offlineRouter = useOfflineRouter();

  // Tudo sai de estado local (zettels + links do store), então o modal calcula
  // resumo e ciclos offline, sem nenhuma requisição.
  const analysis = useMemo(
    () => (open ? analyzeSubtree(zettelId, zettels, links) : null),
    [open, zettelId, zettels, links],
  );

  const titleById = useMemo(() => new Map(zettels.map((z) => [z.id, z.title])), [zettels]);

  useEffect(() => {
    if (!open) return;
    // iOS ignora overflow:hidden no body. O jeito confiável é position:fixed
    // com o offset salvo para a página não pular ao fechar.
    const scrollY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    return () => {
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open || !analysis) return null;

  const { ids, cycles, depth } = analysis;
  const hasCycle = cycles.length > 0;
  const hasChildren = ids.length > 1;
  const canExportSubtree = hasChildren && !hasCycle;

  const exportIds = (list: string[]) => {
    offlineRouter.push(`/export/pdf?ids=${list.join(',')}`);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <span className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Exportar PDF
          </span>
          <button onClick={onClose} className="text-base font-medium text-brand hover:opacity-80">
            Cancelar
          </button>
        </div>

        <div className="px-5 py-4">
          {hasCycle ? (
            <div>
              <p className="text-sm text-zinc-700 dark:text-zinc-300">
                A árvore de filhos tem referência circular, então não dá para exportar com os
                filhos. Corrija {cycles.length === 1 ? 'o link abaixo' : 'os links abaixo'} e tente
                de novo.
              </p>
              <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto overscroll-contain">
                {cycles.map((cycle) => (
                  <li
                    key={cycle.join('>')}
                    className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                  >
                    {cycle.map((id) => titleById.get(id) ?? id).join(' → ')}
                  </li>
                ))}
              </ul>
            </div>
          ) : hasChildren ? (
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              Este zettel tem{' '}
              <strong className="font-semibold">
                {ids.length - 1} {ids.length - 1 === 1 ? 'filho' : 'filhos'}
              </strong>{' '}
              na descendência, em {depth} {depth === 1 ? 'nível' : 'níveis'}. Exportar com os filhos
              gera um PDF único de {ids.length} zettels, cada um em sua página.
            </p>
          ) : (
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              Este zettel não tem filhos. O PDF vai conter só ele.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-zinc-100 px-5 py-4 dark:border-zinc-800">
          {hasChildren && (
            <button
              onClick={() => exportIds(ids)}
              disabled={!canExportSubtree}
              className="w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:opacity-50"
            >
              {hasCycle ? 'Com os filhos (bloqueado)' : `Com os filhos (${ids.length} zettels)`}
            </button>
          )}
          <button
            onClick={() => exportIds([zettelId])}
            className="w-full rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Só este zettel
          </button>
        </div>
      </div>
    </div>
  );
}
