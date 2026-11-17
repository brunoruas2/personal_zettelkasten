'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import type { Zettel } from '@zettelkasten/core';
import { useZettelStore } from '../../store/useZettelStore';
import { indexById } from '../../store/useLevelsStore';
import { useZettelBody } from '../../hooks/useZettelBody';
import { loadZettel } from '../../lib/bodySync';
import { MarkdownRenderer } from '../MarkdownRenderer';
import { InplaceEditor, type InplaceEditorHandle, type SaveStatus } from '../galaxy/InplaceEditor';
import { editedAgo } from '../galaxy/HoverCard';
import { captureCaretAnchor, type CaretAnchor } from '../../lib/caretAnchor';
import { NeonButton, StatusBar, TitleBar, Win } from '../zkos';
import { EDIT_ACCENT, useLevelsEnv } from './LevelsContext';
import { saveLabel, zkCode } from './format';
import {
  READING_SCALE_MAX,
  READING_SCALE_MIN,
  stepReadingScale,
  useReadingScale,
} from '../../lib/readingFontSize';

/** A− / percentual / A+ (preferência única por dispositivo). */
function FontSizeControl({ percent }: { percent: number }) {
  // mousedown sem foco: na edição, o editor não perde cursor nem seleção.
  const keep = (e: MouseEvent) => e.preventDefault();
  return (
    <div className="flex flex-none items-center gap-1" role="group" aria-label="Tamanho do texto">
      <NeonButton
        onMouseDown={keep}
        onClick={() => stepReadingScale(-1)}
        disabled={percent <= READING_SCALE_MIN}
        aria-label="Diminuir texto"
      >
        A−
      </NeonButton>
      <span className="zk-display min-w-[3ch] text-center text-[length:calc(20px*var(--zk-read-scale,1))] text-zk-dim" aria-live="polite">
        {percent}%
      </span>
      <NeonButton
        onMouseDown={keep}
        onClick={() => stepReadingScale(1)}
        disabled={percent >= READING_SCALE_MAX}
        aria-label="Aumentar texto"
      >
        A+
      </NeonButton>
    </div>
  );
}

export interface MenuAction {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

/** Menu `⋯` da barra de leitura do celular: fecha por clique fora, Esc e ao escolher. */
function ActionsMenu({ items }: { items: MenuAction[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close(true);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, close]);

  const onMenuKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const els = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const i = els.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % els.length : (i - 1 + els.length) % els.length;
    els[next]?.focus();
  };

  return (
    <div ref={rootRef} className="relative flex-none">
      <button
        ref={triggerRef}
        type="button"
        className="zk-btn"
        aria-label="Mais ações"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{ padding: '0 12px', minWidth: 44 }}
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          onKeyDown={onMenuKey}
          className="zk-win absolute right-0 top-full z-30 mt-1 flex w-52 flex-col gap-1 p-1"
        >
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className={`${it.danger ? 'zk-btn-danger' : 'zk-btn'} justify-start px-3 text-left`}
              style={{ minHeight: 44 }}
              onClick={() => {
                close(false);
                it.onClick();
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Quem está editando agora grava o que estiver pendente antes de a tela
 * trocar de zettel/nível. Só uma janela edita por vez (spec memory-screen).
 */
let activeFlush: (() => Promise<void>) | null = null;
export async function flushActiveEdit(): Promise<void> {
  await activeFlush?.();
}

/** Zettel recém-criado: o editor abre com o cursor no título. */
let titleFocusId: string | null = null;
export function requestTitleFocus(id: string): void {
  titleFocusId = id;
}

const STALE_NOTICE = 'Corpo desatualizado neste aparelho. Aguarde o sync para editar.';

export interface ZettelWindowProps {
  id: string;
  /** Cor do cluster (a janela vira âmbar enquanto edita). */
  accent: string;
  editing: boolean;
  /** Entra em edição explícita. Sem ele (Mesa), a janela é só leitura: sem EDIT nem duplo clique. */
  onStartEdit?: () => void;
  onStopEdit: () => void;
  /** Depois de gravar e sair da edição; `empty` = título, corpo e tags vazios. */
  onFinished?: (info: { empty: boolean }) => void;
  /** `[[link]]` do corpo. */
  onOpenLink: (id: string) => void;
  /** Volta ao zettel anterior da trilha (Foco); sem ele, não há botão. */
  onBack?: () => void;
  linkCount: number;
  /** Sufixo da barra de título, ex.: "LEITURA". */
  titleSuffix?: string;
  /** Botões fixos acima do rodapé (Mesa: abrir em foco, fechar). */
  actions?: ReactNode;
  /** Celular (`compact`): itens do menu `⋯` da barra de leitura (além de "Voltar"). */
  menuActions?: MenuAction[];
  /** Coluna à direita (Foco no desktop: conexões). */
  side?: ReactNode;
  className?: string;
  style?: CSSProperties;
  label?: string;
  /** Celular no Foco: sem barra de título nem rodapé, só o zettel. */
  compact?: boolean;
  /**
   * Folha de papel (Foco no desktop): o editor é a própria página, sem modo de
   * leitura. A leitura só aparece como placeholder enquanto o editor monta e
   * quando o corpo está desatualizado.
   */
  alwaysEdit?: boolean;
}

/**
 * Janela de um zettel: leitura (MarkdownRenderer) e edição (InplaceEditor) no
 * mesmo lugar. Clicar no texto ou num diagrama, ou "Editar", entra em
 * edição; "Concluir"/Esc grava e volta à leitura. Com `alwaysEdit`, não há
 * troca de modo: o editor está sempre montado (spec focus-screen).
 */
export function ZettelWindow({
  id,
  accent,
  editing,
  onStartEdit,
  onStopEdit,
  onFinished,
  onOpenLink,
  onBack,
  linkCount,
  titleSuffix,
  actions,
  menuActions,
  side,
  className = '',
  style,
  label,
  compact = false,
  alwaysEdit = false,
}: ZettelWindowProps) {
  const { isMobile, resolveTitle, createLinked } = useLevelsEnv();
  const paper = alwaysEdit && !editing;
  const editorOn = editing || paper;
  const [focused, setFocused] = useState(false);
  // Âmbar só na edição explícita (celular). A folha de papel do desktop tem um modo
  // só: fica na cor do cluster mesmo com o cursor no editor (change foco-sem-ambar).
  const amber = editing;
  // Só o percentual exibido no A−/A+: `--zk-read-scale` vem do `<html>` (Levels).
  const scalePercent = useReadingScale();
  const scaleStyle = {
    ...style,
    '--zk-title-size': `${isMobile || compact ? 23 : 39}px`,
    '--zk-title-color': amber ? EDIT_ACCENT : accent,
    '--zk-pad-x': isMobile ? '0.75rem' : '3.5rem',
  } as CSSProperties;
  const zettels = useZettelStore((s) => s.zettels);
  const meta = useMemo(() => indexById(zettels).get(id), [zettels, id]);
  const { body, status: bodyStatus } = useZettelBody(id);
  // Folha de papel: o editor só monta com o corpo em dia (stale = leitura com aviso).
  const paperReady = paper ? bodyStatus === 'ready' : true;

  const updateZettel = useZettelStore((s) => s.updateZettel);

  // Salvar transposição de cifra: troca só o trecho do bloco, sem entrar em edição.
  // Corpo stale não grava (StaleBodyError); o trecho precisa ainda ser o renderizado.
  const onBodyChange = useCallback(
    (start: number, end: number, content: string) => {
      void updateZettel(id, { body: body.slice(0, start) + content + body.slice(end) });
    },
    [updateZettel, id, body],
  );

  const [zettel, setZettel] = useState<Zettel | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [save, setSave] = useState<SaveStatus>('idle');
  const [focusTitle, setFocusTitle] = useState(false);
  const [readyKey, setReadyKey] = useState<string | null>(null);
  const editorRef = useRef<InplaceEditorHandle>(null);
  // Ponto do duplo clique, consumido pelo editor ao montar; limpo ao sair da edição.
  const caretRef = useRef<CaretAnchor | null>(null);
  const stopRef = useRef(onStopEdit);
  stopRef.current = onStopEdit;
  const idRef = useRef(id);
  idRef.current = id;
  const focusedRef = useRef(false);
  focusedRef.current = focused;
  // Mudança vinda de outro aparelho com o cursor no editor: recarrega no blur.
  const pendingReloadRef = useRef(false);
  const editRootRef = useRef<HTMLDivElement>(null);

  // Editor ligado: carrega o zettel inteiro. Corpo desatualizado não edita
  // (escrever dele sobrescreveria a versão de outro aparelho).
  useEffect(() => {
    if (!editorOn) {
      caretRef.current = null;
      setZettel(null);
      setSave('idle');
      return;
    }
    if (!paperReady) {
      // Com alteração local pendente o editor fica: gravar com corpo novo é
      // permitido e vence pelo LWW, como numa sessão de edição longa.
      if (editorRef.current?.isDirty()) return;
      setZettel(null);
      if (bodyStatus === 'stale') setNotice(STALE_NOTICE);
      return;
    }
    let cancelled = false;
    void loadZettel(id).then(({ zettel: z, stale }) => {
      if (cancelled) return;
      if (!z) {
        if (!paper) stopRef.current();
      } else if (stale) {
        setNotice(STALE_NOTICE);
        if (paper) setZettel(null);
        else stopRef.current();
      } else {
        setNotice(null);
        if (titleFocusId === id) {
          titleFocusId = null;
          setFocusTitle(true);
        } else setFocusTitle(false);
        setZettel(z);
      }
    });
    return () => {
      cancelled = true;
    };
    // bodyStatus só importa via paperReady (o aviso de stale é lido na hora).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorOn, paper, paperReady, id]);

  // Registra o flush enquanto o editor está montado; sair da janela grava.
  useEffect(() => {
    if (!zettel) return;
    const handle = editorRef.current;
    const flush = () => handle?.flush() ?? Promise.resolve();
    activeFlush = flush;
    return () => {
      if (activeFlush === flush) activeFlush = null;
      void handle?.flush();
    };
  }, [zettel]);

  // Folha de papel: zettel alterado por fora (pull) com o editor montado. Nosso
  // próprio save é ignorado; alteração local pendente vence; senão remonta
  // com a versão nova (no blur, se o cursor está no editor).
  const reloadIfClean = useCallback(() => {
    void loadZettel(idRef.current).then(({ zettel: z, stale }) => {
      const h = editorRef.current;
      if (!z || stale || !h || z.id !== idRef.current) return;
      if (h.matchesSaved(z) || h.isDirty()) {
        pendingReloadRef.current = false;
        return;
      }
      if (focusedRef.current) {
        pendingReloadRef.current = true;
        return;
      }
      pendingReloadRef.current = false;
      setZettel(z);
    });
  }, []);
  const metaUpdatedAt = meta?.updatedAt ?? 0;
  useEffect(() => {
    if (!paper || !zettel || zettel.id !== id || metaUpdatedAt <= zettel.updatedAt) return;
    reloadIfClean();
  }, [paper, zettel, id, metaUpdatedAt, reloadIfClean]);

  const finish = useCallback(async () => {
    const empty = editorRef.current?.isEmpty() ?? false;
    await flushActiveEdit();
    onStopEdit();
    onFinished?.({ empty });
  }, [onStopEdit, onFinished]);

  // Esc encerra a edição. O ProseMirror faz preventDefault em todo Esc com o
  // editor focado (captureKeyDown), então `defaultPrevented` não diz nada
  // aí dentro; os popups do editor consomem o seu com stopPropagation, e o
  // modal de desenho fica fora do `.ProseMirror`.
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const inEditor = !!(e.target as HTMLElement | null)?.closest?.('.ProseMirror');
      if (!e.defaultPrevented || inEditor) void finish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, finish]);

  // Folha de papel: Esc dentro do editor só tira o cursor dele (e grava).
  useEffect(() => {
    if (!paper) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (!t || !editRootRef.current?.contains(t)) return;
      const inEditor = !!t.closest?.('.ProseMirror');
      if (e.defaultPrevented && !inEditor) return;
      void editorRef.current?.flush();
      (document.activeElement as HTMLElement | null)?.blur?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paper]);

  // Duplo clique no corpo entra em edição com o cursor onde se clicou. O clique
  // simples só seleciona/segue links. EDIT e atalhos entram sem âncora (início).
  const onBodyDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!onStartEdit) return;
    const t = e.target as HTMLElement;
    if (t.closest('a,button,input,textarea,summary,[data-no-edit]')) return;
    caretRef.current = captureCaretAnchor(e, e.currentTarget);
    window.getSelection()?.removeAllRanges();
    onStartEdit();
  };

  const title = meta?.title.trim() ? meta.title : 'Sem título';
  const tags = meta?.tags ?? [];
  const code = zkCode(id);
  const pad = isMobile ? 'px-3' : 'px-14';
  const winAccent = amber ? EDIT_ACCENT : accent;

  const readingMenu: MenuAction[] = [
    ...(onBack ? [{ label: '← Voltar', onClick: onBack }] : []),
    ...(menuActions ?? []),
  ];

  const header = `${code} — ${title.toUpperCase()}${amber ? ' · EDITANDO' : titleSuffix ? ` · ${titleSuffix}` : ''}`;

  const openWikiLink = (t: string) => {
    // As actions (focus/consult) já gravam a edição antes de trocar.
    const target = resolveTitle(t);
    if (target) onOpenLink(target);
  };

  const editorKey = zettel ? `${zettel.id}:${zettel.updatedAt}` : null;
  const editorMounted = paper && !!zettel && zettel.id === id;
  const editorShown = editorMounted && readyKey === editorKey;

  // Zettel novo na folha de papel: cursor no título assim que o editor aparece
  // (antes disso ele está `invisible` e não aceita foco).
  useEffect(() => {
    if (!paper || !editorShown || !focusTitle) return;
    editorRef.current?.focusTitle();
    setFocusTitle(false);
  }, [paper, editorShown, focusTitle]);

  return (
    <Win accent={winAccent} label={label ?? title} className={className} style={scaleStyle}>
      {!(compact && !editing) && <TitleBar>{header}</TitleBar>}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!editorOn && (
            <>
              {/* Celular: barra fixa fora da rolagem; o resto das ações mora no menu ⋯. */}
              {compact && (
                <div className="flex flex-none flex-wrap items-center justify-end gap-1 px-2 pb-1 pt-2">
                  <FontSizeControl percent={scalePercent} />
                  {onStartEdit && (
                    <NeonButton onClick={onStartEdit} aria-label="Editar zettel">
                      EDIT
                    </NeonButton>
                  )}
                  {readingMenu.length > 0 && <ActionsMenu items={readingMenu} />}
                </div>
              )}
              <div data-card-scroll className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain ${pad} pb-2 ${compact ? 'pt-1' : 'pt-4'}`}>
                {!compact && (
                  <div className="flex items-center justify-end gap-3">
                    <div className="flex flex-none items-center gap-2">
                      <FontSizeControl percent={scalePercent} />
                      {onBack && (
                        <NeonButton onClick={onBack} aria-label="Voltar ao zettel anterior">
                          ← VOLTAR
                        </NeonButton>
                      )}
                      {onStartEdit && (
                        <NeonButton onClick={onStartEdit} aria-label="Editar zettel">
                          EDIT
                        </NeonButton>
                      )}
                    </div>
                  </div>
                )}
                <h1
                  className="zk-display m-0 mb-3 mt-1 font-normal leading-none"
                  style={{ color: 'var(--zk-title-color)', fontSize: 'calc(var(--zk-title-size) * var(--zk-read-scale, 1))' }}
                >
                  {title}
                </h1>
                {bodyStatus === 'loading' && <p className="zk-display text-[length:calc(20px*var(--zk-read-scale,1))] text-zk-dim">carregando…</p>}
                {bodyStatus === 'missing' && (
                  <p className="zk-display text-[length:calc(20px*var(--zk-read-scale,1))] text-zk-dim">Corpo ainda não baixado neste aparelho.</p>
                )}
                {(bodyStatus === 'ready' || bodyStatus === 'stale') && (
                  <div className="zk-md dark cursor-default lg:max-w-[900px]" onDoubleClick={onBodyDoubleClick}>
                    {body.trim() ? (
                      <MarkdownRenderer
                        body={body}
                        onBodyChange={bodyStatus === 'ready' ? onBodyChange : undefined}
                        onLinkPress={openWikiLink}
                      />
                    ) : (
                      <p className="zk-display text-[length:calc(20px*var(--zk-read-scale,1))] text-zk-dim">
                        {onStartEdit ? 'Sem conteúdo. Dê dois cliques para escrever.' : 'Sem conteúdo.'}
                      </p>
                    )}
                  </div>
                )}
                {notice && <p className="zk-display mt-3 text-[length:calc(18px*var(--zk-read-scale,1))] text-zk-amber">{notice}</p>}
                {tags.length > 0 && (
                  <div className="zk-tag mt-4 flex flex-wrap gap-x-3 text-[length:calc(22px*var(--zk-read-scale,1))]">
                    {tags.map((t) => (
                      <span key={t}>[{t}]</span>
                    ))}
                  </div>
                )}
              </div>
              {!compact && actions}
              {!compact && (
                <StatusBar
                  left={`${code} · ${onStartEdit ? 'duplo clique no texto ou no diagrama para editar' : 'ABRIR EM FOCO para editar'}`}
                  right={
                    <>
                      <span className="text-zk-green">{linkCount}</span> ligações{meta ? ` · ${editedAgo(meta.updatedAt)}` : ''}
                    </>
                  }
                />
              )}
            </>
          )}
          {editing && (
            <>
              {/* Mesma linha de controles da leitura: só o botão troca (EDIT → CONCLUIR). */}
              <div className={`flex flex-none items-center justify-end gap-3 pt-4 ${pad}`}>
                <div className="flex flex-none items-center gap-2">
                  <FontSizeControl percent={scalePercent} />
                  <NeonButton variant="hot" onClick={() => void finish()}>
                    {isMobile ? 'OK' : 'CONCLUIR [ESC]'}
                  </NeonButton>
                </div>
              </div>
              <div className="zk-edit flex min-h-0 flex-1 flex-col overflow-hidden">
                {zettel ? (
                  <InplaceEditor
                    ref={editorRef}
                    zettel={zettel}
                    variant={isMobile ? 'mobile' : 'card'}
                    autoFocusTitle={focusTitle}
                    initialCaret={caretRef.current}
                    renderedBlocks
                    onStatus={setSave}
                    onCreateLink={(t) => createLinked(t, meta?.title)}
                    onOpenWikiLink={openWikiLink}
                  />
                ) : (
                  <p className={`zk-display text-[length:calc(20px*var(--zk-read-scale,1))] text-zk-dim ${pad} py-4`}>carregando…</p>
                )}
              </div>
              <StatusBar
                mode="edit"
                left={
                  <>
                    -- INSERIR -- <span className="zk-caret" />
                  </>
                }
                right={`${saveLabel(save)} · ${code}`.replace(/^ · /, '')}
              />
            </>
          )}
          {paper && (
            <>
              {/* Sem EDIT/CONCLUIR: a página já é o editor. */}
              <div className={`flex flex-none items-center justify-end gap-3 pt-4 ${pad}`}>
                <div className="flex flex-none items-center gap-2">
                  <FontSizeControl percent={scalePercent} />
                  {onBack && (
                    <NeonButton onClick={onBack} aria-label="Voltar ao zettel anterior">
                      ← VOLTAR
                    </NeonButton>
                  )}
                </div>
              </div>
              <div
                ref={editRootRef}
                className="zk-edit relative flex min-h-0 flex-1 flex-col overflow-hidden"
                onFocus={() => setFocused(true)}
                onBlur={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                  focusedRef.current = false;
                  setFocused(false);
                  if (pendingReloadRef.current) reloadIfClean();
                }}
              >
                {!editorShown && (
                  // Placeholder com a geometria do editor (head + rolagem): a troca não desloca o texto.
                  <div className="flex h-full min-h-0 flex-col" aria-busy={paperReady}>
                    <div data-zettel-head>
                      <div data-zettel-title className="truncate">
                        {meta?.title.trim() ? meta.title : ' '}
                      </div>
                    </div>
                    <div data-card-scroll className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-3">
                      {(bodyStatus === 'ready' || bodyStatus === 'stale') && body.trim() && (
                        <div className="zk-md dark cursor-text">
                          <MarkdownRenderer body={body} onLinkPress={openWikiLink} />
                        </div>
                      )}
                      {bodyStatus === 'missing' && (
                        <p className="zk-display text-[length:calc(20px*var(--zk-read-scale,1))] text-zk-dim">Corpo ainda não baixado neste aparelho.</p>
                      )}
                      {notice && <p className="zk-display mt-3 text-[length:calc(18px*var(--zk-read-scale,1))] text-zk-amber">{notice}</p>}
                    </div>
                  </div>
                )}
                {editorMounted && zettel && (
                  <div className={editorShown ? 'flex min-h-0 flex-1 flex-col' : 'pointer-events-none invisible absolute inset-0 flex flex-col'}>
                    <InplaceEditor
                      key={editorKey}
                      ref={editorRef}
                      zettel={zettel}
                      variant="card"
                      autoFocus={false}
                      renderedBlocks
                      onStatus={setSave}
                      onReady={() => setReadyKey(editorKey)}
                      onCreateLink={(t) => createLinked(t, meta?.title)}
                      onOpenWikiLink={openWikiLink}
                    />
                  </div>
                )}
              </div>
              {actions}
              <StatusBar
                mode="read"
                left={
                  focused ? (
                    <>
                      -- INSERIR -- <span className="zk-caret" />
                    </>
                  ) : (
                    `${code} · clique no texto para escrever`
                  )
                }
                right={
                  <>
                    {saveLabel(save) ? `${saveLabel(save)} · ` : ''}
                    <span className="text-zk-green">{linkCount}</span> ligações{meta ? ` · ${editedAgo(meta.updatedAt)}` : ''}
                  </>
                }
              />
            </>
          )}
        </div>
        {side}
      </div>
    </Win>
  );
}
