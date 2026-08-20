'use client';

import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { TipTapEditorHandle } from '../components/TipTapEditor';

/**
 * Preserva a posição de leitura ao alternar entre edição e preview.
 *
 * A âncora é o índice do heading: edição e preview têm alturas bem diferentes
 * para o mesmo conteúdo (um bloco de código ou uma tabela não ocupa o mesmo
 * espaço nos dois), então a seção é a granularidade em que as duas visões
 * concordam. A fração de scroll só entra quando não há heading acima da
 * posição.
 *
 * Substitui o mecanismo anterior, que convertia posição de cursor em fração de
 * linhas do markdown: isso não sobreviveu à migração do textarea para o TipTap
 * — a posição do ProseMirror só vira offset de markdown reproduzindo o
 * serializador — e tinha ficado travado em zero, mandando o preview ao topo em
 * toda entrada.
 */

interface Anchor {
  /** Índice do heading em `querySelectorAll('h1, h2, h3')`; -1 antes do primeiro. */
  index: number;
  /** Fração de rolagem do container, usada quando não há heading acima. */
  fraction: number;
}

/** Silêncio necessário no `visualViewport` para considerar o layout assentado. */
const SETTLE_MS = 100;
/** Teto de espera, para o caso de o viewport nunca mudar (desktop). */
const FALLBACK_MS = 500;

function headingsOf(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('h1, h2, h3'));
}

function readAnchor(container: HTMLElement): Anchor {
  const containerTop = container.getBoundingClientRect().top;
  const headings = headingsOf(container);

  let index = -1;
  for (let i = 0; i < headings.length; i++) {
    // 1px de folga: o heading alinhado ao topo às vezes mede -0.5.
    if (headings[i].getBoundingClientRect().top > containerTop + 1) break;
    index = i;
  }

  const scrollable = Math.max(1, container.scrollHeight - container.clientHeight);
  return { index, fraction: container.scrollTop / scrollable };
}

function applyAnchor(container: HTMLElement, anchor: Anchor) {
  const headings = headingsOf(container);
  const target = anchor.index >= 0 ? headings[anchor.index] : undefined;

  if (target) {
    // Diferença de rects, não `offsetTop`: dentro do ProseMirror o
    // `offsetParent` do heading não é o container de scroll.
    container.scrollTop += target.getBoundingClientRect().top - container.getBoundingClientRect().top;
    return;
  }
  container.scrollTop = anchor.fraction * Math.max(0, container.scrollHeight - container.clientHeight);
}

interface Params {
  previewOpen: boolean;
  previewRef: RefObject<HTMLDivElement | null>;
  editorScrollRef: RefObject<HTMLDivElement | null>;
  editorRef: RefObject<TipTapEditorHandle | null>;
}

export function useEditorModeScrollSync({
  previewOpen,
  previewRef,
  editorScrollRef,
  editorRef,
}: Params) {
  const anchorRef = useRef<Anchor | null>(null);

  // Precisa rodar antes do `setPreviewOpen`: depois da troca o container de
  // saída está em `display:none`, com scrollHeight e rects zerados.
  const captureAnchor = useCallback(() => {
    const leaving = previewOpen ? previewRef.current : editorScrollRef.current;
    anchorRef.current = leaving ? readAnchor(leaving) : null;
  }, [previewOpen, previewRef, editorScrollRef]);

  useEffect(() => {
    const entering = previewOpen ? previewRef.current : editorScrollRef.current;

    // Voltando para a edição o foco é devolvido sem rolagem — `focus()` sem
    // opções focaria no início do documento e desfaria a restauração.
    if (!previewOpen) editorRef.current?.focus({ scrollIntoView: false });

    const anchor = anchorRef.current;
    if (!entering || !anchor) return;

    // No mobile o teclado ainda está fechando quando o efeito dispara, e medir
    // no meio da transição dá altura errada. Espera o viewport parar, com teto
    // para o desktop, onde o evento nunca vem.
    let done = false;
    let settleTimer: ReturnType<typeof setTimeout>;
    const vv = window.visualViewport;

    const restore = () => {
      if (done) return;
      done = true;
      vv?.removeEventListener('resize', onResize);
      clearTimeout(settleTimer);
      clearTimeout(fallbackTimer);
      applyAnchor(entering, anchor);
    };

    const onResize = () => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(restore, SETTLE_MS);
    };

    vv?.addEventListener('resize', onResize);
    const fallbackTimer = setTimeout(restore, FALLBACK_MS);

    return () => {
      done = true;
      vv?.removeEventListener('resize', onResize);
      clearTimeout(settleTimer);
      clearTimeout(fallbackTimer);
    };
  }, [previewOpen, previewRef, editorScrollRef, editorRef]);

  return { captureAnchor };
}
