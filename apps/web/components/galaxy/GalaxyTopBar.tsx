'use client';

import { useEffect, useRef, useState } from 'react';
import { useSyncStore } from '../../store/useSyncStore';
import { useAuth } from '../../providers/AuthProvider';
import type { SyncStatus } from '../../lib/sync';

const SYNC_LABEL: Record<SyncStatus, string> = {
  idle: 'Sincronizado',
  synced: 'Sincronizado',
  syncing: 'Sincronizando…',
  offline: 'Offline',
  error: 'Erro de sincronização',
};

const SYNC_DOT: Record<SyncStatus, string> = {
  idle: 'bg-emerald-400',
  synced: 'bg-emerald-400',
  syncing: 'bg-amber-300 animate-pulse',
  offline: 'bg-zinc-500',
  error: 'bg-red-400',
};

export type MenuAction = 'new' | 'search' | 'tags' | 'settings' | 'passkeys';

/** Barra flutuante: menu + marca + sync à esquerda, busca no centro, "sem lugar". */
export function GalaxyTopBar({
  unplaced,
  onSearch,
  onUnplaced,
  onMenu,
}: {
  unplaced: number;
  onSearch: () => void;
  onUnplaced: () => void;
  onMenu: (action: MenuAction) => void;
}) {
  const status = useSyncStore((s) => s.status);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between gap-3 p-3 font-geist lg:p-4">
      <div className="pointer-events-auto relative">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#0e121a]/90 px-3 py-2 text-[#e6e9f0] shadow-lg hover:bg-[#141925]"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>
          <span className="font-newsreader text-base font-medium">Galáxia</span>
          <span className="hidden items-center gap-1.5 text-xs text-[#8b93a3] sm:flex">
            <span className={`h-1.5 w-1.5 rounded-full ${SYNC_DOT[status]}`} />
            {SYNC_LABEL[status]}
          </span>
        </button>
        {menuOpen && (
          <GalaxyMenu
            status={status}
            onClose={() => setMenuOpen(false)}
            onAction={(a) => {
              setMenuOpen(false);
              onMenu(a);
            }}
          />
        )}
      </div>

      <button
        type="button"
        onClick={onSearch}
        className="pointer-events-auto flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-white/10 bg-[#0e121a]/90 px-4 py-2 text-left text-sm text-[#8b93a3] shadow-lg hover:bg-[#141925] sm:max-w-md"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <span className="min-w-0 flex-1 truncate">Buscar na galáxia</span>
        <kbd className="hidden rounded border border-white/10 px-1.5 text-[11px] lg:inline">Alt B</kbd>
      </button>

      <div className="pointer-events-auto hidden w-[9.5rem] justify-end lg:flex">
        {unplaced > 0 && (
          <button
            type="button"
            onClick={onUnplaced}
            title="Zettels que ainda não têm lugar na galáxia"
            className="rounded-xl border border-amber-300/20 bg-[#0e121a]/90 px-3 py-2 text-xs text-amber-200 shadow-lg hover:bg-[#141925]"
          >
            {unplaced} sem lugar
          </button>
        )}
      </div>
    </div>
  );
}

function GalaxyMenu({
  status,
  onClose,
  onAction,
}: {
  status: SyncStatus;
  onClose: () => void;
  onAction: (a: MenuAction) => void;
}) {
  const { user, logout } = useAuth();
  const syncNow = useSyncStore((s) => s.syncNow);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // Adiado: o próprio clique que abriu o menu não pode fechá-lo.
    const t = setTimeout(() => document.addEventListener('pointerdown', onDown), 0);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const item = 'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-white/5';
  const items: { action: MenuAction; label: string; hint?: string }[] = [
    // Temporário: até a criação no lugar (duplo clique na galáxia), o novo
    // zettel nasce na página antiga.
    { action: 'new', label: 'Novo zettel' },
    { action: 'search', label: 'Buscar', hint: 'Alt B' },
    { action: 'tags', label: 'Tags' },
    { action: 'settings', label: 'Configurações', hint: 'Alt ,' },
    { action: 'passkeys', label: 'Passkeys' },
  ];

  return (
    <div
      ref={ref}
      role="menu"
      className="absolute left-0 top-full mt-2 w-64 rounded-xl border border-white/10 bg-[#0e121a] p-2 text-[#e6e9f0] shadow-2xl"
    >
      <div className="flex items-center gap-3 border-b border-white/10 px-2 pb-3 pt-1">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white">
          {(user?.username ?? '?').slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{user?.username ?? '—'}</div>
          <div className="text-xs text-[#8b93a3]">{SYNC_LABEL[status]}</div>
        </div>
      </div>
      <div className="py-1">
        {items.map((it) => (
          <button key={it.action} type="button" role="menuitem" className={item} onClick={() => onAction(it.action)}>
            {it.label}
            {it.hint && <span className="text-[11px] text-[#6f7787]">{it.hint}</span>}
          </button>
        ))}
        <button type="button" role="menuitem" disabled className={`${item} cursor-not-allowed text-[#6f7787] hover:bg-transparent`}>
          Estatísticas — em breve
        </button>
      </div>
      <div className="border-t border-white/10 pt-1">
        <button
          type="button"
          role="menuitem"
          className={item}
          disabled={!syncNow}
          onClick={() => {
            onClose();
            void syncNow?.();
          }}
        >
          Sincronizar agora
        </button>
        <button
          type="button"
          role="menuitem"
          className={`${item} text-red-300`}
          onClick={() => {
            onClose();
            void logout();
          }}
        >
          Sair
        </button>
      </div>
    </div>
  );
}

/** Controles de zoom no canto inferior direito. */
export function ZoomControls({
  scale,
  onZoomIn,
  onZoomOut,
  onFit,
}: {
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}) {
  const btn = 'px-3 py-1.5 text-sm text-[#c9cfdb] hover:bg-white/5';
  return (
    <div className="absolute bottom-4 right-4 z-30 flex items-center gap-2 font-geist">
      <div className="flex items-center overflow-hidden rounded-xl border border-white/10 bg-[#0e121a]/90 shadow-lg">
        <button type="button" onClick={onZoomOut} className={btn} title="Afastar (−)">−</button>
        <span className="min-w-[3.5rem] text-center text-xs tabular-nums text-[#8b93a3]">{formatScale(scale)}</span>
        <button type="button" onClick={onZoomIn} className={btn} title="Aproximar (+)">+</button>
      </div>
      <button
        type="button"
        onClick={onFit}
        title="Ver tudo (0)"
        className="rounded-xl border border-white/10 bg-[#0e121a]/90 px-3 py-1.5 text-sm text-[#c9cfdb] shadow-lg hover:bg-white/5"
      >
        Ver tudo
      </button>
    </div>
  );
}

function formatScale(scale: number): string {
  const pct = scale * 100;
  if (pct < 1) return `${pct.toFixed(1).replace('.', ',')}%`;
  return `${Math.round(pct)}%`;
}
