'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { renderPlantUml } from '../lib/plantumlEngine';

// Module-level cache: avoids re-rendering diagramas já vistos na sessão
const svgCache = new Map<string, string>();

type State = 'loading' | 'ok' | 'error';

function DiagramModal({ svg, onClose }: { svg: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6"
      onClick={onClose}
    >
      <div
        className="relative max-w-[90vw] max-h-[90vh] overflow-auto rounded-xl border border-zinc-200 bg-white p-6 shadow-2xl [&_svg]:max-w-full [&_svg]:h-auto"
        onClick={(e) => e.stopPropagation()}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <button
        onClick={onClose}
        className="absolute top-4 right-4 flex items-center justify-center w-8 h-8 rounded-full bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors"
        aria-label="Fechar"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="1" y1="1" x2="13" y2="13" /><line x1="13" y1="1" x2="1" y2="13" />
        </svg>
      </button>
    </div>,
    document.body,
  );
}

export function PlantUmlBlock({ source }: { source: string }) {
  const cached = svgCache.get(source);
  const [state, setState] = useState<State>(cached ? 'ok' : 'loading');
  const [svg, setSvg] = useState<string>(cached ?? '');
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    if (svgCache.has(source)) {
      setSvg(svgCache.get(source)!);
      setState('ok');
      return;
    }

    let cancelled = false;
    setState('loading');
    renderPlantUml(source)
      .then((svgText) => {
        if (cancelled) return;
        svgCache.set(source, svgText);
        setSvg(svgText);
        setState('ok');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });

    return () => {
      cancelled = true;
    };
  }, [source]);

  if (state === 'ok') {
    return (
      <>
        <div data-render-state="ok" className="group relative my-3 overflow-x-auto rounded-lg border border-zinc-200 bg-white p-3 [&_svg]:max-w-full [&_svg]:h-auto">
          <div dangerouslySetInnerHTML={{ __html: svg }} />
          <button
            onClick={() => setZoomed(true)}
            className="no-print absolute top-2 right-2 hidden lg:flex items-center justify-center w-7 h-7 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 opacity-0 group-hover:opacity-100 transition-opacity"
            aria-label="Ampliar diagrama"
            title="Ampliar"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        </div>
        {zoomed && <DiagramModal svg={svg} onClose={() => setZoomed(false)} />}
      </>
    );
  }

  if (state === 'loading') {
    return (
      <div data-render-state="loading" className="my-3 h-32 animate-pulse rounded-lg border border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800" />
    );
  }

  // erro — exibe source como fallback legível
  return (
    <div data-render-state="error" className="my-3">
      <span className="mb-1 block text-xs text-zinc-400">diagrama · erro ao renderizar</span>
      <pre className="overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 font-mono text-sm leading-5 dark:border-zinc-700 dark:bg-zinc-900">
        {source}
      </pre>
    </div>
  );
}
