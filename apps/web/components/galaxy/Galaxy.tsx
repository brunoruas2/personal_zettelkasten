'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analyzeSubtree, subtreeDepths, type Zettel, type ZettelMeta } from '@zettelkasten/core';
import { useGalaxyData } from './useGalaxyData';
import { FLY_MIN_SCALE, GalaxyEngine, LOD_CARDS, LOD_SILHOUETTE } from '../../lib/galaxy/engine';
import { loadCamera, type Camera } from '../../lib/galaxy/camera';
import { snapPosition } from '../../lib/galaxy/snap';
import { setManualPosition } from '../../lib/positionSync';
import { loadZettel } from '../../lib/bodySync';
import { api } from '../../lib/api';
import { useZettelStore } from '../../store/useZettelStore';
import { HoverCard } from './HoverCard';
import { CardLayer } from './CardLayer';
import type { CardActions } from './GalaxyCard';
import type { InplaceEditorHandle, SaveStatus } from './InplaceEditor';
import { FullscreenEditor } from './FullscreenEditor';
import { ExportScopeModal } from '../ExportScopeModal';
import { pushRecent } from '../../lib/recentZettels';
import { DeleteZettelModal } from './DeleteZettelModal';
import { FocusPanel, type FocusItem } from './FocusPanel';
import { GalaxyTopBar, ZoomControls, type MenuAction } from './GalaxyTopBar';
import { GalaxyModal } from './GalaxyModal';
import { GalaxySearch, type SearchFilters } from './GalaxySearch';
import { SettingsPanel } from '../panels/SettingsPanel';
import { TagsPanel } from '../panels/TagsPanel';
import { PasskeysPanel } from '../panels/PasskeysPanel';

type Modal = 'settings' | 'tags' | 'passkeys' | null;

const CARD_HIDE_DELAY_MS = 150;
const HIGHLIGHT_MS = 2000;
/** Zoom a partir do qual os cards podem renderizar diagramas (câmera parada). */
const HEAVY_MIN_SCALE = 0.6;
/** Zoom da edição no card: texto em tamanho real. */
const EDIT_SCALE = 1;
/** "Salvo" some da barra depois de um tempo sem edição. */
const SAVED_LINGER_MS = 2500;

/** Grava `?z=<id>` na URL de `/` sem empilhar histórico. */
function setZParam(id: string | null): void {
  const url = id ? `/?z=${encodeURIComponent(id)}` : '/';
  window.history.replaceState(window.history.state, '', url);
}

function isMobileDevice(): boolean {
  return window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 1024;
}

let templateCache: string | null = null;

/** `zettel_template` do usuário (uma vez por sessão; offline = corpo vazio). */
async function loadTemplate(): Promise<string> {
  if (templateCache !== null) return templateCache;
  try {
    const res = await api.get('/api/auth/settings');
    const data = res.ok ? await res.json() : null;
    templateCache = typeof data?.zettel_template === 'string' ? data.zettel_template : '';
  } catch {
    return '';
  }
  return templateCache ?? '';
}

/**
 * Galáxia: a tela principal. Canvas (motor imperativo) + cards, barra, mini
 * card, menu, modais, busca, edição no lugar, criação, exclusão, foco e mover.
 * Nada aqui tira o usuário da galáxia, exceto "Abrir na página".
 */
export function Galaxy() {
  const data = useGalaxyData();
  const dataRef = useRef(data);
  dataRef.current = data;
  const links = useZettelStore((s) => s.links);
  const createZettel = useZettelStore((s) => s.createZettel);
  const deleteZettel = useZettelStore((s) => s.deleteZettel);

  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GalaxyEngine | null>(null);
  const cardLayerRef = useRef<HTMLDivElement>(null);
  const [visibleIds, setVisibleIds] = useState<string[]>([]);
  const [settled, setSettled] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedRef = useRef(false);

  const [scale, setScale] = useState(0.05);
  const [hoverIdx, setHoverIdx] = useState(-1);
  const [pinnedIdx, setPinnedIdx] = useState(-1);
  const [, setCamTick] = useState(0);
  const overCardRef = useRef(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [modal, setModal] = useState<Modal>(null);
  const [search, setSearch] = useState<SearchFilters | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);

  // Edição
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingZettel, setEditingZettel] = useState<Zettel | null>(null);
  /** Editor em tela cheia: celular, ou zettel sem lugar em qualquer dispositivo. */
  const [fullscreen, setFullscreen] = useState<{ zettel: Zettel; variant: 'card' | 'mobile' } | null>(null);
  const [exportId, setExportId] = useState<string | null>(null);
  const [autoFocusTitle, setAutoFocusTitle] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const editorRef = useRef<InplaceEditorHandle>(null);
  const editingIdRef = useRef<string | null>(null);
  editingIdRef.current = editingId;
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Apagar e foco
  const [deleteMeta, setDeleteMeta] = useState<ZettelMeta | null>(null);
  const [focusRootId, setFocusRootId] = useState<string | null>(null);
  const focusRootRef = useRef<string | null>(null);
  focusRootRef.current = focusRootId;
  /** Zettel recém-criado esperando entrar no índice para voar/editar. */
  const pendingNewRef = useRef<{ zettel: Zettel; mobile: boolean } | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 3500);
  }, []);

  const onStatus = useCallback((s: SaveStatus) => {
    setSaveStatus(s);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    if (s === 'saved') savedTimer.current = setTimeout(() => setSaveStatus('idle'), SAVED_LINGER_MS);
  }, []);

  const flyTo = useCallback((id: string, minScale = FLY_MIN_SCALE) => {
    const idx = dataRef.current.indexById.get(id);
    if (idx === undefined) return;
    engineRef.current?.flyTo(idx, true, minScale);
    setZParam(id);
    pushRecent(id);
    // No nível de cards o destaque do voo é o contorno do próprio card.
    setHighlightId(id);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
  }, []);

  // --- edição ---

  const exitEdit = useCallback(async () => {
    if (!editingIdRef.current) return;
    await editorRef.current?.flush();
    setEditingId(null);
    setEditingZettel(null);
    setAutoFocusTitle(false);
  }, []);

  const startEdit = useCallback(
    async (zettel: Zettel, opts: { titleFocus?: boolean; mobile?: boolean } = {}) => {
      pushRecent(zettel.id);
      if (opts.mobile) {
        setAutoFocusTitle(!!opts.titleFocus);
        setFullscreen({ zettel, variant: 'mobile' });
        return;
      }
      flyTo(zettel.id, EDIT_SCALE);
      setAutoFocusTitle(!!opts.titleFocus);
      setEditingZettel(zettel);
      setEditingId(zettel.id);
    },
    [flyTo],
  );

  const requestEdit = useCallback(
    async (id: string) => {
      if (editingIdRef.current === id) return;
      await exitEdit();
      const { zettel, stale } = await loadZettel(id);
      if (!zettel) return;
      if (stale) {
        showToast('A versão mais recente deste zettel ainda não foi baixada. Conecte-se para editar.');
        return;
      }
      await startEdit(zettel, { mobile: isMobileDevice() });
    },
    [exitEdit, showToast, startEdit],
  );

  /** Zettel sem lugar (ou oculto): não há card — abre o editor em tela cheia. */
  const openFullscreen = useCallback(
    async (id: string) => {
      await exitEdit();
      const { zettel, stale } = await loadZettel(id);
      if (!zettel) return;
      if (stale) {
        showToast('A versão mais recente deste zettel ainda não foi baixada. Conecte-se para editar.');
        return;
      }
      pushRecent(id);
      setFullscreen({ zettel, variant: isMobileDevice() ? 'mobile' : 'card' });
    },
    [exitEdit, showToast],
  );

  // --- foco ---

  const exitFocus = useCallback(() => {
    setFocusRootId(null);
    engineRef.current?.setFocus(null);
  }, []);

  const enterFocus = useCallback(
    (id: string) => {
      if (!dataRef.current.indexById.has(id)) {
        showToast('Esse zettel ainda não tem lugar na galáxia.');
        return;
      }
      setFocusRootId(id);
    },
    [showToast],
  );

  const focus = useMemo(() => {
    if (!focusRootId) return null;
    const depths = subtreeDepths(focusRootId, links);
    const visibleIds = [...depths.keys()].filter((id) => data.indexById.has(id));
    const idxSet = new Set(visibleIds.map((id) => data.indexById.get(id)!));
    const order = analyzeSubtree(focusRootId, data.metas, links).ids.filter((id) => data.indexById.has(id));
    const items: FocusItem[] = order.map((id) => ({ meta: data.metas[data.indexById.get(id)!], depth: depths.get(id) ?? 0 }));
    return { idxSet, items };
  }, [focusRootId, links, data]);

  const focusFittedRef = useRef<string | null>(null);
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (!focus || !focusRootId) {
      focusFittedRef.current = null;
      return;
    }
    // Posiciona só ao entrar no foco; reconstruções dos dados só trocam o conjunto.
    const fit = focusFittedRef.current !== focusRootId;
    focusFittedRef.current = focusRootId;
    engine.setFocus(focus.idxSet, fit, data.indexById.get(focusRootId) ?? -1);
  }, [focus, focusRootId, data]);

  // --- criar ---

  const createAt = useCallback(
    async (world: { x: number; y: number }, title = '') => {
      if (focusRootRef.current) exitFocus();
      await exitEdit();
      const position = await snapPosition(world);
      const body = title ? '' : await loadTemplate();
      const zettel = await createZettel({ title, body, tags: [] }, { position });
      pendingNewRef.current = { zettel, mobile: isMobileDevice() };
    },
    [createZettel, exitEdit, exitFocus],
  );

  const createAtCenter = useCallback(() => {
    const cam = engineRef.current?.getCamera();
    if (cam) void createAt({ x: cam.x, y: cam.y });
  }, [createAt]);

  // O zettel novo entra no índice depois do loadAll + posição: aí voa e edita.
  useEffect(() => {
    const pending = pendingNewRef.current;
    if (!pending || !data.indexById.has(pending.zettel.id)) return;
    pendingNewRef.current = null;
    void startEdit(pending.zettel, { titleFocus: true, mobile: pending.mobile });
  }, [data, startEdit]);

  /** `[[novo]]` no editor: cria ao lado do card em edição, sem mudar a edição. */
  const createLink = useCallback(
    async (title: string) => {
      const sourceId = editingIdRef.current ?? fullscreen?.zettel.id ?? null;
      const idx = sourceId ? dataRef.current.indexById.get(sourceId) : undefined;
      const cam = engineRef.current?.getCamera();
      const anchor = idx !== undefined ? { x: dataRef.current.xs[idx], y: dataRef.current.ys[idx] } : cam ? { x: cam.x, y: cam.y } : { x: 0, y: 0 };
      const position = await snapPosition(anchor);
      await createZettel({ title, body: '', tags: [] }, { position });
    },
    [createZettel, fullscreen],
  );

  // --- apagar ---

  const confirmDelete = useCallback(async () => {
    const meta = deleteMeta;
    setDeleteMeta(null);
    if (!meta) return;
    if (editingIdRef.current === meta.id) {
      setEditingId(null);
      setEditingZettel(null);
    }
    if (focusRootRef.current === meta.id) exitFocus();
    await deleteZettel(meta.id);
  }, [deleteMeta, deleteZettel, exitFocus]);

  // --- mover ---

  const onMoved = useCallback(async (id: string, dx: number, dy: number) => {
    const d = dataRef.current;
    const idx = d.indexById.get(id);
    if (idx === undefined) return;
    const target = await snapPosition({ x: d.xs[idx] + dx, y: d.ys[idx] + dy }, id);
    await setManualPosition(id, target.x, target.y);
  }, []);

  // Ações dos cards: objeto estável (o CardLayer é memo), as funções reais
  // ficam numa ref atualizada a cada render.
  const actionsRef = useRef<CardActions | null>(null);
  actionsRef.current = {
    onLink: (title) => {
      const id = idByTitleRef.current.get(title.trim().toLowerCase());
      if (id) flyTo(id);
    },
    onExport: (id) => setExportId(id),
    onHover: (idx) => engineRef.current?.setHoverFromCard(idx),
    onRequestEdit: (id) => void requestEdit(id),
    onFocus: enterFocus,
    onDelete: (id) => {
      const idx = dataRef.current.indexById.get(id);
      if (idx !== undefined) setDeleteMeta(dataRef.current.metas[idx]);
    },
    onStatus,
    onCreateLink: createLink,
    onMoved: (id, dx, dy) => void onMoved(id, dx, dy),
    getScale: () => engineRef.current?.getCamera().scale ?? 1,
    onHeight: (id, h) => engineRef.current?.setCardHeight(id, h),
  };
  const actions = useMemo<CardActions>(
    () => ({
      onLink: (t) => actionsRef.current!.onLink(t),
      onExport: (id) => actionsRef.current!.onExport(id),
      onHover: (i) => actionsRef.current!.onHover(i),
      onRequestEdit: (id) => actionsRef.current!.onRequestEdit(id),
      onFocus: (id) => actionsRef.current!.onFocus(id),
      onDelete: (id) => actionsRef.current!.onDelete(id),
      onStatus: (s) => actionsRef.current!.onStatus(s),
      onCreateLink: (t) => actionsRef.current!.onCreateLink(t),
      onMoved: (id, dx, dy) => actionsRef.current!.onMoved(id, dx, dy),
      getScale: () => actionsRef.current!.getScale(),
      onHeight: (id, h) => actionsRef.current!.onHeight(id, h),
    }),
    [],
  );

  // Callbacks do motor que mudam com o estado, lidas por ref.
  const engineHandlersRef = useRef({ exitEdit, createAt });
  engineHandlersRef.current = { exitEdit, createAt };

  // Motor: criado uma vez; callbacks leem estado por ref.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const engine = new GalaxyEngine(container, {
      onHover: (idx) => {
        if (idx >= 0) {
          if (hideTimer.current) clearTimeout(hideTimer.current);
          setHoverIdx(idx);
          return;
        }
        // Dá tempo de o mouse chegar ao mini card sem ele sumir.
        if (hideTimer.current) clearTimeout(hideTimer.current);
        hideTimer.current = setTimeout(() => {
          if (!overCardRef.current) setHoverIdx(-1);
        }, CARD_HIDE_DELAY_MS);
      },
      onSelect: (idx) => {
        setPinnedIdx(idx);
        engine.setPinned(idx);
      },
      onBackgroundTap: () => {
        setPinnedIdx(-1);
        engine.setPinned(-1);
        void engineHandlersRef.current.exitEdit();
      },
      onCameraChange: (cam: Camera) => {
        setScale(cam.scale);
        setCamTick((t) => t + 1);
        // Fora do nível de pontos não há mini card nem seleção por toque.
        if (cam.scale >= LOD_SILHOUETTE) {
          setPinnedIdx(-1);
          setHoverIdx(-1);
        }
        // Afastar abaixo do nível de cards encerra a edição (salvando).
        if (cam.scale < LOD_CARDS && editingIdRef.current) void engineHandlersRef.current.exitEdit();
      },
      onVisibleCards: (ids) => setVisibleIds(ids),
      onCameraSettled: (s) => setSettled(s),
      onDoubleClickEmpty: (wx, wy) => void engineHandlersRef.current.createAt({ x: wx, y: wy }),
    });
    engine.setCardLayer(cardLayerRef.current);
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Base da barra do topo (px do contêiner): o foco põe o topo do raiz abaixo dela.
  useEffect(() => {
    const root = containerRef.current?.parentElement;
    const bar = root?.querySelector<HTMLElement>('[data-galaxy-topbar]');
    if (!root || !bar) return;
    const update = () => {
      const bottom = bar.getBoundingClientRect().bottom - root.getBoundingClientRect().top;
      engineRef.current?.setTopInset(bottom > 0 ? bottom : 72);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(bar);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setData(data);
    setPinnedIdx(-1);
    setHoverIdx(-1);
  }, [data]);

  useEffect(() => {
    const update = () => setMobile(isMobileDevice());
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Câmera inicial, uma vez, quando índice e posições chegaram: ?z= vence a
  // câmera lembrada; sem nenhuma, "Ver tudo".
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || initializedRef.current || !data.ready) return;
    initializedRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const z = params.get('z');
    const saved = loadCamera();
    const idx = z ? data.indexById.get(z) : undefined;
    if (idx !== undefined) {
      engine.setCamera({ x: data.xs[idx], y: data.ys[idx], scale: Math.max(saved?.scale ?? 0, FLY_MIN_SCALE) });
      engine.flyTo(idx, false);
    } else if (saved) {
      engine.setCamera(saved);
    } else {
      engine.fit(false);
    }
    if (z && idx === undefined) showToast('Esse zettel ainda não tem lugar na galáxia.');

    // Vindo do ranking de tags da rota antiga (`/?tag=`): abre a busca filtrada.
    const tag = params.get('tag');
    if (tag) {
      setSearch({ tags: [tag] });
      setZParam(z && idx !== undefined ? z : null);
    }
  }, [data, showToast]);

  // Overlays desligam pan por teclado/atalhos do canvas.
  const overlayOpen = modal !== null || search !== null || deleteMeta !== null || fullscreen !== null || exportId !== null;
  useEffect(() => {
    engineRef.current?.setInputEnabled(!overlayOpen);
  }, [overlayOpen]);

  // Esc (bolha, depois dos popups do editor — que marcam defaultPrevented):
  // primeiro encerra a edição, depois o foco.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || overlayOpen) return;
      if (editingIdRef.current) {
        e.preventDefault();
        void exitEdit();
      } else if (focusRootRef.current) {
        e.preventDefault();
        exitFocus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [exitEdit, exitFocus, overlayOpen]);

  // Atalhos da galáxia. `e.code` pelo mesmo motivo do Alt+T/Alt+B: onde o Alt
  // compõe caractere (Option no macOS) a comparação por caractere falharia.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.code === 'KeyB') {
        e.preventDefault();
        setModal(null);
        setSearch((s) => (s ? null : {}));
      } else if (e.code === 'Comma') {
        e.preventDefault();
        setSearch(null);
        setModal('settings');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onMenu = (action: MenuAction) => {
    if (action === 'new') createAtCenter();
    else if (action === 'search') setSearch({});
    else setModal(action);
  };

  const unplacedSet = useMemo(() => new Set(data.unplacedIds), [data.unplacedIds]);

  // Títulos (sem caixa) → id, para os [[links]] dos cards voarem. Mesma regra
  // do findByTitle.
  const idByTitle = useMemo(() => {
    const m = new Map<string, string>();
    for (const z of data.metas) {
      const k = z.title.trim().toLowerCase();
      if (!m.has(k)) m.set(k, z.id);
    }
    return m;
  }, [data.metas]);
  const idByTitleRef = useRef(idByTitle);
  idByTitleRef.current = idByTitle;

  const cardIdx = pinnedIdx >= 0 ? pinnedIdx : hoverIdx;
  const cardPos = cardIdx >= 0 ? engineRef.current?.screenOf(cardIdx) ?? null : null;
  const cardMeta = cardIdx >= 0 ? data.metas[cardIdx] : undefined;
  const focusRootMeta = focusRootId ? data.metas[data.indexById.get(focusRootId) ?? -1] : undefined;

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#05070c]">
      <div ref={containerRef} className="absolute inset-0">
        <CardLayer
          ref={cardLayerRef}
          data={data}
          ids={visibleIds}
          heavy={settled && scale >= HEAVY_MIN_SCALE}
          highlightId={highlightId}
          editingId={editingId}
          editingZettel={editingZettel}
          autoFocusTitle={autoFocusTitle}
          editorRef={editorRef}
          actions={actions}
        />
      </div>

      {cardMeta && cardPos && (
        <HoverCard
          meta={cardMeta}
          degree={data.degree[cardIdx]}
          x={cardPos[0]}
          y={cardPos[1]}
          onPointerEnter={() => {
            overCardRef.current = true;
            if (hideTimer.current) clearTimeout(hideTimer.current);
          }}
          onPointerLeave={() => {
            overCardRef.current = false;
            if (pinnedIdx < 0) setHoverIdx(-1);
          }}
          onApproach={() => flyTo(cardMeta.id)}
          onEdit={() => {
            setHoverIdx(-1);
            setPinnedIdx(-1);
            void requestEdit(cardMeta.id);
          }}
          onFocus={() => {
            setHoverIdx(-1);
            setPinnedIdx(-1);
            enterFocus(cardMeta.id);
          }}
        />
      )}

      <GalaxyTopBar
        unplaced={data.unplacedIds.length}
        saveStatus={saveStatus}
        onSearch={() => setSearch({})}
        onUnplaced={() => setSearch({ unplacedOnly: true })}
        onMenu={onMenu}
      />

      <ZoomControls
        scale={scale}
        onZoomIn={() => engineRef.current?.zoomBy(1.4)}
        onZoomOut={() => engineRef.current?.zoomBy(1 / 1.4)}
        onFit={() => engineRef.current?.fit()}
      />

      {mobile && (
        <button
          type="button"
          onClick={createAtCenter}
          title="Novo zettel"
          className="absolute bottom-4 left-4 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-brand text-2xl text-white shadow-2xl"
        >
          +
        </button>
      )}

      {focus && focusRootMeta && (
        <FocusPanel root={focusRootMeta} items={focus.items} onPick={(id) => flyTo(id)} onExit={exitFocus} />
      )}

      {data.ready && data.count === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center font-geist">
          <p className="max-w-sm px-6 text-center text-sm text-[#8b93a3]">
            {data.unplacedIds.length > 0
              ? 'Os zettels ainda não têm lugar na galáxia. Com conexão, o layout é calculado na próxima sincronização.'
              : 'A galáxia está vazia. Dê um duplo clique em qualquer lugar para criar o primeiro zettel.'}
          </p>
        </div>
      )}

      {toast && (
        <div className="absolute bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-white/10 bg-[#0e121a] px-4 py-2 font-geist text-sm text-[#e6e9f0] shadow-2xl">
          {toast}
        </div>
      )}

      {search && (
        <GalaxyModal title="Busca na galáxia" onClose={() => setSearch(null)} wide>
          <GalaxySearch
            initial={search}
            canFly={(id) => data.indexById.has(id)}
            isUnplaced={(id) => unplacedSet.has(id)}
            onClose={() => setSearch(null)}
            onFly={(id) => {
              setSearch(null);
              flyTo(id);
            }}
            onOpen={(id) => {
              setSearch(null);
              void openFullscreen(id);
            }}
            onFocus={(id) => {
              setSearch(null);
              enterFocus(id);
            }}
          />
        </GalaxyModal>
      )}

      {deleteMeta && (
        <DeleteZettelModal meta={deleteMeta} onCancel={() => setDeleteMeta(null)} onConfirm={() => void confirmDelete()} />
      )}

      {exportId && (
        <div className="dark">
          <ExportScopeModal open zettelId={exportId} onClose={() => setExportId(null)} />
        </div>
      )}

      {fullscreen && (
        <FullscreenEditor
          zettel={fullscreen.zettel}
          variant={fullscreen.variant}
          status={saveStatus}
          autoFocusTitle={autoFocusTitle}
          onStatus={onStatus}
          onCreateLink={createLink}
          onClose={() => {
            setFullscreen(null);
            setAutoFocusTitle(false);
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
