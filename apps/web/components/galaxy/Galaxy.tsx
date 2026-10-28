'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  analyzeSubtree,
  firstLine,
  relatedZettels,
  subtreeDepths,
  type Zettel,
  type ZettelMeta,
} from '@zettelkasten/core';
import { getCachedBody } from '../../lib/bodyCache';
import { useLinkIndex } from '../../hooks/useLinkIndex';
import { spatialNeighborIds } from '../../lib/galaxy/spatial';
import { describeRelated, type RelatedItem } from '../../lib/galaxy/related';
import { useGalaxyData } from './useGalaxyData';
import { FLY_MIN_SCALE, GalaxyEngine, LOD_CARDS, LOD_SILHOUETTE, isTypingTarget } from '../../lib/galaxy/engine';
import { loadCamera, type Camera } from '../../lib/galaxy/camera';
import { BackStack } from '../../lib/galaxy/backStack';
import { snapPosition } from '../../lib/galaxy/snap';
import { setManualPosition } from '../../lib/positionSync';
import { loadZettel } from '../../lib/bodySync';
import { api } from '../../lib/api';
import { useZettelStore } from '../../store/useZettelStore';
import { useDrawingFocusStore } from '../../store/useDrawingFocusStore';
import { HoverCard } from './HoverCard';
import { CardLayer } from './CardLayer';
import type { CardActions } from './GalaxyCard';
import type { InplaceEditorHandle, SaveStatus } from './InplaceEditor';
import { FullscreenEditor } from './FullscreenEditor';
import { MaximizedReader } from './MaximizedReader';
import { ExportScopeModal } from '../ExportScopeModal';
import { pushRecent } from '../../lib/recentZettels';
import { DeleteZettelModal } from './DeleteZettelModal';
import { FocusPanel, type FocusItem } from './FocusPanel';
import { GalaxyTopBar, ZoomControls, type MenuAction, type TrailItem } from './GalaxyTopBar';
import { GalaxyModal } from './GalaxyModal';
import { CommandPalette, type PaletteAction } from './CommandPalette';
import { Minimap } from './Minimap';
import { ShortcutsHelp } from './ShortcutsHelp';
import { keysOf } from '../../lib/galaxy/shortcuts';
import { useSyncStore } from '../../store/useSyncStore';
import { GalaxySearch, type SearchFilters } from './GalaxySearch';
import { SettingsPanel } from '../panels/SettingsPanel';
import { TagsPanel } from '../panels/TagsPanel';
import { PasskeysPanel } from '../panels/PasskeysPanel';

type Modal = 'settings' | 'tags' | 'passkeys' | null;

const CARD_HIDE_DELAY_MS = 150;
/** Paradas mostradas na trilha do Voltar. */
const TRAIL_MAX = 5;
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
  const linkIndex = useLinkIndex();
  const linkIndexRef = useRef(linkIndex);
  linkIndexRef.current = linkIndex;
  const createZettel = useZettelStore((s) => s.createZettel);
  const deleteZettel = useZettelStore((s) => s.deleteZettel);

  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GalaxyEngine | null>(null);
  // Mesma instância, como estado: o minimapa só monta depois que o motor existe.
  const [engineInst, setEngineInst] = useState<GalaxyEngine | null>(null);
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

  // Filtro de tag: esmaece na câmera o que não tem a tag (não filtra o índice).
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const tagFilterRef = useRef<string | null>(null);
  tagFilterRef.current = tagFilter;
  // 1ª linha do corpo das silhuetas: só corpos já em cache ou no Dexie local.
  const linesRef = useRef(new Map<string, string>());
  const linesAtRef = useRef(new Map<string, number>());
  const linesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [modal, setModal] = useState<Modal>(null);
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [search, setSearch] = useState<SearchFilters | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);

  // Edição
  const [editingId, setEditingId] = useState<string | null>(null);
  /** Card em arraste: o CardLayer o mantém montado durante o auto-pan. */
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [editingZettel, setEditingZettel] = useState<Zettel | null>(null);
  /** Editor em tela cheia: celular, ou zettel sem lugar em qualquer dispositivo. */
  const [fullscreen, setFullscreen] = useState<{ zettel: Zettel; variant: 'card' | 'mobile' } | null>(null);
  const [exportId, setExportId] = useState<string | null>(null);
  const [maximizedId, setMaximizedId] = useState<string | null>(null);
  const maximizedIdRef = useRef(maximizedId);
  maximizedIdRef.current = maximizedId;
  const [autoFocusTitle, setAutoFocusTitle] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const editorRef = useRef<InplaceEditorHandle>(null);
  const editingIdRef = useRef<string | null>(null);
  editingIdRef.current = editingId;
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Apagar e foco
  const [deleteMeta, setDeleteMeta] = useState<ZettelMeta | null>(null);
  const [focusRootId, setFocusRootId] = useState<string | null>(null);
  // Profundidade máxima exibida no foco; todo foco começa em 1 (não persiste).
  const [focusDepth, setFocusDepth] = useState<number | 'all'>(1);
  const focusRootRef = useRef<string | null>(null);
  focusRootRef.current = focusRootId;
  /** Zettel recém-criado esperando entrar no índice para voar/editar. */
  const pendingNewRef = useRef<{ zettel: Zettel; mobile: boolean } | null>(null);

  // "← Voltar": pilha de saltos (link, busca, lista do foco, leitura).
  const backStackRef = useRef(new BackStack());
  /** Último zettel para onde a câmera voou (o "atual" de um salto). */
  const currentIdRef = useRef<string | null>(null);
  const [backTop, setBackTop] = useState<{ title: string | null } | null>(null);
  const [forwardTop, setForwardTop] = useState<{ title: string | null } | null>(null);
  const [trail, setTrail] = useState<TrailItem[]>([]);
  const [readerCanBack, setReaderCanBack] = useState(false);
  const syncBackRef = useRef<() => void>(() => {});
  const [readerCanForward, setReaderCanForward] = useState(false);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 3500);
  }, []);

  const onStatus = useCallback((s: SaveStatus) => {
    setSaveStatus(s);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    if (s === 'saved') savedTimer.current = setTimeout(() => setSaveStatus('idle'), SAVED_LINGER_MS);
  }, []);

  // `minScale: 'top'` = "Aproximar": zoom máximo com o topo do card sob a barra.
  const flyTo = useCallback((id: string, minScale: number | 'top' = FLY_MIN_SCALE, animate = true) => {
    const idx = dataRef.current.indexById.get(id);
    if (idx === undefined) return;
    if (minScale === 'top') engineRef.current?.approach(idx, animate);
    else engineRef.current?.flyTo(idx, animate, minScale);
    currentIdRef.current = id;
    setZParam(id);
    pushRecent(id);
    highlightCard(id);
    // O "atual" da trilha mudou.
    syncBackRef.current();
  }, []);

  // No nível de cards o destaque do voo é o contorno do próprio card.
  const highlightCard = (id: string) => {
    setHighlightId(id);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
  };

  // --- voltar ---

  const metaExists = (id: string) =>
    dataRef.current.indexById.has(id) || useZettelStore.getState().zettels.some((z) => z.id === id);

  const titleOf = (id: string) => {
    const idx = dataRef.current.indexById.get(id);
    return idx !== undefined
      ? dataRef.current.metas[idx].title
      : useZettelStore.getState().zettels.find((z) => z.id === id)?.title ?? null;
  };

  const syncBack = useCallback(() => {
    const stack = backStackRef.current;
    const top = stack.peek();
    setBackTop(top ? { title: top.id ? titleOf(top.id) : null } : null);
    setReaderCanBack(stack.some((e) => e.id !== null && metaExists(e.id)));
    const next = stack.peekForward();
    setForwardTop(next ? { title: next.id ? titleOf(next.id) : null } : null);
    setReaderCanForward(stack.forwardSize > 0);
    // Trilha: últimas paradas (da mais antiga) + o zettel atual.
    const recent = stack.recent(TRAIL_MAX);
    const items: TrailItem[] = recent.map((e, j) => ({
      key: `${j}-${e.id ?? 'view'}`,
      fromTop: recent.length - 1 - j,
      label: e.id === null ? 'Vista' : (titleOf(e.id) ?? '(apagado)') || 'Sem título',
      deleted: e.id !== null && !metaExists(e.id),
    }));
    const cur = currentIdRef.current;
    if (items.length > 0 && cur && metaExists(cur)) {
      items.push({ key: `cur-${cur}`, fromTop: null, label: titleOf(cur) || 'Sem título', deleted: false });
    }
    setTrail(stack.size > TRAIL_MAX ? [{ key: 'more', fromTop: null, label: '…', deleted: false, more: true }, ...items] : items);
  }, []);
  syncBackRef.current = syncBack;

  /** Empilha de onde se salta: o zettel atual, se ainda está na tela, e a câmera. */
  const pushBack = useCallback(
    (fromId: string | null) => {
      const engine = engineRef.current;
      if (!engine) return;
      backStackRef.current.push({ id: fromId, camera: engine.getCamera() });
      syncBack();
    },
    [syncBack],
  );

  /** O zettel atual só conta como origem se o ponto dele ainda está na tela. */
  const currentInView = (): string | null => {
    const id = currentIdRef.current;
    const idx = id ? dataRef.current.indexById.get(id) : undefined;
    const el = containerRef.current;
    if (!id || idx === undefined || !el) return null;
    const p = engineRef.current?.screenOf(idx);
    return p && p[0] >= 0 && p[1] >= 0 && p[0] <= el.clientWidth && p[1] <= el.clientHeight ? id : null;
  };

  /** Salto intencional (link, busca, lista do foco): entra na pilha do "← Voltar". */
  const jumpTo = useCallback(
    (id: string, minScale: number | 'top' = FLY_MIN_SCALE) => {
      if (!dataRef.current.indexById.has(id)) return;
      const from = currentInView();
      if (from !== id) pushBack(from);
      flyTo(id, minScale);
    },
    [flyTo, pushBack],
  );

  // --- leitura em tela cheia ---

  // Troca na hora, sem animação. Com card na galáxia (e, em foco, no
  // conjunto) a câmera pula para ele por baixo da leitura, para fechar já no
  // último lido. Sem card (sem lugar, oculto, fora do foco): câmera parada.
  const showInReader = useCallback(
    (id: string) => {
      const idx = dataRef.current.indexById.get(id);
      const f = focusRef.current;
      const hasCard = idx !== undefined && (!f || f.idxSet.has(idx));
      setMaximizedId(id);
      if (hasCard) flyTo(id, FLY_MIN_SCALE, false);
      else pushRecent(id);
    },
    [flyTo],
  );

  const navigateReader = useCallback(
    (id: string) => {
      const from = maximizedIdRef.current;
      if (from === id) return;
      pushBack(from);
      showInReader(id);
    },
    [pushBack, showInReader],
  );

  /** Estado de agora para o Avançar: zettel na leitura e câmera. */
  const readerState = () => ({ id: maximizedIdRef.current, camera: engineRef.current?.getCamera() ?? { x: 0, y: 0, scale: 1 } });

  /** "← Voltar" da leitura: pula entradas sem zettel ou com zettel apagado. */
  const goBackInReader = useCallback(() => {
    const now = readerState();
    const e = backStackRef.current.popUntil((x) => x.id !== null && metaExists(x.id));
    if (e?.id) backStackRef.current.pushForward(now);
    syncBack();
    if (e?.id) showInReader(e.id);
  }, [showInReader, syncBack]);

  /** "Avançar →" da leitura: troca na hora, sem animação, como o Voltar. */
  const goForwardInReader = useCallback(() => {
    const stack = backStackRef.current;
    let f = stack.popForward();
    while (f && !(f.id !== null && metaExists(f.id))) f = stack.popForward();
    if (f?.id) {
      stack.pushFromForward(readerState());
      syncBack();
      showInReader(f.id);
    } else syncBack();
  }, [showInReader, syncBack]);

  const closeReader = useCallback(() => {
    // O popstate restaurou o ?z= de quando a leitura abriu.
    const id = maximizedIdRef.current;
    if (id && dataRef.current.indexById.has(id)) setZParam(id);
    setMaximizedId(null);
  }, []);

  // Mesma regra do findByTitle: primeiro os posicionados, depois o índice todo.
  const navigateReaderByTitle = useCallback(
    (title: string) => {
      const key = title.trim().toLowerCase();
      const id =
        idByTitleRef.current.get(key) ??
        useZettelStore.getState().zettels.find((z) => z.title.trim().toLowerCase() === key)?.id;
      if (id) navigateReader(id);
    },
    [navigateReader],
  );

  // --- edição ---

  const exitEdit = useCallback(async () => {
    if (!editingIdRef.current) return;
    await editorRef.current?.flush();
    setEditingId(null);
    setEditingZettel(null);
    setAutoFocusTitle(false);
  }, []);

  /** Restaura uma entrada da pilha: câmera guardada e, se o zettel existe, `?z=` e destaque. */
  const restoreEntry = useCallback((e: { id: string | null; camera: Camera }) => {
    const idx = e.id ? dataRef.current.indexById.get(e.id) : undefined;
    engineRef.current?.flyToCamera(e.camera, idx ?? -1);
    currentIdRef.current = idx !== undefined ? e.id : null;
    if (e.id && idx !== undefined) {
      setZParam(e.id);
      highlightCard(e.id);
    }
    syncBack();
  }, [syncBack]);

  /** De onde se parte ao voltar/avançar: o zettel atual (se na tela) e a câmera de agora. */
  const currentState = (): { id: string | null; camera: Camera } => ({
    id: currentInView(),
    camera: engineRef.current?.getCamera() ?? { x: 0, y: 0, scale: 1 },
  });

  /** "← Voltar" da galáxia: restaura a câmera de onde se saltou; o atual vai para o avançar. */
  const goBack = useCallback(async () => {
    const now = currentState();
    const e = backStackRef.current.pop();
    if (e) backStackRef.current.pushForward(now);
    syncBack();
    if (!e) return;
    await exitEdit();
    restoreEntry(e);
  }, [exitEdit, restoreEntry, syncBack]);

  /** "Avançar →": desfaz o último Voltar; o atual volta para a pilha do Voltar. */
  const goForward = useCallback(async () => {
    const now = currentState();
    const f = backStackRef.current.popForward();
    if (!f) return;
    backStackRef.current.pushFromForward(now);
    syncBack();
    await exitEdit();
    restoreEntry(f);
  }, [exitEdit, restoreEntry, syncBack]);

  /** Parada da trilha: volta até ela (`fromTop` = posições abaixo do topo); o que ficou à frente vai para o avançar. */
  const goBackTo = useCallback(
    async (fromTop: number) => {
      const stack = backStackRef.current;
      const now = currentState();
      const r = stack.popBack(fromTop);
      if (!r) return;
      stack.pushForward(now);
      for (let i = r.skipped.length - 1; i >= 0; i--) stack.pushForward(r.skipped[i]);
      syncBack();
      await exitEdit();
      restoreEntry(r.reached);
    },
    [exitEdit, restoreEntry, syncBack],
  );

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
      setFocusDepth(1);
      setFocusRootId(id);
      // No celular o card a 150% lê mal: abre direto a leitura, com a lista do foco.
      if (isMobileDevice()) setMaximizedId(id);
    },
    [showToast],
  );

  const focus = useMemo(() => {
    if (!focusRootId) return null;
    const depths = subtreeDepths(focusRootId, links);
    const visibleIds = [...depths.keys()].filter((id) => data.indexById.has(id));
    let maxDepth = 0;
    for (const id of visibleIds) maxDepth = Math.max(maxDepth, depths.get(id) ?? 0);
    // Limitado à subárvore atual: um sync pode encolhê-la abaixo do nível escolhido.
    const depth: number | 'all' = focusDepth === 'all' || focusDepth >= maxDepth ? 'all' : focusDepth;
    const within = (id: string) => depth === 'all' || (depths.get(id) ?? 0) <= depth;
    const idxSet = new Set(visibleIds.filter(within).map((id) => data.indexById.get(id)!));
    const order = analyzeSubtree(focusRootId, data.metas, links).ids.filter((id) => data.indexById.has(id) && within(id));
    const items: FocusItem[] = order.map((id) => ({ meta: data.metas[data.indexById.get(id)!], depth: depths.get(id) ?? 0 }));
    return { idxSet, items, total: visibleIds.length, maxDepth, depth };
  }, [focusRootId, focusDepth, links, data]);
  const focusRef = useRef(focus);
  focusRef.current = focus;

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

  /**
   * Chip do rodapé de links (card e editor): voa até o zettel, empilhando no
   * Voltar. Sem lugar na galáxia (ou oculto) não há card: abre em tela cheia.
   * O editor já gravou o que estava pendente antes de chamar.
   */
  const navigateToId = useCallback(
    async (id: string) => {
      if (dataRef.current.indexById.has(id)) {
        await exitEdit();
        jumpTo(id);
      } else {
        await openFullscreen(id);
      }
    },
    [exitEdit, jumpTo, openFullscreen],
  );

  /** Relacionados de um zettel (tags, 2º grau, proximidade), sob demanda. */
  const relatedOf = useCallback((id: string): RelatedItem[] => {
    const store = useZettelStore.getState();
    const metas = dataRef.current.metas;
    const byId = dataRef.current.indexById;
    const list = relatedZettels({
      id,
      metas,
      neighborsOf: (x) => linkIndexRef.current.neighbors(x).filter((n) => byId.has(n)),
      spatialNeighbors: spatialNeighborIds(dataRef.current, id),
      excludedTags: store.graphExcludedTags,
    });
    return list.map((r) => describeRelated(r, metas[byId.get(r.id)!]?.title ?? ''));
  }, []);

  /** Chip de tag: liga o filtro; clicar na tag ativa desliga. Uma tag por vez. */
  const toggleTag = useCallback((tag: string) => {
    setTagFilter((cur) => (cur === tag ? null : tag));
  }, []);

  /**
   * Carrega, em lote e sem rede, a 1ª linha das silhuetas na tela (as 60 mais
   * próximas do centro). Debounce de 150 ms: pan contínuo não dispara uma
   * carga por frame. O texto vem do cache LRU ou do Dexie local; `updatedAt`
   * decide se a linha guardada ainda vale.
   */
  const loadSilhouetteLines = useCallback((ids: string[]) => {
    if (linesTimer.current) clearTimeout(linesTimer.current);
    if (ids.length === 0) return;
    linesTimer.current = setTimeout(() => {
      linesTimer.current = null;
      const d = dataRef.current;
      const lines = linesRef.current;
      const at = linesAtRef.current;
      const need: string[] = [];
      let changed = false;
      for (const id of ids) {
        const idx = d.indexById.get(id);
        if (idx === undefined) continue;
        const meta = d.metas[idx];
        if (at.get(id) === meta.updatedAt) continue;
        const cached = getCachedBody(id);
        if (cached !== undefined) {
          lines.set(id, firstLine(cached, meta.title));
          at.set(id, meta.updatedAt);
          changed = true;
        } else if (meta.bodyAt !== null) {
          need.push(id);
        }
      }
      const publish = () => {
        // Teto de memória: descarta as linhas mais antigas.
        while (lines.size > 3000) {
          const oldest = lines.keys().next().value as string;
          lines.delete(oldest);
          at.delete(oldest);
        }
        engineRef.current?.setFirstLines(lines);
      };
      if (need.length === 0) {
        if (changed) publish();
        return;
      }
      const controller = useZettelStore.getState().controller;
      if (!controller) {
        if (changed) publish();
        return;
      }
      void controller
        .getBodies(need)
        .then((bodies) => {
          const cur = dataRef.current;
          for (const [id, body] of bodies) {
            const idx = cur.indexById.get(id);
            if (idx === undefined) continue;
            lines.set(id, firstLine(body, cur.metas[idx].title));
            at.set(id, cur.metas[idx].updatedAt);
          }
          publish();
        })
        .catch(() => {
          if (changed) publish();
        });
    }, 150);
  }, []);

  // Ações dos cards: objeto estável (o CardLayer é memo), as funções reais
  // ficam numa ref atualizada a cada render.
  const actionsRef = useRef<CardActions | null>(null);
  actionsRef.current = {
    onLink: (title) => {
      const id = idByTitleRef.current.get(title.trim().toLowerCase());
      if (id) jumpTo(id);
    },
    onNavigateId: (id) => void navigateToId(id),
    onTag: toggleTag,
    onExport: (id) => setExportId(id),
    onHover: (idx) => engineRef.current?.setHoverFromCard(idx),
    onRequestEdit: (id) => void requestEdit(id),
    onFocus: enterFocus,
    onDelete: (id) => {
      const idx = dataRef.current.indexById.get(id);
      if (idx !== undefined) setDeleteMeta(dataRef.current.metas[idx]);
    },
    onCopyId: (id) => {
      Promise.resolve()
        .then(() => navigator.clipboard.writeText(id))
        .then(() => showToast('ID copiado'), () => showToast('Não foi possível copiar o ID'));
    },
    onStatus,
    onCreateLink: createLink,
    onMoved: (id, dx, dy) => void onMoved(id, dx, dy),
    getCamera: () => engineRef.current?.getCamera() ?? { x: 0, y: 0, scale: 1 },
    panBy: (dx, dy) => engineRef.current?.panBy(dx, dy),
    getViewportRect: () => engineRef.current?.getViewportRect() ?? null,
    onDragState: setDraggingId,
    onHeight: (id, h) => engineRef.current?.setCardHeight(id, h),
    onMaximize: setMaximizedId,
  };
  const actions = useMemo<CardActions>(
    () => ({
      onLink: (t) => actionsRef.current!.onLink(t),
      onNavigateId: (id) => actionsRef.current!.onNavigateId(id),
      onTag: (t) => actionsRef.current!.onTag(t),
      onExport: (id) => actionsRef.current!.onExport(id),
      onHover: (i) => actionsRef.current!.onHover(i),
      onRequestEdit: (id) => actionsRef.current!.onRequestEdit(id),
      onFocus: (id) => actionsRef.current!.onFocus(id),
      onDelete: (id) => actionsRef.current!.onDelete(id),
      onCopyId: (id) => actionsRef.current!.onCopyId(id),
      onStatus: (s) => actionsRef.current!.onStatus(s),
      onCreateLink: (t) => actionsRef.current!.onCreateLink(t),
      onMoved: (id, dx, dy) => actionsRef.current!.onMoved(id, dx, dy),
      getCamera: () => actionsRef.current!.getCamera(),
      panBy: (dx, dy) => actionsRef.current!.panBy(dx, dy),
      getViewportRect: () => actionsRef.current!.getViewportRect(),
      onDragState: (id) => actionsRef.current!.onDragState(id),
      onHeight: (id, h) => actionsRef.current!.onHeight(id, h),
      onMaximize: (id) => actionsRef.current!.onMaximize(id),
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
      onVisibleSilhouettes: (ids) => loadSilhouetteLines(ids),
      onCameraSettled: (s) => setSettled(s),
      onDoubleClickEmpty: (wx, wy) => void engineHandlersRef.current.createAt({ x: wx, y: wy }),
    });
    engine.setCardLayer(cardLayerRef.current);
    engineRef.current = engine;
    setEngineInst(engine);
    return () => {
      engine.destroy();
      engineRef.current = null;
      setEngineInst(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Modo desenho: motor parado e camadas fora da composição (sem desmontar).
  const drawing = useDrawingFocusStore((s) => s.active);
  useEffect(() => {
    engineRef.current?.setSuspended(drawing);
  }, [drawing]);

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

  // Depois do setData (que zera seleção e máscara, porque os índices mudam).
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setFirstLines(linesRef.current);
    engine.setSelected(editingId ? (data.indexById.get(editingId) ?? -1) : -1);
  }, [data, editingId]);

  // Filtro de tag: máscara por índice. A tag que some de todos os zettels
  // visíveis limpa o filtro.
  const tagFilterCount = useMemo(() => {
    if (!tagFilter) return 0;
    let n = 0;
    for (const m of data.metas) if (m.tags.includes(tagFilter)) n++;
    return n;
  }, [tagFilter, data.metas]);
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (!tagFilter) {
      engine.setTagMask(null);
      return;
    }
    if (!data.ready) return;
    if (tagFilterCount === 0) {
      setTagFilter(null);
      engine.setTagMask(null);
      return;
    }
    const mask = new Uint8Array(data.count);
    for (let i = 0; i < data.count; i++) if (data.metas[i].tags.includes(tagFilter)) mask[i] = 1;
    engine.setTagMask(mask);
  }, [tagFilter, tagFilterCount, data]);

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
      currentIdRef.current = z;
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
  const overlayOpen = palette || help || modal !== null || search !== null || deleteMeta !== null || fullscreen !== null || exportId !== null || maximizedId !== null;
  useEffect(() => {
    engineRef.current?.setInputEnabled(!overlayOpen);
  }, [overlayOpen]);
  const overlayOpenRef = useRef(overlayOpen);
  overlayOpenRef.current = overlayOpen;
  const paletteRef = useRef(palette);
  paletteRef.current = palette;

  // Ctrl/⌘+K abre/fecha a paleta; `?` abre a ajuda. Nenhum dos dois age com o
  // foco em campo de texto, edição no lugar ou outro overlay (a paleta aberta
  // se fecha com o próprio Ctrl+K, mesmo com o foco no campo dela).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyK') {
        if (paletteRef.current) {
          e.preventDefault();
          setPalette(false);
          return;
        }
        if (overlayOpenRef.current || editingIdRef.current || isTypingTarget(e.target)) return;
        e.preventDefault();
        setPalette(true);
        return;
      }
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (overlayOpenRef.current || editingIdRef.current || isTypingTarget(e.target)) return;
        e.preventDefault();
        setHelp(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
      } else if (tagFilterRef.current) {
        e.preventDefault();
        setTagFilter(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [exitEdit, exitFocus, overlayOpen]);

  // `X` = "← Voltar". Com overlay aberto (leitura incluída) não age aqui; a
  // leitura trata o seu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyX' || e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (overlayOpen || editingIdRef.current || isTypingTarget(e.target)) return;
      if (!backStackRef.current.size) return;
      e.preventDefault();
      void goBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goBack, overlayOpen]);

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
    else if (action === 'palette') setPalette(true);
    else if (action === 'help') setHelp(true);
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

  // Ações da paleta: só as disponíveis agora (a lista é refeita a cada render com a paleta aberta).
  const paletteActions: PaletteAction[] = [];
  if (palette) {
    paletteActions.push({ id: 'new', label: 'Novo zettel', run: createAtCenter });
    paletteActions.push({ id: 'search', label: 'Buscar com filtros e prévia', keys: keysOf('search'), run: () => setSearch({}) });
    if (backTop) paletteActions.push({ id: 'back', label: 'Voltar ao zettel anterior', keys: keysOf('back'), run: () => void goBack() });
    if (forwardTop) paletteActions.push({ id: 'forward', label: 'Avançar', run: () => void goForward() });
    const currentId = currentIdRef.current;
    if (currentId && data.indexById.has(currentId)) {
      paletteActions.push({ id: 'focus', label: 'Focar no zettel atual', keys: keysOf('focus-search'), run: () => enterFocus(currentId) });
    }
    paletteActions.push({ id: 'fit', label: 'Ver tudo', keys: keysOf('fit'), run: () => engineRef.current?.fit() });
    if (tagFilter) paletteActions.push({ id: 'clear-tag', label: `Limpar o filtro #${tagFilter}`, keys: keysOf('escape'), run: () => setTagFilter(null) });
    paletteActions.push({ id: 'sync', label: 'Sincronizar agora', run: () => void useSyncStore.getState().syncNow?.() });
    paletteActions.push({ id: 'tags', label: 'Abrir tags', run: () => setModal('tags') });
    paletteActions.push({ id: 'settings', label: 'Abrir configurações', keys: keysOf('settings'), run: () => setModal('settings') });
    paletteActions.push({ id: 'help', label: 'Mostrar os atalhos', keys: keysOf('help'), run: () => setHelp(true) });
  }

  const cardIdx = pinnedIdx >= 0 ? pinnedIdx : hoverIdx;
  const cardPos = cardIdx >= 0 ? engineRef.current?.screenOf(cardIdx) ?? null : null;
  const cardMeta = cardIdx >= 0 ? data.metas[cardIdx] : undefined;
  const focusRootMeta = focusRootId ? data.metas[data.indexById.get(focusRootId) ?? -1] : undefined;

  // Relacionados do mini card: calculados depois do primeiro render do card
  // (não atrasam o aparecimento) e só no desktop — o celular não tem espaço.
  const [hoverRelated, setHoverRelated] = useState<RelatedItem[]>([]);
  const hoverRelatedId = cardMeta?.id ?? null;
  useEffect(() => {
    if (!hoverRelatedId || mobile) {
      setHoverRelated([]);
      return;
    }
    const t = setTimeout(() => setHoverRelated(relatedOf(hoverRelatedId)), 0);
    return () => clearTimeout(t);
  }, [hoverRelatedId, mobile, data, linkIndex, relatedOf]);
  // Zettel sem card (sem lugar/oculto) vem do índice inteiro; só varre com a leitura aberta nele.
  const unplacedMaximized = useZettelStore((s) =>
    maximizedId && !data.indexById.has(maximizedId) ? s.zettels.find((z) => z.id === maximizedId) : undefined,
  );
  const maximizedMeta = maximizedId
    ? data.indexById.has(maximizedId)
      ? data.metas[data.indexById.get(maximizedId)!]
      : unplacedMaximized
    : undefined;

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#05070c]">
      <div ref={containerRef} className={drawing ? 'invisible absolute inset-0' : 'absolute inset-0'}>
        <CardLayer
          ref={cardLayerRef}
          data={data}
          ids={visibleIds}
          heavy={settled && scale >= HEAVY_MIN_SCALE}
          highlightId={highlightId}
          activeTag={tagFilter}
          editingId={editingId}
          draggingId={draggingId}
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
          onTag={toggleTag}
          activeTag={tagFilter}
          related={hoverRelated.slice(0, 3)}
          onRelated={(id) => {
            setHoverIdx(-1);
            setPinnedIdx(-1);
            jumpTo(id);
          }}
          onPointerEnter={() => {
            overCardRef.current = true;
            if (hideTimer.current) clearTimeout(hideTimer.current);
          }}
          onPointerLeave={() => {
            overCardRef.current = false;
            if (pinnedIdx < 0) setHoverIdx(-1);
          }}
          onApproach={() => flyTo(cardMeta.id, 'top')}
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
        onBack={backTop ? () => void goBack() : undefined}
        backTitle={backTop?.title ?? null}
        onForward={forwardTop ? () => void goForward() : undefined}
        forwardTitle={forwardTop?.title ?? null}
        trail={trail}
        onTrail={(fromTop) => void goBackTo(fromTop)}
        tagFilter={tagFilter ? { tag: tagFilter, count: tagFilterCount } : null}
        onClearTag={() => setTagFilter(null)}
      />

      <ZoomControls
        scale={scale}
        onZoomIn={() => engineRef.current?.zoomBy(1.4)}
        onZoomOut={() => engineRef.current?.zoomBy(1 / 1.4)}
        onFit={() => engineRef.current?.fit()}
      />

      {!focus && !drawing && data.count > 0 && <Minimap data={data} engine={engineInst} />}

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
        <FocusPanel
          root={focusRootMeta}
          items={focus.items}
          total={focus.total}
          depth={focus.depth}
          maxDepth={focus.maxDepth}
          onDepthChange={setFocusDepth}
          onPick={(id) => jumpTo(id)}
          onExit={exitFocus}
        />
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
              jumpTo(id, 'top');
            }}
            onOpen={(id) => {
              setSearch(null);
              void openFullscreen(id);
            }}
            onFocus={(id) => {
              setSearch(null);
              enterFocus(id);
            }}
            onTag={(tag) => {
              setSearch(null);
              setTagFilter(tag);
            }}
            relatedOf={relatedOf}
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

      {maximizedMeta && (
        <MaximizedReader
          meta={maximizedMeta}
          focus={
            focus && focusRootMeta
              ? {
                  root: focusRootMeta,
                  items: focus.items,
                  total: focus.total,
                  depth: focus.depth,
                  maxDepth: focus.maxDepth,
                  onDepthChange: setFocusDepth,
                }
              : undefined
          }
          onClose={closeReader}
          onEdit={(id) => void openFullscreen(id)}
          onNavigate={navigateReaderByTitle}
          onPick={navigateReader}
          onBack={readerCanBack ? goBackInReader : undefined}
          onForward={readerCanForward ? goForwardInReader : undefined}
          onTag={toggleTag}
          activeTag={tagFilter}
        />
      )}

      {fullscreen && (
        <FullscreenEditor
          zettel={fullscreen.zettel}
          variant={fullscreen.variant}
          status={saveStatus}
          autoFocusTitle={autoFocusTitle}
          onStatus={onStatus}
          onCreateLink={createLink}
          onNavigateLink={(id) => void navigateToId(id)}
          onClose={() => {
            setFullscreen(null);
            setAutoFocusTitle(false);
          }}
        />
      )}

      {palette && (
        <GalaxyModal title="Paleta de comandos" onClose={() => setPalette(false)}>
          <CommandPalette
            actions={paletteActions}
            onClose={() => setPalette(false)}
            onZettel={(id) => (data.indexById.has(id) ? jumpTo(id, 'top') : void openFullscreen(id))}
            onZettelFocus={enterFocus}
            onTag={setTagFilter}
          />
        </GalaxyModal>
      )}
      {help && (
        <GalaxyModal title="Atalhos" onClose={() => setHelp(false)}>
          <ShortcutsHelp />
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
