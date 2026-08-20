'use client';

import { useEffect, useMemo, useState } from 'react';
import { extractHeadings } from '../lib/toc';

interface Props {
  open: boolean;
  body: string;
  onClose: () => void;
}

/** Fração da altura do viewport que delimita a faixa de detecção do scroll spy. */
const SPY_BAND = 0.3;

export function TocDrawer({ open, body, onClose }: Props) {
  const items = useMemo(() => extractHeadings(body), [body]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // Scroll spy. O `<main>` do desktop é `h-screen`, então sua caixa visível
  // coincide com o viewport — um único observer com `root: null` serve aos dois
  // breakpoints. O observer é só o gatilho; o item ativo é recalculado do DOM
  // para ficar determinístico quando várias seções curtas entram na faixa no
  // mesmo frame.
  useEffect(() => {
    if (!open || items.length === 0) return;

    const els = items
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;

    const compute = () => {
      const limit = window.innerHeight * SPY_BAND;
      let active = els[0].id;
      for (const el of els) {
        if (el.getBoundingClientRect().top > limit) break;
        active = el.id;
      }
      setActiveId(active);
    };

    const io = new IntersectionObserver(compute, {
      rootMargin: `0px 0px -${Math.round((1 - SPY_BAND) * 100)}% 0px`,
    });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [open, items]);

  // Trava de scroll do fundo, só no overlay mobile. iOS ignora overflow:hidden
  // no body — o jeito confiável é position:fixed com o offset salvo (mesmo
  // padrão de LinkPickerModal).
  useEffect(() => {
    if (!open || isDesktop) return;
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
  }, [open, isDesktop]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open || items.length === 0) return null;

  const jump = (id: string) => {
    const scroll = () =>
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    if (isDesktop) {
      setActiveId(id);
      scroll();
      return;
    }
    // No mobile o drawer fecha primeiro. A limpeza da trava de scroll faz um
    // `window.scrollTo` de volta ao offset salvo, então o salto precisa vir
    // depois dela para não ser desfeito.
    setActiveId(id);
    onClose();
    setTimeout(scroll, 80);
  };

  return (
    <>
      {/* Backdrop: só no overlay mobile. */}
      <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={onClose} />

      <aside className="no-print fixed right-0 top-0 z-50 flex h-screen w-64 flex-col border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
            Sumário
          </span>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
            title="Fechar sumário"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {items.map((item) => {
            const active = item.id === activeId;
            return (
              <button
                key={item.id}
                onClick={() => jump(item.id)}
                className={`block w-full rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                  active
                    ? 'bg-brand/10 font-semibold text-brand dark:text-brand-light'
                    : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
                }`}
                style={{ paddingLeft: `${(item.level - 1) * 12 + 8}px` }}
              >
                <span className="line-clamp-2">{item.text}</span>
              </button>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
