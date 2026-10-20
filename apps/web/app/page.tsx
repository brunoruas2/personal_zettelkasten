'use client';

import { useState, useCallback, useRef, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { OfflineLink } from '../components/OfflineLink';
import { useOfflineRouter } from '../hooks/useOfflineRouter';
import { useZettelStore } from '../store/useZettelStore';
import { useSyncStore } from '../store/useSyncStore';
import { useAuth } from '../providers/AuthProvider';
import { isPasskeySupported } from '../lib/webauthn';
import { Dashboard } from '../components/Dashboard';
import type { Zettel } from '@zettelkasten/core';

function ZettelCard({
  zettel,
  onDelete,
  onTagClick,
  orphan,
}: {
  zettel: Zettel;
  onDelete: () => void;
  onTagClick: (tag: string) => void;
  orphan?: boolean;
}) {
  const preview = zettel.body
    .replace(/#{1,3} .+/g, '')
    .replace(/\[\[|\]\]/g, '')
    .replace(/\*\*|__|\*|_/g, '')
    .trim()
    .slice(0, 100);

  return (
    <OfflineLink
      href={`/zettel/${zettel.id}`}
      className={`block rounded-2xl bg-white p-4 shadow-sm transition-shadow hover:shadow-md dark:bg-zinc-900 ${
        orphan ? 'border-2 border-amber-400 dark:border-amber-500' : ''
      }`}
    >
      {/* Title row */}
      <div className="mb-1 flex items-start gap-2">
        <span className="flex-1 line-clamp-1 text-base font-semibold text-zinc-900 dark:text-zinc-100">
          {zettel.title}
        </span>
      </div>

      {preview && (
        <p className="line-clamp-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
          {preview}
        </p>
      )}

      {zettel.tags.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {zettel.tags.map((tag) => (
            <button
              key={tag}
              onClick={(e) => { e.preventDefault(); onTagClick(tag); }}
              className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand hover:bg-brand hover:text-white transition-colors dark:text-brand-light"
            >
              #{tag}
            </button>
          ))}
        </div>
      )}

      {/* Footer row: date + delete */}
      <div className="mt-3 flex items-center justify-between">
        <span className="text-[11px] text-zinc-400">
          {new Date(zettel.updatedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
        </span>
        <button
          onClick={(e) => {
            e.preventDefault();
            if (window.confirm(`Excluir "${zettel.title}"?`)) onDelete();
          }}
          className="rounded-lg p-1.5 text-zinc-300 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950"
          title="Excluir"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" />
          </svg>
        </button>
      </div>
    </OfflineLink>
  );
}

function HomePageContent() {
  const { zettels, links, search, isLoading, deleteZettel, activeTag, setActiveTag } = useZettelStore((s) => s);
  const syncNow = useSyncStore((s) => s.syncNow);
  const syncStatus = useSyncStore((s) => s.status);
  const { logout } = useAuth();
  const router = useRouter();
  const offlineRouter = useOfflineRouter();
  const searchParams = useSearchParams();

  const [query, setQuery] = useState('');
  useEffect(() => { setActiveTag(searchParams.get('tag')); }, [searchParams]);
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [orphanOnly, setOrphanOnly] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = useCallback(
    (text: string) => {
      setQuery(text);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => search(text), 300);
    },
    [search],
  );

  const handleTagClick = useCallback((tag: string) => {
    setActiveTag(activeTag === tag ? null : tag);
  }, [activeTag, setActiveTag]);

  const linkedIds = new Set(links.flatMap((l) => [l.sourceId, l.targetId]));

  const allTags = Array.from(new Set(zettels.flatMap((z) => z.tags))).sort((a, b) => a.localeCompare(b, 'pt-BR'));

  let displayed = activeTag ? zettels.filter((z) => z.tags.includes(activeTag)) : zettels;
  if (orphanOnly) displayed = displayed.filter((z) => !linkedIds.has(z.id));

  return (
    <>
      {/* Desktop: dashboard */}
      <div className="hidden lg:block h-full">
        <Dashboard zettels={zettels} links={links} />
      </div>

      {/* Mobile: layout original */}
      <div className="lg:hidden mx-auto max-w-2xl px-4 pb-32 pt-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Zettelkasten</h1>
          <div className="flex items-center gap-1">
            <button
              onClick={() => syncNow?.()}
              disabled={syncStatus === 'syncing' || !syncNow}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-default transition-colors"
              title="Sincronizar"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={syncStatus === 'syncing' ? 'animate-spin' : ''}>
                <path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
              </svg>
              Sync
            </button>
            {isPasskeySupported() && (
              <button
                onClick={() => offlineRouter.push('/passkeys')}
                className="rounded-xl p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                title="Face ID / Touch ID"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="9" cy="10" r="1"/><circle cx="15" cy="10" r="1"/><path d="M9.5 15a3.5 3.5 0 0 0 5 0"/>
                </svg>
              </button>
            )}
            <button
              onClick={() => offlineRouter.push('/tags')}
              className="rounded-xl p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              title="Tags"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>
              </svg>
            </button>
            <button
              onClick={() => offlineRouter.push('/settings')}
              className="rounded-xl p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              title="Configurações"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
            <button
              onClick={logout}
              className="rounded-xl p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              title="Sair"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Search + orphan toggle */}
        <div className="mb-4 flex items-center gap-2 rounded-2xl bg-white px-4 py-3 shadow-sm dark:bg-zinc-900">
          <span className="text-lg text-zinc-400">⌕</span>
          <input
            className="flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
            placeholder="Buscar zettels..."
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
          />
          {query && (
            <button onClick={() => handleSearch('')} className="text-sm text-zinc-400 hover:text-zinc-600">
              ✕
            </button>
          )}
          <button
            onClick={() => setOrphanOnly((v) => !v)}
            className={`shrink-0 transition-colors ${orphanOnly ? 'text-amber-500' : 'text-zinc-400 hover:text-zinc-600'}`}
            title="Mostrar apenas zettels sem links"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/><line x1="2" y1="2" x2="22" y2="22"/>
            </svg>
          </button>
        </div>

        {/* Tag chips */}
        {allTags.length > 0 && !query && (
          <div className="mb-3">
            <button
              onClick={() => setTagsExpanded((v) => !v)}
              className="flex w-full items-center justify-between rounded-2xl bg-white px-4 py-2.5 shadow-sm text-xs text-zinc-400 hover:text-zinc-600 dark:bg-zinc-900 dark:hover:text-zinc-300 transition-colors"
            >
              <span>
                Tags
                {activeTag && <span className="ml-1 font-medium text-brand">· #{activeTag}</span>}
              </span>
              <span>{tagsExpanded ? '▲' : '▼'} {allTags.length}</span>
            </button>
            {tagsExpanded && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {allTags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => handleTagClick(tag)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      activeTag === tag
                        ? 'bg-brand text-white'
                        : 'bg-white text-zinc-500 shadow-sm hover:bg-brand/10 hover:text-brand dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-brand/10 dark:hover:text-brand-light'
                    }`}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Stats */}
        {!query && (
          <p className="mb-3 text-xs text-zinc-400">
            {displayed.length} {displayed.length === 1 ? 'zettel' : 'zettels'}
            {activeTag && <span> com <span className="font-medium text-brand">#{activeTag}</span></span>}
            {orphanOnly && <span className="ml-1 text-amber-500">· sem links</span>}
          </p>
        )}

        {/* List */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="rounded-2xl bg-white p-4 shadow-sm dark:bg-zinc-900 animate-pulse">
                <div className="mb-2 h-4 w-2/3 rounded bg-zinc-200 dark:bg-zinc-700" />
                <div className="h-3 w-full rounded bg-zinc-100 dark:bg-zinc-800" />
                <div className="mt-1 h-3 w-4/5 rounded bg-zinc-100 dark:bg-zinc-800" />
                <div className="mt-3 h-2.5 w-16 rounded bg-zinc-100 dark:bg-zinc-800" />
              </div>
            ))}
          </div>
        ) : displayed.length === 0 && zettels.length === 0 ? (
          <div className="pt-16 text-center">
            <div className="mb-4 text-5xl text-brand">✦</div>
            <p className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Nenhum zettel ainda</p>
            <p className="mt-2 text-sm text-zinc-500">
              Clique em{' '}
              <span className="font-semibold text-brand">+ Novo Zettel</span>
              {' '}para começar sua base de conhecimento.
            </p>
          </div>
        ) : displayed.length === 0 ? (
          <p className="pt-16 text-center text-sm text-zinc-400">
            {orphanOnly ? 'Nenhum zettel órfão' : `Nenhum zettel com #${activeTag}`}
          </p>
        ) : (
          <div className="space-y-3">
            {displayed.map((z) => (
              <ZettelCard
                key={z.id}
                zettel={z}
                onDelete={() => deleteZettel(z.id)}
                onTagClick={handleTagClick}
                orphan={orphanOnly}
              />
            ))}
          </div>
        )}

        {/* FAB */}
        <div className="fixed bottom-0 left-0 right-0 bg-gradient-to-t from-zinc-50 via-zinc-50/95 to-transparent pb-6 pt-10 dark:from-zinc-950 dark:via-zinc-950/95 dark:to-transparent">
        <div className="flex justify-center gap-3 px-4">
          <Link
            href="/graph"
            className="flex flex-1 items-center justify-center gap-2 rounded-2xl border-2 border-brand bg-white px-6 py-4 text-base font-bold text-brand shadow-lg shadow-brand/10 hover:bg-brand/5 active:scale-95 transition-all dark:bg-zinc-900 dark:hover:bg-brand/10"
          >
            <span className="text-lg leading-none">✦</span> Mapa
          </Link>
          <Link
            href="/zettel/new"
            className="flex-1 rounded-2xl bg-brand px-6 py-4 text-center text-base font-bold text-white shadow-lg shadow-brand/30 hover:opacity-90 active:scale-95 transition-all"
          >
            + Novo Zettel
          </Link>
        </div>
        </div>
      </div>
    </>
  );
}

export default function HomePage() {
  return (
    <Suspense>
      <HomePageContent />
    </Suspense>
  );
}
