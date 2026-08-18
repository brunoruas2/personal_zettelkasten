'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useZettelStore } from '../../store/useZettelStore';

export default function TagsPage() {
  const zettels = useZettelStore((s) => s.zettels);
  const router = useRouter();
  const [query, setQuery] = useState('');

  const tagCounts = zettels.reduce<Map<string, number>>((acc, z) => {
    z.tags.forEach((t) => acc.set(t, (acc.get(t) ?? 0) + 1));
    return acc;
  }, new Map());

  const sorted = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]);
  const filtered = query.trim()
    ? sorted.filter(([tag]) => tag.toLowerCase().includes(query.toLowerCase()))
    : sorted;

  return (
    <div className="mx-auto max-w-2xl px-4 pb-16 pt-6">
      {/* Header */}
      <div className="mb-4 flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="rounded-xl p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 transition-colors"
          title="Voltar"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <div>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Tags</h1>
          <p className="text-xs text-zinc-400">
            {filtered.length} {filtered.length === 1 ? 'tag' : 'tags'}
            {query && sorted.length !== filtered.length && ` de ${sorted.length}`}
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="mb-4 flex items-center gap-2 rounded-2xl bg-white px-4 py-3 shadow-sm dark:bg-zinc-900">
        <span className="text-lg text-zinc-400">⌕</span>
        <input
          autoFocus
          className="flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
          placeholder="Filtrar tags..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button onClick={() => setQuery('')} className="text-sm text-zinc-400 hover:text-zinc-600">
            ✕
          </button>
        )}
      </div>

      {sorted.length === 0 ? (
        <p className="pt-16 text-center text-sm text-zinc-400">Nenhuma tag ainda</p>
      ) : filtered.length === 0 ? (
        <p className="pt-16 text-center text-sm text-zinc-400">Nenhuma tag com "{query}"</p>
      ) : (
        <div className="space-y-1.5">
          {filtered.map(([tag, count]) => (
            <Link
              key={tag}
              href={`/?tag=${encodeURIComponent(tag)}`}
              className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 shadow-sm hover:shadow-md transition-shadow dark:bg-zinc-900"
            >
              <span className="text-sm font-medium text-brand dark:text-brand-light">
                #{tag}
              </span>
              <span className="rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand dark:text-brand-light">
                {count}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
