'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLevelsStore } from '../../store/useLevelsStore';
import { useZettelStore } from '../../store/useZettelStore';
import { useDeleteRequestStore } from '../../store/useDeleteRequestStore';
import { DeleteZettelModal } from '../galaxy/DeleteZettelModal';
import { NeonButton, Vignette } from '../zkos';
import { GalaxyModal } from '../galaxy/GalaxyModal';
import { GalaxySearch, type SearchFilters } from '../galaxy/GalaxySearch';
import { QuickCapture } from '../galaxy/QuickCapture';
import { ThemeVariantContext } from '../galaxy/themeVariant';
import { CommandPalette, type PaletteAction } from '../galaxy/CommandPalette';
import type { MenuAction } from '../galaxy/GalaxyTopBar';
import { SettingsPanel } from '../panels/SettingsPanel';
import { TagsPanel } from '../panels/TagsPanel';
import { PasskeysPanel } from '../panels/PasskeysPanel';
import { FocusScreen } from './FocusScreen';
import { MemoryScreen, CompactWindow } from './MemoryScreen';
import { MapScreen } from './MapScreen';
import { LevelsTopBar } from './LevelsTopBar';
import { LevelsEnvProvider, useLevelsEnv } from './LevelsContext';
import { useLevelsSync } from './useLevelsSync';
import { useLevelActions, deleteFromLevels } from './actions';
import { captureNote, createNote } from './newNote';

const TRACK_TRANSITION = 'transform .8s cubic-bezier(.7,0,.2,1)';

/** Fluxo Foco → Memória → Mapa (spec level-navigation). Desktop: duas telas empilhadas; celular: três. */
export function Levels() {
  return (
    <ThemeVariantContext.Provider value="zkos">
      <LevelsEnvProvider>
        <LevelsInner />
      </LevelsEnvProvider>
    </ThemeVariantContext.Provider>
  );
}

type Toast = { msg: string; action?: { label: string; run: () => void } };

function LevelsInner() {
  useLevelsSync();
  const { isMobile, data } = useLevelsEnv();
  const actions = useLevelActions();
  const [search, setSearch] = useState<SearchFilters | null>(null);
  const [modal, setModal] = useState<'settings' | 'tags' | 'passkeys' | null>(null);
  const [capture, setCapture] = useState(false);
  const [palette, setPalette] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const focusId = useLevelsStore((s) => s.focusId);
  const zettels = useZettelStore((s) => s.zettels);
  const deleteId = useDeleteRequestStore((s) => s.id);
  const clearDelete = useDeleteRequestStore((s) => s.clear);
  const deleteMeta = useMemo(() => (deleteId ? (zettels.find((z) => z.id === deleteId) ?? null) : null), [deleteId, zettels]);

  const unplacedSet = useMemo(() => new Set(data.unplacedIds), [data.unplacedIds]);

  const showToast = useCallback((msg: string, action?: Toast['action']) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, action });
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, []);

  const onNew = useCallback(() => void createNote().catch(() => showToast('Não foi possível criar o zettel')), [showToast]);

  const onMenu = useCallback(
    (a: MenuAction) => {
      if (a === 'new') onNew();
      else if (a === 'capture') setCapture(true);
      else if (a === 'search') setSearch({});
      else if (a === 'palette') setPalette(true);
      else if (a === 'tags' || a === 'settings' || a === 'passkeys') setModal(a);
    },
    [onNew],
  );

  // Atalhos globais: Alt+B busca, Ctrl/⌘+K paleta, Alt+, configurações.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.altKey && e.code === 'KeyB' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setSearch({});
      } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK' && !e.altKey) {
        e.preventDefault();
        setPalette((v) => !v);
      } else if (e.altKey && e.code === 'Comma' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setModal('settings');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const paletteActions: PaletteAction[] = [
    { id: 'new', label: 'Novo zettel', run: onNew },
    { id: 'capture', label: 'Captura rápida', run: () => setCapture(true) },
    { id: 'search', label: 'Buscar', keys: 'Alt+B', run: () => setSearch({}) },
    { id: 'lv-focus', label: 'Ir para o Foco', run: () => void actions.go('focus') },
    { id: 'lv-memory', label: 'Ir para a Memória', run: () => void actions.go('memory') },
    { id: 'lv-map', label: 'Ir para o Mapa', run: () => void actions.go('map') },
    ...(focusId ? [{ id: 'delete-focus', label: 'Apagar zettel em foco', run: () => void actions.requestDelete(focusId) }] : []),
    { id: 'tags', label: 'Tags', run: () => setModal('tags') },
    { id: 'settings', label: 'Configurações', keys: 'Alt+,', run: () => setModal('settings') },
    { id: 'passkeys', label: 'Passkeys', run: () => setModal('passkeys') },
  ];

  return (
    <div className="zk-root fixed inset-0 flex flex-col overflow-hidden" style={{ height: '100dvh' }}>
      <LevelsTopBar onSearch={() => setSearch({})} onNew={onNew} onMenu={onMenu} />
      <div className="relative min-h-0 flex-1 overflow-hidden">{isMobile ? <MobileLevels /> : <DesktopLevels />}</div>
      <Vignette />

      {toast && (
        <div role="status" aria-live="polite" className="zk-win absolute bottom-20 left-1/2 z-50 -translate-x-1/2 flex-row items-center gap-3 px-4 py-2 text-sm">
          {toast.msg}
          {toast.action && (
            <NeonButton
              onClick={() => {
                toast.action?.run();
                setToast(null);
              }}
              style={{ minHeight: 32 }}
            >
              {toast.action.label}
            </NeonButton>
          )}
        </div>
      )}

      {search && (
        <GalaxyModal title="Busca" onClose={() => setSearch(null)} wide>
          <GalaxySearch
            initial={search}
            canFly={() => true}
            isUnplaced={(id) => unplacedSet.has(id)}
            onClose={() => setSearch(null)}
            onFly={(id) => {
              setSearch(null);
              void actions.focus(id);
            }}
            onOpen={(id) => {
              setSearch(null);
              void actions.focus(id);
            }}
            onFocus={(id) => {
              setSearch(null);
              void actions.focus(id);
            }}
            onTag={(tag) => setSearch({ tags: [tag] })}
          />
        </GalaxyModal>
      )}
      {capture && (
        <GalaxyModal title="Captura rápida" onClose={() => setCapture(false)}>
          <QuickCapture
            onSubmit={(text) => {
              setCapture(false);
              void captureNote(text).then((z) => {
                if (z) showToast('Capturado', { label: 'Abrir', run: () => void actions.focus(z.id) });
              });
            }}
          />
        </GalaxyModal>
      )}
      {palette && (
        <GalaxyModal title="Paleta de comandos" onClose={() => setPalette(false)}>
          <CommandPalette
            actions={paletteActions}
            onClose={() => setPalette(false)}
            onZettel={(id) => void actions.focus(id)}
            onZettelFocus={(id) => void actions.focus(id)}
            onTag={(tag) => setSearch({ tags: [tag] })}
          />
        </GalaxyModal>
      )}
      {deleteMeta && (
        <DeleteZettelModal
          meta={deleteMeta}
          onCancel={clearDelete}
          onConfirm={() => {
            clearDelete();
            void deleteFromLevels(deleteMeta.id);
          }}
        />
      )}
      {modal === 'settings' && (
        <GalaxyModal title="Configurações" onClose={() => setModal(null)}>
          <SettingsPanel embedded />
        </GalaxyModal>
      )}
      {modal === 'tags' && (
        <GalaxyModal title="Tags" onClose={() => setModal(null)}>
          <TagsPanel
            embedded
            onTag={(tag) => {
              setModal(null);
              setSearch({ tags: [tag] });
            }}
          />
        </GalaxyModal>
      )}
      {modal === 'passkeys' && (
        <GalaxyModal title="Passkeys" onClose={() => setModal(null)}>
          <PasskeysPanel embedded />
        </GalaxyModal>
      )}
    </div>
  );
}

/** Desktop: tela 1 = Foco; tela 2 = Mapa + Memória. Transição vertical. */
function DesktopLevels() {
  const level = useLevelsStore((s) => s.level);
  const focusId = useLevelsStore((s) => s.focusId);
  const consulted = useLevelsStore((s) => s.consulted);
  const actions = useLevelActions();
  const zettels = useZettelStore((s) => s.zettels);
  const focusTitle = useMemo(() => zettels.find((z) => z.id === focusId)?.title.trim() || 'Sem título', [zettels, focusId]);
  const second = level !== 'focus';

  return (
    <div
      className="zk-levels-track absolute inset-x-0 top-0"
      style={{ height: '200%', transform: `translateY(${second ? '-50%' : '0'})`, transition: TRACK_TRANSITION }}
    >
      <section aria-label="Foco" aria-hidden={second} className="zk-desk relative h-1/2 overflow-hidden">
        <div className="absolute inset-x-6 bottom-[132px] top-5">
          <FocusScreen />
        </div>
        <div className="absolute inset-x-0 bottom-0 flex h-[132px] items-end justify-center gap-6 overflow-hidden px-6">
          {consulted.slice(0, 3).map((id) => (
            <div key={id} className="relative -mb-5 w-[300px] flex-none">
              <CompactWindow id={id} onPick={(pid) => void actions.openInMemory(pid)} />
            </div>
          ))}
        </div>
        <div className="absolute inset-x-0 bottom-3 flex justify-center">
          <NeonButton variant="hot" onClick={() => void actions.go('memory')} style={{ fontSize: 24, minHeight: 50, padding: '0 28px', boxShadow: '0 0 24px rgba(255,176,0,.55)' }}>
            ▼ ABAIXAR PARA AS REFERÊNCIAS [{consulted.length}]
          </NeonButton>
        </div>
      </section>

      <section aria-label="Referências" aria-hidden={!second} className="zk-desk relative h-1/2 overflow-hidden">
        <div className="absolute inset-x-0 top-3 flex justify-center">
          <NeonButton variant="hot" onClick={() => void actions.go('focus')} style={{ fontSize: 21 }}>
            ▲ SUBIR AO FOCO · {focusTitle.toUpperCase()}
          </NeonButton>
        </div>
        <div className="absolute inset-x-6 bottom-5 top-16 flex gap-5">
          <div className="w-[42%] min-w-0 flex-none">
            <MapScreen />
          </div>
          <div className="min-w-0 flex-1">
            <MemoryScreen />
          </div>
        </div>
      </section>
    </div>
  );
}

const MOBILE_LEVELS = ['focus', 'memory', 'map'] as const;

/** Celular: três telas (Foco, Memória, Mapa) e barra de níveis fixa embaixo. */
function MobileLevels(): ReactNode {
  const level = useLevelsStore((s) => s.level);
  const editing = useLevelsStore((s) => s.editing);
  const consulted = useLevelsStore((s) => s.consulted);
  const actions = useLevelActions();
  const idx = MOBILE_LEVELS.indexOf(level);
  const labels = { focus: 'FOCO', memory: `MEMÓRIA [${consulted.length}]`, map: 'MAPA' } as const;

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          className="zk-levels-track absolute inset-x-0 top-0"
          style={{ height: '300%', transform: `translateY(-${(idx * 100) / 3}%)`, transition: TRACK_TRANSITION }}
        >
          <section aria-label="Foco" aria-hidden={level !== 'focus'} className="zk-desk h-1/3 overflow-hidden p-2">
            <FocusScreen />
          </section>
          <section aria-label="Memória" aria-hidden={level !== 'memory'} className="zk-desk h-1/3 overflow-hidden p-2">
            <MemoryScreen />
          </section>
          <section aria-label="Mapa" aria-hidden={level !== 'map'} className="zk-desk h-1/3 overflow-hidden p-2">
            <MapScreen />
          </section>
        </div>
      </div>
      {/* Em edição a barra de formatação do editor ocupa o rodapé. */}
      {editing === null && (
        <nav aria-label="Níveis" className="flex h-[72px] flex-none gap-[6px] bg-zk-bg px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2">
          {MOBILE_LEVELS.map((l) => {
            const on = l === level;
            return (
              <button
                key={l}
                type="button"
                aria-current={on ? 'page' : undefined}
                onClick={() => void actions.go(l)}
                className="zk-display min-h-[56px] flex-1 border text-[22px] leading-none"
                style={{
                  borderColor: 'var(--zk-cyan)',
                  background: on ? 'var(--zk-cyan)' : 'var(--zk-bg-panel)',
                  color: on ? 'var(--zk-black)' : 'var(--zk-cyan)',
                }}
              >
                {labels[l]}
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}
