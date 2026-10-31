'use client';

import { useMemo, useState } from 'react';
import type { Level } from '@zettelkasten/core';
import { useLevelsStore } from '../../store/useLevelsStore';
import { useZettelStore } from '../../store/useZettelStore';
import { useSyncStore } from '../../store/useSyncStore';
import type { SyncStatus } from '../../lib/sync';
import { NeonButton } from '../zkos';
import { GalaxyMenu, type MenuAction } from '../galaxy/GalaxyTopBar';
import { useLevelActions } from './actions';
import { useLevelsEnv } from './LevelsContext';

const SYNC: Record<SyncStatus, { text: string; color: string }> = {
  idle: { text: 'SYNC ■ OK', color: 'var(--zk-green)' },
  synced: { text: 'SYNC ■ OK', color: 'var(--zk-green)' },
  syncing: { text: 'SYNC …', color: 'var(--zk-amber)' },
  offline: { text: 'OFFLINE', color: 'var(--zk-dim)' },
  error: { text: 'SYNC ✕ ERRO', color: '#ff6b6b' },
};

const LEVEL_TAG: Record<Level, string> = {
  focus: '1 · FOCO',
  memory: '2 · MEMÓRIA',
  map: '3 · MAPA',
};

/**
 * Barra de sistema do fluxo: marca ZK//OS, nível atual, busca, nova nota,
 * trilha (desktop), estado do sync e menu (Tags, Configurações, Passkeys…).
 */
export function LevelsTopBar({
  onSearch,
  onNew,
  onMenu,
}: {
  onSearch: () => void;
  onNew: () => void;
  onMenu: (a: MenuAction) => void;
}) {
  const { isMobile } = useLevelsEnv();
  const level = useLevelsStore((s) => s.level);
  const focusId = useLevelsStore((s) => s.focusId);
  const trail = useLevelsStore((s) => s.trail);
  const zettels = useZettelStore((s) => s.zettels);
  const status = useSyncStore((s) => s.status);
  const actions = useLevelActions();
  const [menuOpen, setMenuOpen] = useState(false);

  const titles = useMemo(() => new Map(zettels.map((z) => [z.id, z.title])), [zettels]);
  const sync = SYNC[status];

  const menu = (
    <div className="relative">
      <NeonButton aria-label="Menu" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)} style={{ padding: '0 12px', minWidth: 44 }}>
        ≡
      </NeonButton>
      {menuOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64">
          <GalaxyMenu
            status={status}
            onClose={() => setMenuOpen(false)}
            onAction={(a) => {
              setMenuOpen(false);
              onMenu(a);
            }}
          />
        </div>
      )}
    </div>
  );

  return (
    <header
      data-levels-topbar
      className="relative z-30 flex h-14 flex-none items-center gap-3 border-b-2 border-zk-cyan bg-zk-panel px-3 lg:gap-4 lg:px-5"
     
    >
      <div className="zk-display text-[28px] tracking-widest text-zk-magenta lg:text-[32px]">ZK//OS</div>
      <div className="zk-display border border-zk-cyan px-2 text-lg leading-6 text-zk-cyan lg:text-xl">{LEVEL_TAG[level]}</div>

      {!isMobile && (
        <>
          <button
            type="button"
            onClick={onSearch}
            aria-label="Buscar ou criar nota"
            className="flex h-10 w-[300px] flex-none cursor-text items-center gap-2 border bg-zk-inset px-3 text-left text-sm text-zk-dim"
            style={{ borderColor: '#2a6f80' }}
          >
            <span className="zk-display text-[22px] text-zk-green">&gt;</span>
            buscar ou criar nota_
          </button>
          <NeonButton variant="hot" onClick={onNew} style={{ fontSize: 20 }}>
            + NOVA
          </NeonButton>
          <div aria-hidden="true" className="h-[26px] w-px bg-zk-line" />
          <nav aria-label="Caminho" className="flex min-w-0 items-center gap-1 overflow-hidden">
            <span className="zk-display text-xl text-zk-dim">~/zk</span>
            {trail.map((id) => {
              const on = id === focusId;
              return (
                <span key={id} className="flex min-w-0 items-center gap-1">
                  <span aria-hidden="true" className="text-zk-dim">/</span>
                  <button
                    type="button"
                    onClick={() => void actions.focus(id)}
                    className="zk-display min-h-10 max-w-[150px] truncate px-2 text-xl"
                    style={{ background: on ? 'var(--zk-cyan)' : 'transparent', color: on ? 'var(--zk-black)' : 'var(--zk-text)' }}
                  >
                    {titles.get(id)?.trim() || 'Sem título'}
                  </button>
                </span>
              );
            })}
          </nav>
        </>
      )}

      <div className="zk-display ml-auto flex items-center gap-3 text-xl" style={{ color: sync.color }} aria-live="polite">
        {!isMobile && sync.text}
        {isMobile && <span aria-label={sync.text} className="h-2.5 w-2.5" style={{ background: sync.color }} />}
        {isMobile && (
          <>
            <NeonButton aria-label="Buscar" onClick={onSearch} style={{ padding: '0 8px', minWidth: 44, fontSize: 20 }}>
              &gt;_
            </NeonButton>
            <NeonButton aria-label="Nova nota" onClick={onNew} style={{ padding: '0 8px', minWidth: 44 }}>
              +
            </NeonButton>
          </>
        )}
        {menu}
      </div>
    </header>
  );
}
