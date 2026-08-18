'use client';

import { useState, useEffect, useRef } from 'react';
import { TagInput } from './TagInput';
import { TipTapEditor } from './TipTapEditor';
import type { Zettel } from '@zettelkasten/core';

interface Props {
  open: boolean;
  mode: 'create' | 'edit';
  nodeId?: string;
  originTitle: string;
  originTags: string[];
  initialTitle?: string;
  initialBody?: string;
  suggestions: string[];
  zettels: Zettel[];
  onClose: () => void;
  onSubmit: (data: { title: string; body: string; tags: string[] }) => Promise<void>;
}

export function CreateFromNodeModal({
  open,
  mode,
  nodeId,
  originTitle,
  originTags,
  initialTitle,
  initialBody,
  suggestions,
  zettels,
  onClose,
  onSubmit,
}: Props) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const initialSnapshotRef = useRef<{ title: string; body: string; tags: string[] }>({
    title: '',
    body: '',
    tags: [],
  });

  useEffect(() => {
    if (open) {
      let initialTitleValue: string;
      let initialBodyValue: string;
      if (mode === 'edit') {
        initialTitleValue = initialTitle ?? '';
        initialBodyValue = initialBody ?? '';
      } else {
        initialTitleValue = '';
        initialBodyValue = `[[^${originTitle}]]\n\n`;
      }
      const initialTagsValue = [...originTags];

      setTitle(initialTitleValue);
      setBody(initialBodyValue);
      setTags(initialTagsValue);
      initialSnapshotRef.current = { title: initialTitleValue, body: initialBodyValue, tags: initialTagsValue };
      setTimeout(() => titleRef.current?.focus(), 50);

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
  }, [open, mode, originTitle, originTags, initialTitle, initialBody]);

  const isDirty =
    title !== initialSnapshotRef.current.title ||
    body !== initialSnapshotRef.current.body ||
    tags.length !== initialSnapshotRef.current.tags.length ||
    tags.some((t, i) => t !== initialSnapshotRef.current.tags[i]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isDirty) onClose();
    };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, isDirty, onClose]);

  if (!open) return null;

  const handleBackdropClick = () => {
    if (!isDirty) onClose();
  };

  const handleSave = async () => {
    const trimmed = title.trim();
    if (!trimmed || isSaving) return;
    setIsSaving(true);
    try {
      await onSubmit({ title: trimmed, body, tags });
    } finally {
      setIsSaving(false);
    }
  };

  const isEdit = mode === 'edit';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={handleBackdropClick}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-2xl bg-white shadow-2xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <span className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            {isEdit ? 'Editar zettel' : 'Novo zettel conectado'}
          </span>
          <button onClick={onClose} className="text-base font-medium text-brand hover:opacity-80">
            Cancelar
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain p-5">
          <label className="mb-1.5 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Título</label>
          <input
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Título do novo zettel..."
            className="w-full rounded-xl bg-zinc-100 px-4 py-2.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:bg-zinc-800 dark:text-zinc-100"
          />

          <label className="mb-1.5 mt-4 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Corpo</label>
          <TipTapEditor
            key={open ? `${mode}-${nodeId ?? originTitle}` : 'closed'}
            value={body}
            onChange={setBody}
            placeholder="Escreva aqui... use [[título]] para links ou / para inserir blocos"
            zettels={zettels}
            spellCheck
            className="min-h-[24rem] w-full rounded-xl bg-zinc-100 px-4 py-2.5 text-sm text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
          />

          <TagInput tags={tags} onChange={setTags} suggestions={suggestions} />

          <button
            onClick={handleSave}
            disabled={!title.trim() || isSaving}
            className="mt-4 w-full rounded-xl bg-brand py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {isSaving ? (isEdit ? 'Salvando...' : 'Criando...') : (isEdit ? 'Salvar alterações' : 'Criar zettel')}
          </button>
        </div>
      </div>
    </div>
  );
}
