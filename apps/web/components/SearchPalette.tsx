'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import type { Zettel } from '@zettelkasten/core';
import { useZettelStore } from '../store/useZettelStore';
import { useOfflineRouter } from '../hooks/useOfflineRouter';
import { searchZettels } from '../lib/searchZettels';
import { getRecentIds } from '../lib/recentZettels';
import { MarkdownRenderer } from './MarkdownRenderer';

const DEBOUNCE_MS = 200;
const RECENT_LIMIT = 30;
const SNIPPET_PAD = 60;

interface Snippet {
  before: string;
  match: string;
  after: string;
}

/**
 * Trecho do corpo em torno da primeira ocorrência do termo. Devolve as três
 * partes em vez de HTML: o destaque é composição de nós React, nunca
 * `dangerouslySetInnerHTML` — o corpo é conteúdo do usuário.
 */
function buildSnippet(body: string, query: string): Snippet | null {
  const text = body.replace(/\s+/g, ' ').trim();
  if (!text) return null;

  const head = (): Snippet => ({
    before: text.slice(0, SNIPPET_PAD * 2) + (text.length > SNIPPET_PAD * 2 ? '…' : ''),
    match: '',
    after: '',
  });

  const q = query.trim();
  if (!q) return head();

  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return head(); // casou por título ou tag

  const start = Math.max(0, idx - SNIPPET_PAD);
  const end = Math.min(text.length, idx + q.length + SNIPPET_PAD);
  return {
    before: (start > 0 ? '…' : '') + text.slice(start, idx),
    match: text.slice(idx, idx + q.length),
    after: text.slice(idx + q.length, end) + (end < text.length ? '…' : ''),
  };
}

export function SearchPalette() {
  const zettels = useZettelStore((s) => s.zettels);
  const controller = useZettelStore((s) => s.controller);
  const pathname = usePathname();
  const offlineRouter = useOfflineRouter();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Zettel[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  // Guard de geração: `lib/api.ts` não expõe `signal`, então a resposta de uma
  // busca antiga é descartada na chegada em vez de a requisição ser abortada.
  const genRef = useRef(0);

  // Zettels visitados recentemente, completados com o resto por data de
  // modificação. `open` entra nas dependências para reler o localStorage a cada
  // abertura — o histórico muda a cada visita a um zettel.
  const recents = useMemo(() => {
    const byId = new Map(zettels.map((z) => [z.id, z]));
    const out: Zettel[] = [];
    const seen = new Set<string>();
    for (const id of getRecentIds()) {
      const z = byId.get(id);
      if (z && !seen.has(id)) {
        out.push(z);
        seen.add(id);
      }
    }
    const rest = zettels
      .filter((z) => !seen.has(z.id))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return [...out, ...rest].slice(0, RECENT_LIMIT);
  }, [zettels, open]);

  // Atalho global. Compara `e.code` e não `e.key` pelo mesmo motivo do `Alt+T`
  // do TocDrawer e do `Alt+R` da Sidebar: onde o Alt compõe caractere (Option
  // no macOS) a comparação por caractere rejeitaria o atalho.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey || e.code !== 'KeyB') return;
      e.preventDefault();
      setOpen((prev) => !prev);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Estado limpo a cada abertura, foco no campo.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelectedIndex(0);
    setLoading(false);
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  // Scroll lock. iOS ignora overflow:hidden no body; o padrão do repo é
  // position:fixed com o deslocamento salvo para a página não saltar ao fechar.
  useEffect(() => {
    if (!open) return;
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

  // Busca. Query vazia resolve síncrono a partir dos recentes — sem debounce,
  // sem rede.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();

    if (!q) {
      genRef.current++;
      setResults(recents);
      setSelectedIndex(0);
      setLoading(false);
      return;
    }
    if (!controller) return;

    const gen = ++genRef.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const found = await searchZettels(controller, q);
        if (genRef.current !== gen) return;
        setResults(found);
        setSelectedIndex(0);
      } catch {
        if (genRef.current === gen) setResults([]);
      } finally {
        if (genRef.current === gen) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, open, controller, recents]);

  const selected: Zettel | undefined = results[selectedIndex];

  const openZettel = useCallback(
    (z: Zettel) => {
      setOpen(false);
      offlineRouter.push(`/zettel/${z.id}`);
    },
    [offlineRouter],
  );

  const openSelected = useCallback(() => {
    if (!selected) return;
    openZettel(selected);
  }, [selected, openZettel]);

  // Teclado da palette. Fase de captura para que o `Esc` chegue antes dos
  // listeners de outros overlays montados atrás (LinkPickerModal, cheatsheet).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        openSelected();
        return;
      }
      const down = e.key === 'ArrowDown' || (e.ctrlKey && (e.key === 'j' || e.key === 'J'));
      const up = e.key === 'ArrowUp' || (e.ctrlKey && (e.key === 'k' || e.key === 'K'));
      if (!down && !up) return;
      e.preventDefault();
      if (results.length === 0) return;
      // Para nas extremidades: dar a volta faz perder a noção de onde se está.
      setSelectedIndex((i) => Math.min(results.length - 1, Math.max(0, i + (down ? 1 : -1))));
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, results.length, openSelected]);

  // `nearest` para não sacudir a lista quando o item já está visível.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector(`[data-index="${selectedIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, open]);

  useEffect(() => {
    if (previewRef.current) previewRef.current.scrollTop = 0;
  }, [selected?.id]);

  if (!open || pathname === '/login') return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[8vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="flex h-[70vh] max-h-[42rem] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Campo de busca */}
        <div className="flex shrink-0 items-center gap-3 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-zinc-400">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar zettels..."
            className="min-w-0 flex-1 bg-transparent text-base text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
          />
          <span className="hidden shrink-0 text-xs text-zinc-400 lg:inline">
            {loading ? 'buscando…' : `${results.length} resultado${results.length === 1 ? '' : 's'}`}
          </span>
        </div>

        {/* Dois painéis: lista e preview. Abaixo de lg empilham, a lista com
            teto de 45% da altura da caixa. */}
        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,45%)_minmax(0,55%)] lg:grid-cols-[minmax(0,22rem)_1fr] lg:grid-rows-[minmax(0,1fr)]">
          {/* Lista */}
          <div
            ref={listRef}
            className="min-h-0 overflow-y-auto overscroll-contain border-b border-zinc-100 dark:border-zinc-800 lg:border-b-0 lg:border-r"
          >
            {results.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-zinc-400">
                {loading ? 'Buscando…' : 'Nenhum resultado.'}
              </p>
            ) : (
              results.map((z, idx) => {
                const snippet = buildSnippet(z.body, query);
                const active = idx === selectedIndex;
                return (
                  <button
                    key={z.id}
                    data-index={idx}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    // No desktop o `mouseenter` já selecionou, então o clique
                    // abre direto. No toque puro não há hover: o primeiro
                    // toque seleciona e mostra o preview, o segundo abre —
                    // senão o painel empilhado do mobile só mostraria o
                    // primeiro resultado da lista.
                    onClick={() => (idx === selectedIndex ? openZettel(z) : setSelectedIndex(idx))}
                    className={`block w-full border-l-2 px-4 py-2.5 text-left transition-colors ${
                      active
                        ? 'border-brand bg-zinc-100 dark:bg-zinc-800'
                        : 'border-transparent hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                    }`}
                  >
                    <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {z.title}
                    </div>
                    {z.tags.length > 0 && (
                      <div className="mt-0.5 truncate text-xs text-brand">
                        {z.tags.map((t) => `#${t}`).join(' ')}
                      </div>
                    )}
                    {snippet && (
                      <div className="mt-0.5 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">
                        {snippet.before}
                        {snippet.match && (
                          <mark className="bg-brand/20 text-zinc-900 dark:text-zinc-100">{snippet.match}</mark>
                        )}
                        {snippet.after}
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* Preview */}
          <div ref={previewRef} className="min-h-0 overflow-y-auto overscroll-contain px-5 py-4">
            {selected ? (
              <>
                <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{selected.title}</h2>
                {selected.tags.length > 0 && (
                  <div className="mt-1 mb-3 text-xs text-brand">
                    {selected.tags.map((t) => `#${t}`).join(' ')}
                  </div>
                )}
                <MarkdownRenderer
                  body={selected.body}
                  onLinkPress={() => {}}
                  disableWikiLinks
                  disableHeavyBlocks
                />
              </>
            ) : (
              <p className="pt-10 text-center text-sm text-zinc-400">
                Nenhum zettel selecionado.
              </p>
            )}
          </div>
        </div>

        {/* Rodapé com as teclas */}
        <div className="hidden shrink-0 items-center gap-4 border-t border-zinc-100 px-4 py-2 text-xs text-zinc-400 dark:border-zinc-800 lg:flex">
          <span><kbd className="font-sans">↑↓</kbd> navegar</span>
          <span><kbd className="font-sans">Enter</kbd> abrir</span>
          <span><kbd className="font-sans">Esc</kbd> fechar</span>
          <span className="ml-auto"><kbd className="font-sans">Alt+B</kbd></span>
        </div>
      </div>
    </div>
  );
}
