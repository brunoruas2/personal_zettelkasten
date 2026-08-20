'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Container onde procurar os headings — o do modo atualmente visível. */
  contentRef: RefObject<HTMLElement | null>;
  /** Elemento que rola. `null` quando quem rola é o documento. */
  scrollRef?: RefObject<HTMLElement | null> | null;
  /** Muda quando o conteúdo muda; só serve para disparar a re-consulta. */
  revision: string;
}

interface TocEntry {
  text: string;
  level: number;
  el: HTMLElement;
}

/** Fração da altura do container de scroll que delimita a faixa do scroll spy. */
const SPY_BAND = 0.3;

/**
 * `revision` muda a cada tecla, mas a lista quase nunca muda junto. Sem esta
 * comparação, todo caractere digitado geraria um array novo, e o efeito do
 * spy recriaria o IntersectionObserver e zeraria o destaque.
 */
function sameEntries(a: TocEntry[], b: TocEntry[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((entry, i) => entry.el === b[i].el && entry.text === b[i].text && entry.level === b[i].level);
}

export function TocDrawer({ open, onClose, contentRef, scrollRef, revision }: Props) {
  const [entries, setEntries] = useState<TocEntry[]>([]);
  const entriesRef = useRef<TocEntry[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // Itens e alvos saem da MESMA consulta, no container do modo ativo. Nas
  // páginas de editor o preview e o editor ficam os dois montados (só a classe
  // `hidden` alterna), então resolver por `document.getElementById` acharia os
  // headings do container escondido — nó em display:none não rola e tem rect
  // zerado. `contentRef` troca de identidade quando o modo troca, o que faz
  // este efeito rodar de novo.
  useEffect(() => {
    if (!open) return;
    const root = contentRef.current;
    const found = root
      ? Array.from(root.querySelectorAll<HTMLElement>('h1, h2, h3')).map((el) => ({
          text: (el.textContent ?? '').trim(),
          level: Number(el.tagName.slice(1)),
          el,
        }))
      : [];
    if (sameEntries(entriesRef.current, found)) return;
    entriesRef.current = found;
    setEntries(found);
    setActiveIndex(0);
  }, [open, revision, contentRef]);

  // Scroll spy. O observer é só o gatilho barato; o item ativo é recalculado
  // dos rects para ficar determinístico quando várias seções curtas entram na
  // faixa no mesmo frame. A faixa é medida do topo do container de scroll — na
  // leitura ele preenche o viewport, no editor não (nav e título acima,
  // toolbar abaixo).
  useEffect(() => {
    if (!open || entries.length === 0) return;

    const compute = () => {
      const root = scrollRef?.current ?? null;
      const box = root?.getBoundingClientRect();
      const top = box ? box.top : 0;
      const height = box ? box.height : window.innerHeight;
      const limit = top + height * SPY_BAND;

      let active = 0;
      for (let i = 0; i < entries.length; i++) {
        if (entries[i].el.getBoundingClientRect().top > limit) break;
        active = i;
      }
      setActiveIndex(active);
    };

    const io = new IntersectionObserver(compute, {
      root: scrollRef?.current ?? null,
      rootMargin: `0px 0px -${Math.round((1 - SPY_BAND) * 100)}% 0px`,
    });
    entries.forEach((entry) => io.observe(entry.el));
    return () => io.disconnect();
  }, [open, entries, scrollRef]);

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

  const jump = useCallback(
    (index: number) => {
      const el = entries[index]?.el;
      if (!el) return;
      setActiveIndex(index);

      const scroll = () => el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (isDesktop) {
        scroll();
        return;
      }
      // No mobile o drawer fecha primeiro. A limpeza da trava de scroll faz um
      // `window.scrollTo` de volta ao offset salvo, então o salto precisa vir
      // depois dela para não ser desfeito.
      onClose();
      setTimeout(scroll, 80);
    },
    [entries, isDesktop, onClose],
  );

  if (!open || entries.length === 0) return null;

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
          {entries.map((entry, index) => {
            const active = index === activeIndex;
            return (
              <button
                key={index}
                onClick={() => jump(index)}
                className={`block w-full rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                  active
                    ? 'bg-brand/10 font-semibold text-brand dark:text-brand-light'
                    : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
                }`}
                style={{ paddingLeft: `${(entry.level - 1) * 12 + 8}px` }}
              >
                <span className="line-clamp-2">{entry.text}</span>
              </button>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
