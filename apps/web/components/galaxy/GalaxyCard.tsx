'use client';

import { memo, useEffect, useRef, useState, type RefObject } from 'react';
import { CARD_MAX_HEIGHT, CARD_WIDTH, type Zettel, type ZettelMeta } from '@zettelkasten/core';
import { useZettelBody } from '../../hooks/useZettelBody';
import { MarkdownRenderer } from '../MarkdownRenderer';
import { InplaceEditor, type InplaceEditorHandle, type SaveStatus } from './InplaceEditor';

/** Altura do cabeçalho (título de até 2 linhas; as tags ficam no fim do corpo)
 *  que sai da altura máxima do corpo. */
const HEADER_RESERVE = 88;
const MENU_WIDTH = 176;
/** Auto-pan do arraste: zona junto à borda (px de tela) e velocidade máxima (px/s). */
const EDGE = 64;
const EDGE_SPEED = 1200;

export interface CardActions {
  onLink: (title: string) => void;
  /** Exportar PDF (só o zettel ou com a subárvore). */
  onExport: (id: string) => void;
  onHover: (idx: number) => void;
  /** Clique no corpo (fora de links): entrar em edição. */
  onRequestEdit: (id: string) => void;
  onFocus: (id: string) => void;
  onDelete: (id: string) => void;
  /** Copia o id do zettel para a área de transferência. */
  onCopyId: (id: string) => void;
  onStatus: (s: SaveStatus) => void;
  onCreateLink: (title: string) => void | Promise<void>;
  /** Fim do arraste pela alça: deslocamento em unidades de mundo. */
  onMoved: (id: string, dx: number, dy: number) => void;
  /** Câmera atual (escala converte o arraste de tela em mundo; x/y somam o auto-pan). */
  getCamera: () => { x: number; y: number; scale: number };
  /** Auto-pan do arraste, em pixels de tela. */
  panBy: (dxScreen: number, dyScreen: number) => void;
  /** Retângulo da galáxia na tela (bordas do auto-pan). */
  getViewportRect: () => DOMRect | null;
  /** Card em arraste (`null` ao soltar): fica montado mesmo fora da tela. */
  onDragState: (id: string | null) => void;
  /** Altura real do card em unidades de mundo (`null` ao desmontar): ponta das arestas. */
  onHeight: (id: string, h: number | null) => void;
  /** Botão Maximizar: leitura em tela cheia. */
  onMaximize: (id: string) => void;
}

/**
 * Card da galáxia, em coordenadas de mundo dentro da `CardLayer` (o transform
 * da câmera fica no contêiner — este componente não re-renderiza em pan/zoom).
 * Leitura por padrão; com `editing`, vira o `InplaceEditor`. `data-*` dizem ao
 * motor o que é do card: `data-card-body` é seleção de texto com mouse,
 * `data-card-scroll` rola com a roda, `data-no-pan` não inicia pan.
 */
export const GalaxyCard = memo(function GalaxyCard({
  meta,
  idx,
  x,
  y,
  heavy,
  highlighted,
  editing,
  editingZettel,
  autoFocusTitle,
  editorRef,
  actions,
}: {
  meta: ZettelMeta;
  idx: number;
  x: number;
  y: number;
  /** Câmera parada com zoom ≥ 60%: pode renderizar diagramas. */
  heavy: boolean;
  highlighted: boolean;
  editing: boolean;
  /** Zettel completo carregado para a edição (null fora dela). */
  editingZettel: Zettel | null;
  autoFocusTitle: boolean;
  editorRef: RefObject<InplaceEditorHandle | null>;
  actions: CardActions;
}) {
  const { body, status } = useZettelBody(editing ? null : meta.id);
  // Depois de renderizar os diagramas uma vez, não volta a código: desmontar
  // e remontar um diagrama a cada pan custaria mais que mantê-lo.
  const [heavyOnce, setHeavyOnce] = useState(heavy);
  useEffect(() => {
    if (heavy) setHeavyOnce(true);
  }, [heavy]);
  // Posição do menu em unidades de mundo, relativa ao topo-esquerdo do card;
  // `null` = fechado. O menu é irmão do <article> porque o card recorta
  // (`overflow-hidden` + `contain: paint`) e um card curto cortava "Apagar".
  const [menuAt, setMenuAt] = useState<{ top: number; right: number } | null>(null);
  const menuOpen = menuAt !== null;
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const drag = useRef<{
    /** Início e posição atual do ponteiro (tela). */
    sx: number; sy: number; px: number; py: number;
    /** Câmera no início do arraste. */
    scale: number; cx: number; cy: number;
    /** Deslocamento atual em mundo. */
    dx: number; dy: number;
    t: number; raf: number;
  } | null>(null);

  // `offsetHeight` ignora o transform da camada: já está em unidades de mundo.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const report = () => actions.onHeight(meta.id, el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => {
      ro.disconnect();
      actions.onHeight(meta.id, null);
    };
  }, [actions, meta.id]);

  // Fecha ao tocar fora: sobre outro card o `mouseleave` não basta, e toque
  // não tem leave. Captura sem preventDefault, para o pan seguir normal.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || menuBtnRef.current?.contains(t)) return;
      setMenuAt(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [menuOpen]);

  const toggleMenu = () => {
    const btn = menuBtnRef.current;
    if (menuOpen || !btn) {
      setMenuAt(null);
      return;
    }
    // offsetParent do botão é o <article>; offsets ignoram o transform da câmera.
    setMenuAt({ top: btn.offsetTop + btn.offsetHeight + 4, right: CARD_WIDTH - (btn.offsetLeft + btn.offsetWidth) });
  };
  const closeMenu = () => setMenuAt(null);

  const onBodyClick = (e: React.MouseEvent) => {
    if (editing) return;
    const target = e.target as Element;
    if (target.closest('a, button, input')) return;
    // Arraste de seleção de texto não é pedido de edição.
    if (window.getSelection()?.toString()) return;
    actions.onRequestEdit(meta.id);
  };

  // Mover pela alça: transform imperativo em unidades de mundo (o card está
  // dentro da camada escalada), sem React por frame. Perto da borda a câmera
  // rola (auto-pan) e o deslocamento soma o quanto ela andou, então o card
  // segue sob o ponteiro parado.
  const applyDrag = () => {
    const d = drag.current;
    if (!d || !cardRef.current) return;
    const cam = actions.getCamera();
    d.dx = (d.px - d.sx) / d.scale + (cam.x - d.cx);
    d.dy = (d.py - d.sy) / d.scale + (cam.y - d.cy);
    cardRef.current.style.transform = `translate(${d.dx}px, ${d.dy}px)`;
  };
  const autoPan = (t: number) => {
    const d = drag.current;
    if (!d) return;
    const dt = Math.min(t - d.t, 50) / 1000;
    d.t = t;
    const r = actions.getViewportRect();
    if (r) {
      const v = (dist: number) => (dist < EDGE ? EDGE_SPEED * ((EDGE - Math.max(dist, 0)) / EDGE) ** 2 : 0);
      const vx = v(d.px - r.left) * -1 + v(r.right - d.px);
      const vy = v(d.py - r.top) * -1 + v(r.bottom - d.py);
      if (vx || vy) {
        actions.panBy(vx * dt, vy * dt);
        applyDrag();
      }
    }
    d.raf = requestAnimationFrame(autoPan);
  };
  const onHandleDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const cam = actions.getCamera();
    drag.current = {
      sx: e.clientX, sy: e.clientY, px: e.clientX, py: e.clientY,
      scale: cam.scale, cx: cam.x, cy: cam.y, dx: 0, dy: 0,
      t: performance.now(), raf: requestAnimationFrame(autoPan),
    };
    setDragging(true);
    actions.onDragState(meta.id);
  };
  const onHandleMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    d.px = e.clientX;
    d.py = e.clientY;
    applyDrag();
  };
  const onHandleUp = () => {
    const d = drag.current;
    if (d) {
      cancelAnimationFrame(d.raf);
      applyDrag();
    }
    drag.current = null;
    setDragging(false);
    actions.onDragState(null);
    if (cardRef.current) cardRef.current.style.transform = '';
    if (d && Math.hypot(d.dx, d.dy) * d.scale > 4) actions.onMoved(meta.id, d.dx, d.dy);
  };
  // Desmontar no meio do arraste (ex.: zettel apagado) não deixa o laço vivo.
  useEffect(() => () => {
    if (drag.current) cancelAnimationFrame(drag.current.raf);
  }, []);

  const border = editing || dragging ? 'border-brand/70' : highlighted ? 'border-[#f5f3ff]/70' : 'border-white/[0.08]';

  return (
    <>
      <article
        ref={cardRef}
        data-galaxy-card
        onPointerEnter={() => actions.onHover(idx)}
        onPointerLeave={() => actions.onHover(-1)}
        className={`dark absolute flex flex-col overflow-hidden rounded-xl border bg-[#0e121a] font-geist text-[#c9cfdb] shadow-2xl ${border}`}
        style={{
          left: x - CARD_WIDTH / 2,
          top: y - CARD_MAX_HEIGHT / 2,
          width: CARD_WIDTH,
          maxHeight: CARD_MAX_HEIGHT,
          contain: 'layout paint style',
          zIndex: editing || dragging ? 10 : undefined,
        }}
      >
        {editing && editingZettel ? (
          <>
            <div className="flex shrink-0 justify-end gap-2 px-4 pt-3" data-no-pan>
              <span className="mr-auto text-[11px] text-[#6f7787]">Editando · Esc para sair</span>
            </div>
            <InplaceEditor
              ref={editorRef}
              zettel={editingZettel}
              variant="card"
              autoFocusTitle={autoFocusTitle}
              onStatus={actions.onStatus}
              onCreateLink={actions.onCreateLink}
            />
          </>
        ) : (
          <>
            <header className="flex shrink-0 items-start gap-2 px-6 pb-2 pt-5">
              <button
                type="button"
                data-no-pan
                title="Arrastar para mover"
                onPointerDown={onHandleDown}
                onPointerMove={onHandleMove}
                onPointerUp={onHandleUp}
                onPointerCancel={onHandleUp}
                className="-ml-3 mt-1 shrink-0 cursor-grab touch-none rounded px-1 text-[#6f7787] hover:text-[#c9cfdb] active:cursor-grabbing"
              >
                ⋮⋮
              </button>
              <div className="min-w-0 flex-1">
                <h3 className="font-newsreader text-[22px] font-medium leading-snug text-[#f5f3ff]">
                  {meta.title || 'Sem título'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => actions.onFocus(meta.id)}
                className="shrink-0 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-[#c9cfdb] hover:bg-white/5"
              >
                Focar
              </button>
              <button
                type="button"
                title="Maximizar"
                onClick={() => actions.onMaximize(meta.id)}
                className="shrink-0 rounded-lg border border-white/10 px-2 py-1 text-xs text-[#c9cfdb] hover:bg-white/5"
              >
                ⤢
              </button>
              <button
                ref={menuBtnRef}
                type="button"
                title="Mais ações"
                onClick={toggleMenu}
                className="shrink-0 rounded-lg border border-white/10 px-2 py-1 text-xs text-[#c9cfdb] hover:bg-white/5"
              >
                ⋯
              </button>
            </header>
            <div
              data-card-scroll
              className="min-h-0 cursor-text overflow-y-auto overscroll-contain px-6 pb-5 text-[14px] leading-relaxed"
              style={{ maxHeight: CARD_MAX_HEIGHT - HEADER_RESERVE }}
              onClick={onBodyClick}
            >
              <div data-card-body>
                {status === 'loading' ? (
                  <p className="text-[#6f7787]">Carregando…</p>
                ) : status === 'missing' ? (
                  <p className="text-[#6f7787]">Conteúdo ainda não disponível neste aparelho.</p>
                ) : (
                  <>
                    {status === 'stale' && (
                      <p className="mb-2 text-[11px] text-amber-200/80">versão anterior — a mais recente ainda não foi baixada</p>
                    )}
                    {body.trim() ? (
                      <MarkdownRenderer body={body} onLinkPress={actions.onLink} disableHeavyBlocks={!heavyOnce} />
                    ) : (
                      <p className="italic text-[#6f7787]">Sem conteúdo — clique para escrever.</p>
                    )}
                  </>
                )}
              </div>
              {meta.tags.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1">
                  {meta.tags.map((t) => (
                    <span key={t} className="rounded-md bg-white/5 px-1.5 py-0.5 text-[11px] text-[#8b93a3]">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </article>
      {menuAt && !editing && (
        <div
          ref={menuRef}
          data-galaxy-card
          className="dark absolute rounded-lg border border-white/10 bg-[#0e121a] p-1 font-geist text-sm shadow-2xl"
          style={{
            left: x + CARD_WIDTH / 2 - menuAt.right - MENU_WIDTH,
            top: y - CARD_MAX_HEIGHT / 2 + menuAt.top,
            width: MENU_WIDTH,
            zIndex: 20,
          }}
          onPointerEnter={() => actions.onHover(idx)}
          onPointerLeave={() => actions.onHover(-1)}
          onMouseLeave={closeMenu}
        >
          <MenuItem label="Focar" onClick={() => { closeMenu(); actions.onFocus(meta.id); }} />
          <MenuItem label="Exportar PDF" onClick={() => { closeMenu(); actions.onExport(meta.id); }} />
          <MenuItem label="Copiar ID" onClick={() => { closeMenu(); actions.onCopyId(meta.id); }} />
          <MenuItem label="Apagar" danger onClick={() => { closeMenu(); actions.onDelete(meta.id); }} />
        </div>
      )}
    </>
  );
});

function MenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full rounded px-2.5 py-1.5 text-left hover:bg-white/5 ${danger ? 'text-red-300' : 'text-[#c9cfdb]'}`}
    >
      {label}
    </button>
  );
}
