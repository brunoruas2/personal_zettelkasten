'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReviewGrade, Zettel } from '@zettelkasten/core';
import { buildQueue, previewIntervals, initialState } from '@zettelkasten/core';
import { useZettelStore } from '../../store/useZettelStore';
import { useReviewStore } from '../../store/useReviewStore';
import { MarkdownRenderer } from '../../components/MarkdownRenderer';
import { OfflineLink } from '../../components/OfflineLink';
import { useOfflineRouter } from '../../hooks/useOfflineRouter';

const GRADES: { grade: ReviewGrade; label: string; hint: string; className: string }[] = [
  { grade: 'again', label: 'Errei', hint: '1', className: 'bg-red-600 hover:bg-red-500' },
  { grade: 'hard', label: 'Difícil', hint: '2', className: 'bg-amber-600 hover:bg-amber-500' },
  { grade: 'good', label: 'Bom', hint: '3', className: 'bg-brand hover:opacity-90' },
  { grade: 'easy', label: 'Fácil', hint: '4', className: 'bg-emerald-600 hover:bg-emerald-500' },
];

function formatDays(days: number): string {
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}m`;
  return `${(days / 365).toFixed(1)}a`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });
}

export default function ReviewPage() {
  const zettels = useZettelStore((s) => s.zettels);
  const isLoading = useZettelStore((s) => s.isLoading);
  const states = useReviewStore((s) => s.states);
  const newPerDay = useReviewStore((s) => s.newPerDay);
  const statesLoaded = useReviewStore((s) => s.isLoaded);
  const grade = useReviewStore((s) => s.grade);
  const setSuspended = useReviewStore((s) => s.setSuspended);
  const controller = useZettelStore((s) => s.controller);
  const offlineRouter = useOfflineRouter();

  const [session, setSession] = useState<{ items: Zettel[]; nextDueAt: number | null } | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [reviewed, setReviewed] = useState(0);

  const dataReady = !isLoading && statesLoaded;

  // A fila é montada uma única vez. Recalculá-la a cada avaliação faria o item
  // avaliado sair do array e deslocaria todos os índices seguintes — o próximo
  // cartão pularia um.
  const initialQueue = useMemo(() => {
    if (!dataReady) return null;
    const map = new Map(Object.entries(states));
    return buildQueue(zettels, map, Date.now(), newPerDay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataReady]);

  useEffect(() => {
    if (initialQueue && !session) {
      setSession({ items: initialQueue.items, nextDueAt: initialQueue.nextDueAt });
    }
  }, [initialQueue, session]);

  const current = session?.items[index] ?? null;

  const preview = useMemo(() => {
    if (!current) return null;
    const state = states[current.id] ?? initialState(current.id, Date.now());
    return previewIntervals(state, Date.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  // Mesmo comportamento da página de leitura: um [[wiki link]] no corpo
  // revelado navega para o zettel referenciado.
  const handleLinkPress = useCallback(
    async (title: string) => {
      if (!controller) return;
      const results = await controller.search(title);
      const exact = results.find((z) => z.title.toLowerCase() === title.toLowerCase());
      if (exact) offlineRouter.push(`/zettel/${exact.id}`);
    },
    [controller, offlineRouter],
  );

  const advance = useCallback(() => {
    setIndex((i) => i + 1);
    setRevealed(false);
  }, []);

  const handleGrade = useCallback(
    async (g: ReviewGrade) => {
      if (!current) return;
      await grade(current.id, g);
      setReviewed((n) => n + 1);
      advance();
    },
    [current, grade, advance],
  );

  const handleSuspend = useCallback(async () => {
    if (!current) return;
    await setSuspended(current.id, true);
    advance();
  }, [current, setSuspended, advance]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!current) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;

      if (!revealed && (e.code === 'Space' || e.key === 'Enter')) {
        e.preventDefault();
        setRevealed(true);
        return;
      }
      if (revealed) {
        const slot = ['1', '2', '3', '4'].indexOf(e.key);
        if (slot >= 0) {
          e.preventDefault();
          void handleGrade(GRADES[slot].grade);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, revealed, handleGrade]);

  if (!session) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center text-sm text-zinc-400">
        Carregando…
      </div>
    );
  }

  // Fim de sessão ou nada a revisar
  if (!current) {
    const finished = session.items.length > 0;
    return (
      <div className="mx-auto max-w-2xl px-4 pb-20 pt-16 text-center">
        <div className="mb-3 text-4xl">{finished ? '✓' : '🌙'}</div>
        <h1 className="mb-2 text-xl font-semibold text-zinc-800 dark:text-zinc-100">
          {finished ? 'Sessão concluída' : 'Nada para revisar agora'}
        </h1>
        <p className="mb-8 text-sm text-zinc-500">
          {finished
            ? `${reviewed} ${reviewed === 1 ? 'zettel revisado' : 'zettels revisados'}.`
            : session.nextDueAt
              ? `A próxima revisão volta em ${formatDate(session.nextDueAt)}.`
              : 'Não há nenhum zettel agendado.'}
        </p>
        <OfflineLink
          href="/"
          className="inline-block rounded-xl bg-brand px-5 py-2.5 text-sm font-medium text-white"
        >
          Voltar ao início
        </OfflineLink>
      </div>
    );
  }

  const total = session.items.length;

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-2xl flex-col px-4 pb-8 pt-4 lg:max-w-3xl lg:pt-8">
      {/* Cabeçalho: progresso e saída */}
      <div className="mb-6 flex items-center justify-between">
        <OfflineLink
          href="/"
          className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← Sair
        </OfflineLink>
        <span className="text-xs tabular-nums text-zinc-400">
          {index + 1} / {total}
        </span>
      </div>

      <div className="mb-4 h-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div
          className="h-full bg-brand transition-all"
          style={{ width: `${(index / total) * 100}%` }}
        />
      </div>

      {/* Frente do cartão */}
      <div className="flex-1">
        <h1 className="mb-3 text-2xl font-semibold text-zinc-800 dark:text-zinc-100">
          {current.title}
        </h1>

        {current.tags.length > 0 && (
          <div className="mb-6 flex flex-wrap gap-1.5">
            {current.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {revealed ? (
          <div className="border-t border-zinc-200 pt-6 dark:border-zinc-800">
            <MarkdownRenderer body={current.body} onLinkPress={handleLinkPress} />
          </div>
        ) : (
          <div className="py-12 text-center">
            <p className="mb-6 text-sm text-zinc-400">
              Tente lembrar o conteúdo antes de revelar.
            </p>
            <button
              onClick={() => setRevealed(true)}
              className="rounded-xl bg-brand px-6 py-3 text-sm font-medium text-white"
            >
              Revelar <span className="ml-1 opacity-60">espaço</span>
            </button>
          </div>
        )}
      </div>

      {/* Ações */}
      <div className="sticky bottom-0 mt-8 bg-white pb-[env(safe-area-inset-bottom)] pt-4 dark:bg-zinc-950">
        {revealed && preview && (
          <div className="mb-3 grid grid-cols-4 gap-2">
            {GRADES.map(({ grade: g, label, hint, className }) => (
              <button
                key={g}
                onClick={() => void handleGrade(g)}
                className={`rounded-xl px-2 py-3 text-sm font-medium text-white ${className}`}
              >
                <span className="block">{label}</span>
                <span className="block text-xs opacity-75">
                  {formatDays(preview[g])} · {hint}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between text-xs text-zinc-400">
          <OfflineLink href={`/zettel/${current.id}`} className="hover:text-zinc-600 dark:hover:text-zinc-300">
            Abrir zettel
          </OfflineLink>
          <button
            onClick={() => void handleSuspend()}
            className="hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            Não revisar este
          </button>
        </div>
      </div>
    </div>
  );
}
