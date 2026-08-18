'use client';

import { useState, useEffect, useRef } from 'react';
import { fuzzyFilter } from '@zettelkasten/core';
import type { Zettel } from '@zettelkasten/core';

interface Props {
  open: boolean;
  zettels: Zettel[];
  onSelect: (zettel: Zettel, asParent: boolean) => void;
  onClose: () => void;
}

export function LinkPickerModal({ open, zettels, onSelect, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [asParent, setAsParent] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = fuzzyFilter(zettels, query).slice(0, 20);

  useEffect(() => {
    if (open) {
      setQuery('');
      setAsParent(false);
      setTimeout(() => inputRef.current?.focus(), 50);
      // iOS ignores overflow:hidden on body. The reliable fix is position:fixed
      // with the scroll offset saved so the page doesn't jump on close.
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
    }
  }, [open]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <span className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Inserir Link</span>
          <button
            onClick={onClose}
            className="text-base font-medium text-brand hover:opacity-80"
          >
            Cancelar
          </button>
        </div>

        {/* Search */}
        <div className="p-3">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar zettel..."
            className="w-full rounded-xl bg-zinc-100 px-4 py-2.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </div>

        <label className="flex items-center gap-2 px-5 pb-2 text-xs text-zinc-500 dark:text-zinc-400">
          <input type="checkbox" checked={asParent} onChange={(e) => setAsParent(e.target.checked)} />
          Inserir como pai desta nota
        </label>

        {/* Results */}
        <div className="max-h-72 overflow-y-auto overscroll-contain pb-2">
          {results.length === 0 ? (
            <p className="py-10 text-center text-sm text-zinc-400">
              {zettels.length === 0 ? 'Nenhum zettel criado ainda.' : 'Nenhum resultado.'}
            </p>
          ) : (
            results.map((z) => (
              <button
                key={z.id}
                onClick={() => { setQuery(''); onSelect(z, asParent); }}
                className="w-full px-5 py-3.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{z.title}</div>
                {z.tags.length > 0 && (
                  <div className="mt-0.5 text-xs text-zinc-400">
                    {z.tags.map((t) => `#${t}`).join(' ')}
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
