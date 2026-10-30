'use client';

import { useEffect, useRef, useState } from 'react';
import { useSyncStore } from '../../store/useSyncStore';
import { useAuth } from '../../providers/AuthProvider';
import type { SyncStatus } from '../../lib/sync';
import type { SaveStatus } from './InplaceEditor';
import { hintOf, keysOf } from '../../lib/galaxy/shortcuts';
import { TOUCH_TARGET } from '../../lib/galaxy/touch';

const SAVE_LABEL: Record<SaveStatus, string> = {
  idle: '',
  saving: 'Salvando…',
  saved: 'Salvo',
  offline: 'Não salvo — offline',
  error: 'Erro ao salvar',
};

const SAVE_DOT: Record<SaveStatus, string> = {
  idle: 'bg-emerald-400',
  saving: 'bg-amber-300 animate-pulse',
  saved: 'bg-emerald-400',
  offline: 'bg-zinc-500',
  error: 'bg-red-400',
};

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

export type MenuAction = 'new' | 'capture' | 'search' | 'tags' | 'settings' | 'passkeys' | 'palette' | 'help';

/** Parada da trilha do Voltar. `fromTop === null`: o zettel atual (ou o "…" de paradas mais antigas). */
export interface TrailItem {
  key: string;
  fromTop: number | null;
  label: string;
  /** Zettel apagado: continua navegável como vista. */
  deleted: boolean;
  more?: boolean;
}

/** Barra flutuante: menu + marca + sync à esquerda, busca no centro, "sem lugar". */
export function GalaxyTopBar({
  unplaced,
  saveStatus,
  onSearch,
  onUnplaced,
  onMenu,
  onBack,
  backTitle,
  onForward,
  forwardTitle,
  trail = [],
  onTrail,
  tagFilter,
  onClearTag,
  onRetry,
}: {
  /** Presente só com algo a avançar (depois de um Voltar). */
  onForward?: () => void;
  forwardTitle?: string | null;
  /** Últimas paradas do Voltar até o zettel atual (só a partir de `lg`). */
  trail?: TrailItem[];
  onTrail?: (fromTop: number) => void;
  /** Filtro de tag ativo (tag e quantos zettels visíveis a têm). */
  tagFilter?: { tag: string; count: number } | null;
  onClearTag?: () => void;
  /** Repete o save pendente (só aparece com o save em erro). */
  onRetry?: () => void;
  unplaced: number;
  /** Estado do autosave da edição; enquanto houver, substitui o do sync. */
  saveStatus: SaveStatus;
  onSearch: () => void;
  onUnplaced: () => void;
  onMenu: (action: MenuAction) => void;
  /** Presente só com a pilha de saltos não vazia. */
  onBack?: () => void;
  /** Título do zettel de onde se saltou; `null` = só a vista anterior. */
  backTitle?: string | null;
}) {
  const status = useSyncStore((s) => s.status);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div data-galaxy-topbar className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between gap-3 p-3 font-geist lg:p-4">
      <div className="pointer-events-auto relative flex shrink-0 gap-2">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className={`flex items-center gap-3 rounded-xl border border-white/10 bg-[#0e121a]/90 px-3 py-2 text-[#e6e9f0] shadow-lg hover:bg-[#141925] ${TOUCH_TARGET}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>
          <span className="font-newsreader text-base font-medium">Galáxia</span>
          {/* Abaixo de `sm` só o ponto (o texto vai no `title`); o estado do save nunca some do celular. */}
          <span
            className="flex items-center gap-1.5 text-xs text-[#8b93a3]"
            title={saveStatus !== 'idle' ? SAVE_LABEL[saveStatus] : SYNC_LABEL[status]}
            aria-live="polite"
          >
            <span className={`h-2 w-2 rounded-full sm:h-1.5 sm:w-1.5 ${saveStatus !== 'idle' ? SAVE_DOT[saveStatus] : SYNC_DOT[status]}`} />
            <span className="hidden sm:inline">{saveStatus !== 'idle' ? SAVE_LABEL[saveStatus] : SYNC_LABEL[status]}</span>
          </span>
        </button>
        {saveStatus === 'error' && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className={`rounded-xl border border-red-400/40 bg-[#0e121a]/90 px-3 py-2 text-sm text-[#e6e9f0] shadow-lg hover:bg-[#141925] ${TOUCH_TARGET}`}
          >
            Tentar de novo
          </button>
        )}
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
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            title={`${backTitle ? `Voltar para «${backTitle}»` : 'Voltar à vista anterior'}${hintOf('back')}`}
            aria-label={backTitle ? `Voltar para ${backTitle}` : 'Voltar à vista anterior'}
            className={`rounded-xl border border-white/10 bg-[#0e121a]/90 px-3 py-2 text-sm text-[#e6e9f0] shadow-lg hover:bg-[#141925] ${TOUCH_TARGET}`}
          >
            ← <span className="hidden sm:inline">Voltar</span>
          </button>
        )}
        {onForward && (
          <button
            type="button"
            onClick={onForward}
            title={forwardTitle ? `Avançar para «${forwardTitle}»` : 'Avançar à vista seguinte'}
            aria-label={forwardTitle ? `Avançar para ${forwardTitle}` : 'Avançar à vista seguinte'}
            className={`rounded-xl border border-white/10 bg-[#0e121a]/90 px-3 py-2 text-sm text-[#e6e9f0] shadow-lg hover:bg-[#141925] ${TOUCH_TARGET}`}
          >
            <span className="hidden sm:inline">Avançar</span> →
          </button>
        )}
        {tagFilter && (
          <div className="flex items-center gap-1 rounded-xl border border-brand/40 bg-[#0e121a]/90 py-1 pl-3 pr-1 text-sm text-[#e6e9f0] shadow-lg">
            <span className="max-w-[10rem] truncate">
              #{tagFilter.tag} <span className="text-xs text-[#8b93a3]">· {tagFilter.count}</span>
            </span>
            <button
              type="button"
              onClick={onClearTag}
              aria-label={`Limpar o filtro da tag ${tagFilter.tag} (Esc)`}
              title="Limpar o filtro (Esc)"
              className={`flex h-8 w-8 items-center justify-center rounded-lg text-[#c9cfdb] hover:bg-white/10 ${TOUCH_TARGET}`}
            >
              ×
            </button>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onSearch}
        className={`pointer-events-auto flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-white/10 bg-[#0e121a]/90 px-4 py-2 text-left text-sm text-[#8b93a3] shadow-lg hover:bg-[#141925] sm:max-w-md ${TOUCH_TARGET}`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <span className="min-w-0 flex-1 truncate">Buscar na galáxia</span>
        <kbd className="hidden rounded border border-white/10 px-1.5 text-[11px] lg:inline">{keysOf("search")}</kbd>
      </button>

      {trail.length > 0 && (
        <nav
          aria-label="Trilha de zettels visitados"
          className="pointer-events-auto absolute left-4 top-[4.25rem] hidden max-w-[calc(100%-2rem)] items-center gap-1 overflow-hidden rounded-lg border border-white/10 bg-[#0e121a]/90 px-2 py-1 text-xs shadow-lg lg:flex"
        >
          {trail.map((it, i) => (
            <span key={it.key} className="flex min-w-0 items-center gap-1">
              {i > 0 && <span aria-hidden="true" className="text-[#6f7787]">›</span>}
              {it.fromTop !== null && onTrail ? (
                <button
                  type="button"
                  onClick={() => onTrail(it.fromTop!)}
                  className={`max-w-[10rem] truncate rounded px-1.5 py-0.5 hover:bg-white/10 ${it.deleted ? 'italic text-[#8b93a3]' : 'text-[#c9cfdb]'}`}
                >
                  {it.deleted ? '(apagado)' : it.label}
                </button>
              ) : (
                <span
                  aria-current={it.more ? undefined : 'location'}
                  className={`max-w-[10rem] truncate px-1.5 py-0.5 ${it.more ? 'text-[#8b93a3]' : 'font-medium text-[#f5f3ff]'}`}
                >
                  {it.label}
                </span>
              )}
            </span>
          ))}
        </nav>
      )}

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
    { action: 'capture', label: 'Captura rápida', hint: keysOf('capture') },
    { action: 'palette', label: 'Paleta de comandos', hint: keysOf('palette') },
    { action: 'search', label: 'Buscar', hint: keysOf('search') },
    { action: 'tags', label: 'Tags' },
    { action: 'settings', label: 'Configurações', hint: keysOf('settings') },
    { action: 'passkeys', label: 'Passkeys' },
    { action: 'help', label: 'Atalhos', hint: keysOf('help') },
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
  const btn = `hidden px-3 py-1.5 text-sm text-[#c9cfdb] hover:bg-white/5 lg:block ${TOUCH_TARGET}`;
  return (
    <div
      className="absolute right-4 z-30 flex items-center gap-2 font-geist"
      style={{ bottom: 'max(1rem, env(safe-area-inset-bottom))' }}
    >
      <div className="flex items-center overflow-hidden rounded-xl border border-white/10 bg-[#0e121a]/90 shadow-lg">
        <button type="button" onClick={onZoomOut} className={btn} title={`Afastar${hintOf('zoom-out')}`} aria-label="Afastar">−</button>
        <span className="min-w-[3.5rem] text-center text-xs tabular-nums text-[#8b93a3]">{formatScale(scale)}</span>
        <button type="button" onClick={onZoomIn} className={btn} title={`Aproximar${hintOf('zoom-in')}`} aria-label="Aproximar">+</button>
      </div>
      <button
        type="button"
        onClick={onFit}
        title={`Ver tudo${hintOf('fit')} · ${keysOf('zoom-max')} alterna entre 150% e Ver tudo`}
        className={`rounded-xl border border-white/10 bg-[#0e121a]/90 px-3 py-1.5 text-sm text-[#c9cfdb] shadow-lg hover:bg-white/5 ${TOUCH_TARGET}`}
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
