'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useZettelStore } from '../store/useZettelStore';
import { useAuth } from '../providers/AuthProvider';
import { useSyncStore } from '../store/useSyncStore';
import { useOfflineRouter } from '../hooks/useOfflineRouter';
import type { SyncStatus } from '../lib/sync';
import { MarkdownCheatsheet } from './MarkdownCheatsheet';

function SyncDot({ status }: { status: SyncStatus }) {
  const map: Record<SyncStatus, { color: string; title: string }> = {
    idle:    { color: 'bg-zinc-300 dark:bg-zinc-600', title: 'Aguardando sync' },
    syncing: { color: 'bg-yellow-400 animate-pulse', title: 'Sincronizando...' },
    synced:  { color: 'bg-green-400', title: 'Sincronizado' },
    offline: { color: 'bg-zinc-400', title: 'Offline' },
    error:   { color: 'bg-red-400', title: 'Erro de sync' },
  };
  const { color, title } = map[status];
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${color}`}
      title={title}
    />
  );
}

export function Sidebar() {
  const { zettels, links, search, deleteZettel, activeTag, setActiveTag } = useZettelStore();
  const { user, logout } = useAuth();
  const syncStatus = useSyncStore((s) => s.status);
  const syncNow = useSyncStore((s) => s.syncNow);
  const [query, setQuery] = useState('');
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [orphanOnly, setOrphanOnly] = useState(false);
  const [noTagOnly, setNoTagOnly] = useState(false);
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false);
  const router = useRouter();
  const offlineRouter = useOfflineRouter();
  const pathname = usePathname();
  const searchRef = useRef<HTMLInputElement>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = useCallback(
    (text: string) => {
      setQuery(text);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => search(text), 300);
    },
    [search],
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (mod && e.key === 'n') {
        e.preventDefault();
        offlineRouter.push('/zettel/new');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [router]);

  const activeId = pathname.match(/\/zettel\/([^/]+)(?:\/edit)?$/)?.[1];

  const linkedIds = new Set(links.flatMap((l) => [l.sourceId, l.targetId]));
  const allTags = Array.from(new Set(zettels.flatMap((z) => z.tags))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  let displayed = activeTag ? zettels.filter((z) => z.tags.includes(activeTag)) : zettels;
  if (orphanOnly) displayed = displayed.filter((z) => !linkedIds.has(z.id));
  if (noTagOnly) displayed = displayed.filter((z) => z.tags.length === 0);

  if (pathname === '/login') return null;

  return (
    <aside className="app-sidebar hidden lg:flex flex-col w-80 shrink-0 h-screen bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800">
      {/* Header */}
      <div className="px-4 pt-5 pb-3 shrink-0">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-base font-bold text-zinc-900 dark:text-zinc-100">Zettelkasten</h1>
          <div className="flex items-center gap-0.5">
            <Link
              href="/"
              className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 transition-colors"
              title="Dashboard"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
            </Link>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => offlineRouter.push('/zettel/new')}
            className="flex-1 rounded-xl bg-brand px-3 py-2 text-sm font-semibold text-white hover:opacity-90 active:scale-95 transition-all"
            title="⌘N"
          >
            Novo
          </button>
          <Link
            href="/graph"
            className="flex flex-1 items-center justify-center rounded-xl border-2 border-brand bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-bold text-brand hover:bg-brand/5 dark:hover:bg-brand/10 active:scale-95 transition-all"
          >
            Mapa
          </Link>
          <Link
            href="/tags"
            className="flex w-9 h-9 items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 active:scale-95 transition-all"
            title="Tags"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>
            </svg>
          </Link>
          <button
            onClick={() => setCheatsheetOpen(true)}
            className="flex w-9 h-9 items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 active:scale-95 transition-all"
            title="Guia de formatação"
          >
            <span className="text-sm font-bold leading-none">?</span>
          </button>
          <Link
            href="/settings"
            className="flex w-9 h-9 items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 active:scale-95 transition-all"
            title="Configurações"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </Link>
        </div>

        {/* Search + orphan toggle */}
        <div className="flex items-center gap-2">
          <div className="flex flex-1 min-w-0 items-center gap-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 px-3 py-2">
            <span className="text-zinc-400 text-sm">⌕</span>
            <input
              ref={searchRef}
              className="flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
              placeholder="Buscar..."
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
            />
            {query && (
              <button onClick={() => handleSearch('')} className="text-xs text-zinc-400 hover:text-zinc-600">✕</button>
            )}
          </div>
          <button
            onClick={() => setOrphanOnly((v) => !v)}
            className={`shrink-0 rounded-xl bg-zinc-100 dark:bg-zinc-800 p-2 transition-colors ${orphanOnly ? 'text-amber-500' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'}`}
            title="Mostrar apenas zettels sem links"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/><line x1="2" y1="2" x2="22" y2="22"/>
            </svg>
          </button>
        </div>

        {/* Tag chips */}
        {allTags.length > 0 && (
          <div className="mt-2">
            <button
              onClick={() => setTagsExpanded((v) => !v)}
              className="flex w-full items-center justify-between text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            >
              <span className="truncate">
                Tags
                {activeTag && <span className="ml-1 font-medium text-brand">· #{activeTag}</span>}
              </span>
              <span className="shrink-0 ml-1">{tagsExpanded ? '▲' : '▼'} {allTags.length}</span>
            </button>
            {tagsExpanded && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                <button
                  onClick={() => setNoTagOnly((v) => !v)}
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
                    noTagOnly
                      ? 'bg-amber-500 text-white'
                      : 'bg-zinc-100 text-zinc-500 hover:bg-amber-100 hover:text-amber-600 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-amber-900/30 dark:hover:text-amber-400'
                  }`}
                >
                  sem tags
                </button>
                {allTags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
                      activeTag === tag
                        ? 'bg-brand text-white'
                        : 'bg-zinc-100 text-zinc-500 hover:bg-brand/10 hover:text-brand dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-brand/10 dark:hover:text-brand-light'
                    }`}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Zettel list */}
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {displayed.length === 0 ? (
          <p className="px-2 py-6 text-xs text-zinc-400 text-center">
            {activeTag ? `Nenhum zettel com #${activeTag}` : 'Nenhum zettel ainda'}
          </p>
        ) : (
          displayed.map((z) => {
            const isActive = z.id === activeId;
            return (
              <div
                key={z.id}
                className={`group flex items-center gap-2 rounded-xl px-3 py-2.5 mb-0.5 cursor-pointer transition-colors ${
                  isActive
                    ? 'bg-brand/10 dark:bg-brand/10'
                    : orphanOnly
                    ? 'border border-amber-300 dark:border-amber-600 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                    : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
                onClick={() => offlineRouter.push(`/zettel/${z.id}`)}
              >
                <span className={`flex-1 truncate text-sm font-medium leading-snug ${
                  isActive ? 'text-brand dark:text-brand-light' : 'text-zinc-800 dark:text-zinc-200'
                }`}>
                  {z.title}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`Excluir "${z.title}"?`)) deleteZettel(z.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 rounded-lg p-1 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-all"
                  title="Excluir"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" />
                  </svg>
                </button>
              </div>
            );
          })
        )}
      </div>

      <MarkdownCheatsheet open={cheatsheetOpen} onClose={() => setCheatsheetOpen(false)} />

      {/* Footer: sync status + user + logout */}
      <div className="px-4 py-3 shrink-0 border-t border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <button
            onClick={() => syncNow?.()}
            disabled={syncStatus === 'syncing' || !syncNow}
            className="flex items-center gap-1.5 disabled:cursor-default"
            title="Sincronizar agora"
          >
            <SyncDot status={syncStatus} />
            <span className="text-[11px] text-zinc-400">
              {zettels.length > 0
                ? `${zettels.length} ${zettels.length === 1 ? 'zettel' : 'zettels'}`
                : user?.username ?? ''}
              {orphanOnly && <span className="ml-1 text-amber-500">· sem links</span>}
            </span>
          </button>
          {user && (
            <button
              onClick={logout}
              className="text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
              title="Sair"
            >
              Sair
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
