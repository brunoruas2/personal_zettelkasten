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
import { NeonButton, StatusBar, TitleBar, Win } from '../zkos';
import { EDIT_ACCENT, useLevelsEnv } from './LevelsContext';
import { saveLabel, zkCode } from './format';

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

export interface ZettelWindowProps {
  id: string;
  /** Cor do cluster (a janela vira âmbar enquanto edita). */
  accent: string;
  editing: boolean;
  onStartEdit: () => void;
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
  /** Botões fixos acima do rodapé (Memória: abrir em foco, fechar). */
  actions?: ReactNode;
  /** Coluna à direita (Foco no desktop: conexões). */
  side?: ReactNode;
  className?: string;
  style?: CSSProperties;
  label?: string;
  /** Celular no Foco: sem barra de título nem rodapé, só o zettel. */
  compact?: boolean;
}

/**
 * Janela de um zettel: leitura (MarkdownRenderer) e edição (InplaceEditor) no
 * mesmo lugar. Clicar no texto ou num diagrama, ou "Editar", entra em
 * edição; "Concluir"/Esc grava e volta à leitura.
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
  side,
  className = '',
  style,
  label,
  compact = false,
}: ZettelWindowProps) {
  const { isMobile, resolveTitle, createLinked } = useLevelsEnv();
  const zettels = useZettelStore((s) => s.zettels);
  const meta = useMemo(() => indexById(zettels).get(id), [zettels, id]);
  const { body, status: bodyStatus } = useZettelBody(id);

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
  const editorRef = useRef<InplaceEditorHandle>(null);
  const stopRef = useRef(onStopEdit);
  stopRef.current = onStopEdit;

  // Entrou em edição: carrega o zettel inteiro. Corpo desatualizado não edita
  // (escrever dele sobrescreveria a versão de outro aparelho).
  useEffect(() => {
    if (!editing) {
      setZettel(null);
      setSave('idle');
      return;
    }
    let cancelled = false;
    void loadZettel(id).then(({ zettel: z, stale }) => {
      if (cancelled) return;
      if (!z) {
        stopRef.current();
      } else if (stale) {
        setNotice('Corpo desatualizado neste aparelho. Aguarde o sync para editar.');
        stopRef.current();
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
  }, [editing, id]);

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

  const finish = useCallback(async () => {
    const empty = editorRef.current?.isEmpty() ?? false;
    await flushActiveEdit();
    onStopEdit();
    onFinished?.({ empty });
  }, [onStopEdit, onFinished]);

  // Esc encerra a edição (popups do editor e o modal de desenho consomem o seu).
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) void finish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, finish]);

  const onBodyClick = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('a,button,input,textarea,summary,[data-no-edit]')) return;
    if (window.getSelection()?.toString()) return;
    onStartEdit();
  };

  const title = meta?.title.trim() ? meta.title : 'Sem título';
  const tags = meta?.tags ?? [];
  const code = zkCode(id);
  const pad = isMobile ? 'px-3' : 'px-14';
  const winAccent = editing ? EDIT_ACCENT : accent;

  const header = `${code} — ${title.toUpperCase()}${editing ? ' · EDITANDO' : titleSuffix ? ` · ${titleSuffix}` : ''}`;

  return (
    <Win accent={winAccent} label={label ?? title} className={className} style={style}>
      {!(compact && !editing) && <TitleBar>{header}</TitleBar>}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!editing && (
            <>
              <div data-card-scroll className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${pad} pb-2 pt-4`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="zk-tag flex flex-wrap gap-x-3 text-[22px]">
                    {tags.map((t) => (
                      <span key={t}>[{t}]</span>
                    ))}
                  </div>
                  <div className="flex flex-none gap-2">
                    {onBack && (
                      <NeonButton onClick={onBack} aria-label="Voltar ao zettel anterior">
                        {compact ? '←' : '← VOLTAR'}
                      </NeonButton>
                    )}
                    <NeonButton onClick={onStartEdit} aria-label="Editar zettel">
                      EDITAR
                    </NeonButton>
                    {compact && actions}
                  </div>
                </div>
                <h1
                  className="zk-display m-0 mb-3 mt-1 font-normal leading-none"
                  style={{ color: accent, fontSize: compact ? 32 : isMobile ? 46 : 78 }}
                >
                  {title}
                </h1>
                {bodyStatus === 'loading' && <p className="zk-display text-xl text-zk-dim">carregando…</p>}
                {bodyStatus === 'missing' && (
                  <p className="zk-display text-xl text-zk-dim">Corpo ainda não baixado neste aparelho.</p>
                )}
                {(bodyStatus === 'ready' || bodyStatus === 'stale') && (
                  <div className="zk-md dark cursor-text text-[20px] leading-[1.5] lg:max-w-[900px] lg:text-[23px]" onClick={onBodyClick}>
                    {body.trim() ? (
                      <MarkdownRenderer
                        body={body}
                        onBodyChange={bodyStatus === 'ready' ? onBodyChange : undefined}
                        onLinkPress={(t) => {
                          const target = resolveTitle(t);
                          if (target) onOpenLink(target);
                        }}
                      />
                    ) : (
                      <p className="zk-display text-xl text-zk-dim">Sem conteúdo. Clique para escrever.</p>
                    )}
                  </div>
                )}
                {notice && <p className="zk-display mt-3 text-lg text-zk-amber">{notice}</p>}
              </div>
              {!compact && actions}
              {!compact && (
                <StatusBar
                  left={`${code} · clique no texto ou no diagrama para editar`}
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
              <div className={`flex flex-none items-center justify-between gap-2 border-b border-zk-line py-2 ${isMobile ? 'px-3' : 'px-10'}`}>
                <span className="zk-display text-xl text-zk-amber">EDITANDO</span>
                <NeonButton variant="hot" onClick={() => void finish()}>
                  {isMobile ? 'OK' : 'CONCLUIR [ESC]'}
                </NeonButton>
              </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {zettel ? (
                  <InplaceEditor
                    ref={editorRef}
                    zettel={zettel}
                    variant={isMobile ? 'mobile' : 'card'}
                    autoFocusTitle={focusTitle}
                    onStatus={setSave}
                    onCreateLink={createLinked}
                  />
                ) : (
                  <p className={`zk-display text-xl text-zk-dim ${pad} py-4`}>carregando…</p>
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
        </div>
        {side}
      </div>
    </Win>
  );
}
