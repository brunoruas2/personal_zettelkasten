'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGalaxyData } from './useGalaxyData';
import { FLY_MIN_SCALE, GalaxyEngine, LOD_SILHOUETTE } from '../../lib/galaxy/engine';
import { loadCamera, type Camera } from '../../lib/galaxy/camera';
import { HoverCard } from './HoverCard';
import { CardLayer } from './CardLayer';
import { GalaxyTopBar, ZoomControls, type MenuAction } from './GalaxyTopBar';
import { GalaxyModal } from './GalaxyModal';
import { GalaxySearch, type SearchFilters } from './GalaxySearch';
import { SettingsPanel } from '../panels/SettingsPanel';
import { TagsPanel } from '../panels/TagsPanel';
import { PasskeysPanel } from '../panels/PasskeysPanel';
import { useOfflineRouter } from '../../hooks/useOfflineRouter';

type Modal = 'settings' | 'tags' | 'passkeys' | null;

const CARD_HIDE_DELAY_MS = 150;
const HIGHLIGHT_MS = 2000;
/** Zoom a partir do qual os cards podem renderizar diagramas (câmera parada). */
const HEAVY_MIN_SCALE = 0.6;

/** Grava `?z=<id>` na URL de `/` sem empilhar histórico. */
function setZParam(id: string | null): void {
  const url = id ? `/?z=${encodeURIComponent(id)}` : '/';
  window.history.replaceState(window.history.state, '', url);
}

/**
 * Galáxia: a tela principal. Canvas (motor imperativo) + barra, mini card,
 * menu, modais e busca. Nada aqui tira o usuário da galáxia, exceto abrir um
 * zettel (página antiga, temporário até os cards no lugar).
 */
export function Galaxy() {
  const data = useGalaxyData();
  const dataRef = useRef(data);
  dataRef.current = data;
  const offlineRouter = useOfflineRouter();

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

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 3500);
  }, []);

  const open = useCallback(
    (id: string) => {
      setZParam(id);
      offlineRouter.push(`/zettel/${id}`);
    },
    [offlineRouter],
  );

  const flyTo = useCallback((id: string) => {
    const idx = dataRef.current.indexById.get(id);
    if (idx === undefined) return;
    engineRef.current?.flyTo(idx);
    setZParam(id);
    // No nível de cards o destaque do voo é o contorno do próprio card.
    setHighlightId(id);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
  }, []);

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
      onOpen: (idx) => {
        const id = dataRef.current.ids[idx];
        if (id) open(id);
      },
      onBackgroundTap: () => {
        setPinnedIdx(-1);
        engine.setPinned(-1);
      },
      onCameraChange: (cam: Camera) => {
        setScale(cam.scale);
        setCamTick((t) => t + 1);
        // Fora do nível de pontos não há mini card nem seleção por toque.
        if (cam.scale >= LOD_SILHOUETTE) {
          setPinnedIdx(-1);
          setHoverIdx(-1);
        }
      },
      onVisibleCards: (ids) => setVisibleIds(ids),
      onCameraSettled: (s) => setSettled(s),
    });
    engine.setCardLayer(cardLayerRef.current);
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engineRef.current?.setData(data);
    setPinnedIdx(-1);
    setHoverIdx(-1);
  }, [data]);

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

  // Modais e busca desligam pan por teclado/atalhos do canvas.
  useEffect(() => {
    engineRef.current?.setInputEnabled(modal === null && search === null);
  }, [modal, search]);

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
    if (action === 'new') offlineRouter.push('/zettel/new');
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

  const onCardLink = useCallback(
    (title: string) => {
      const id = idByTitle.get(title.trim().toLowerCase());
      if (id) flyTo(id);
    },
    [idByTitle, flyTo],
  );

  const onCardHover = useCallback((idx: number) => engineRef.current?.setHoverFromCard(idx), []);

  const cardIdx = pinnedIdx >= 0 ? pinnedIdx : hoverIdx;
  const cardPos = cardIdx >= 0 ? engineRef.current?.screenOf(cardIdx) ?? null : null;
  const cardMeta = cardIdx >= 0 ? data.metas[cardIdx] : undefined;

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#05070c]">
      <div ref={containerRef} className="absolute inset-0">
        <CardLayer
          ref={cardLayerRef}
          data={data}
          ids={visibleIds}
          heavy={settled && scale >= HEAVY_MIN_SCALE}
          highlightId={highlightId}
          onLink={onCardLink}
          onOpen={open}
          onHover={onCardHover}
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
          onOpen={() => open(cardMeta.id)}
        />
      )}

      <GalaxyTopBar
        unplaced={data.unplacedIds.length}
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

      {data.ready && data.count === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center font-geist">
          <p className="max-w-sm px-6 text-center text-sm text-[#8b93a3]">
            {data.unplacedIds.length > 0
              ? 'Os zettels ainda não têm lugar na galáxia. Com conexão, o layout é calculado na próxima sincronização.'
              : 'A galáxia está vazia.'}
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
              open(id);
            }}
          />
        </GalaxyModal>
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
