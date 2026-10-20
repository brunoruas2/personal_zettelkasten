'use client';

// Rota TEMPORÁRIA da change galaxy-positions: mede a altura real dos zettels
// renderizados na largura do card, para fixar CARD_MAX_HEIGHT. Apagar antes de
// arquivar a change.

import { useEffect, useRef, useState } from 'react';
import { CARD_WIDTH, type Zettel } from '@zettelkasten/core';
import { MarkdownRenderer } from '../../../components/MarkdownRenderer';
import { useZettelStore } from '../../../store/useZettelStore';

const BATCH = 20;
// Folga para imagens do IndexedDB carregarem antes de medir.
const SETTLE_MS = 200;
const CANDIDATES = [560, 600, 640, 680, 720, 760, 800, 840, 880];

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, i)];
}

export default function CardHeightsPage() {
  const controller = useZettelStore((s) => s.controller);
  const [all, setAll] = useState<Zettel[]>([]);
  const [batch, setBatch] = useState<Zettel[]>([]);
  const [heights, setHeights] = useState<{ id: string; title: string; h: number }[]>([]);
  const [running, setRunning] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const cursor = useRef(0);

  useEffect(() => {
    // Lista completa do controller: a do store pode estar filtrada pela busca.
    if (controller) void controller.getAll().then(setAll);
  }, [controller]);

  useEffect(() => {
    if (!running || batch.length === 0) return;
    let raf = 0;
    const timer = window.setTimeout(() => {
      raf = requestAnimationFrame(() => {
        const box = boxRef.current;
        if (!box) return;
        const measured = Array.from(box.children).map((el, i) => ({
          id: batch[i].id,
          title: batch[i].title,
          h: (el as HTMLElement).scrollHeight,
        }));
        setHeights((prev) => [...prev, ...measured]);
        cursor.current += BATCH;
        const next = all.slice(cursor.current, cursor.current + BATCH);
        if (next.length === 0) setRunning(false);
        setBatch(next);
      });
    }, SETTLE_MS);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [running, batch, all]);

  const start = () => {
    cursor.current = 0;
    setHeights([]);
    setBatch(all.slice(0, BATCH));
    setRunning(true);
  };

  const sorted = heights.map((x) => x.h).sort((a, b) => a - b);
  const tallest = [...heights].sort((a, b) => b.h - a.h).slice(0, 10);

  return (
    <div className="mx-auto max-w-2xl p-6 text-sm text-zinc-800 dark:text-zinc-200">
      <h1 className="mb-2 text-lg font-semibold">Altura dos cards (medição temporária)</h1>
      <p className="mb-4 text-zinc-500">
        Renderiza cada zettel numa coluna de {CARD_WIDTH} px, sem diagramas, e mede a altura. Use os
        percentis para fixar a altura máxima do card na galáxia.
      </p>
      <button
        type="button"
        onClick={start}
        disabled={running || all.length === 0}
        className="mb-6 rounded-lg bg-brand px-4 py-2 text-white disabled:opacity-50"
      >
        {running ? `Medindo… ${heights.length}/${all.length}` : `Medir ${all.length} zettels`}
      </button>

      {sorted.length > 0 && (
        <>
          <table className="mb-6 w-full tabular-nums">
            <tbody>
              <tr><td>Zettels medidos</td><td className="text-right">{sorted.length}</td></tr>
              {[50, 75, 80, 90].map((p) => (
                <tr key={p}><td>p{p}</td><td className="text-right">{percentile(sorted, p)} px</td></tr>
              ))}
              <tr><td>Máximo</td><td className="text-right">{sorted[sorted.length - 1]} px</td></tr>
            </tbody>
          </table>

          <h2 className="mb-2 font-semibold">Cabem sem scroll</h2>
          <table className="mb-6 w-full tabular-nums">
            <tbody>
              {CANDIDATES.map((c) => {
                const n = sorted.filter((h) => h <= c).length;
                return (
                  <tr key={c}>
                    <td>{c} px</td>
                    <td className="text-right">{Math.round((n / sorted.length) * 100)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <h2 className="mb-2 font-semibold">Mais altos</h2>
          <ul className="mb-6">
            {tallest.map((t) => (
              <li key={t.id} className="flex justify-between gap-4">
                <span className="truncate">{t.title}</span>
                <span className="tabular-nums text-zinc-500">{t.h} px</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Coluna de medição: fora da tela, na largura do card, com o mesmo
          padding e título que o card terá. */}
      <div
        ref={boxRef}
        aria-hidden
        style={{ position: 'absolute', left: -100_000, top: 0, width: CARD_WIDTH, visibility: 'hidden' }}
      >
        {batch.map((z) => (
          <div key={z.id} style={{ width: CARD_WIDTH, padding: '20px 24px', boxSizing: 'border-box' }}>
            <h2 className="mb-2 text-xl font-semibold leading-snug">{z.title}</h2>
            {z.tags.length > 0 && <div className="mb-3 text-xs">{z.tags.map((t) => `#${t}`).join(' ')}</div>}
            <MarkdownRenderer body={z.body} disableWikiLinks disableHeavyBlocks onLinkPress={() => {}} />
          </div>
        ))}
      </div>
    </div>
  );
}
