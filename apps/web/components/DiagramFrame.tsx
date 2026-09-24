'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePinchZoom } from '../hooks/usePinchZoom';

export type DiagramState = 'loading' | 'ok' | 'error';

const CTRL_BTN =
  'flex items-center justify-center w-10 h-10 rounded-full bg-zinc-800/80 text-zinc-200 hover:bg-zinc-700 hover:text-white transition-colors';

/** Modal de tela cheia com zoom/pan; compartilhado por diagramas (SVG) e imagens (ZettelImage). */
export function ZoomModal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);
  const { zoomIn, zoomOut, reset } = usePinchZoom(surfaceRef, targetRef);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // iOS ignora overflow:hidden no body; position:fixed com o offset salvo é o que segura
  // (mesmo padrão do LinkPickerModal).
  useEffect(() => {
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
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm p-3">
      {/* Surface: recebe os gestos. Os botões ficam fora dela para não disparar pan/captura. */}
      <div
        ref={surfaceRef}
        className="relative h-full w-full overflow-hidden rounded-xl bg-white shadow-2xl"
        style={{ touchAction: 'none', overscrollBehavior: 'contain' }}
      >
        <div
          ref={targetRef}
          className="absolute inset-0 origin-top-left will-change-transform [&_svg]:!h-full [&_svg]:!w-full [&_svg]:!max-w-none"
        >
          {children}
        </div>
      </div>
      <button onClick={onClose} className={`${CTRL_BTN} absolute top-5 right-5`} aria-label="Fechar">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="1" y1="1" x2="13" y2="13" /><line x1="13" y1="1" x2="1" y2="13" />
        </svg>
      </button>
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-2">
        <button onClick={zoomOut} className={CTRL_BTN} aria-label="Diminuir">
          <svg width="16" height="16" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="8" x2="13" y2="8" /></svg>
        </button>
        <button onClick={reset} className={CTRL_BTN} aria-label="Ajustar à tela" title="Ajustar">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" />
          </svg>
        </button>
        <button onClick={zoomIn} className={CTRL_BTN} aria-label="Aumentar">
          <svg width="16" height="16" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="8" x2="13" y2="8" /><line x1="8" y1="3" x2="8" y2="13" /></svg>
        </button>
      </div>
    </div>,
    document.body,
  );
}


/** Casca visual compartilhada por PlantUmlBlock e MermaidBlock: loading, SVG com botão de ampliar, erro com source. */
export function DiagramFrame({ state, svg, source }: { state: DiagramState; svg: string; source: string }) {
  const [zoomed, setZoomed] = useState(false);

  if (state === 'ok') {
    return (
      <>
        <div data-render-state="ok" className="group relative my-3 overflow-x-auto rounded-lg border border-zinc-200 bg-white p-3 [&_svg]:max-w-full [&_svg]:h-auto">
          <div dangerouslySetInnerHTML={{ __html: svg }} />
          <button
            onClick={() => setZoomed(true)}
            className="no-print absolute top-2 right-2 flex items-center justify-center w-8 h-8 lg:w-7 lg:h-7 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 transition-opacity"
            aria-label="Ampliar diagrama"
            title="Ampliar"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        </div>
        {zoomed && (
          <ZoomModal onClose={() => setZoomed(false)}>
            <div className="h-full w-full" dangerouslySetInnerHTML={{ __html: svg }} />
          </ZoomModal>
        )}
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
