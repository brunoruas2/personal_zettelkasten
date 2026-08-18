'use client';

import { useState, useEffect, useRef } from 'react';

interface Props {
  open: boolean;
  defaultTitle: string;
  onConfirm: (title: string) => void;
  onClose: () => void;
}

export function ExtractTitleModal({ open, defaultTitle, onConfirm, onClose }: Props) {
  const [title, setTitle] = useState(defaultTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTitle(defaultTitle);
      setTimeout(() => inputRef.current?.focus(), 50);
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
  }, [open, defaultTitle]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const confirm = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
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
          <span className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Extrair para novo zettel</span>
          <button onClick={onClose} className="text-base font-medium text-brand hover:opacity-80">
            Cancelar
          </button>
        </div>

        <div className="p-5">
          <label className="mb-1.5 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Título do novo zettel
          </label>
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') confirm(); }}
            placeholder="Título..."
            className="w-full rounded-xl bg-zinc-100 px-4 py-2.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <button
            onClick={confirm}
            disabled={!title.trim()}
            className="mt-4 w-full rounded-xl bg-brand py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Criar zettel
          </button>
        </div>
      </div>
    </div>
  );
}
