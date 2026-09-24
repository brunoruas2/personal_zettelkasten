'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEmbeddedChildren } from './useEmbeddedChildren';
import { EmbedActionButton } from '../components/EmbeddedZettel';
import { EmbeddedChildrenSection } from '../components/EmbeddedChildrenSection';
import type { EmbedHoverBridge } from '../lib/embedHoverExtension';

interface Options {
  parentId: string;
  body: string;
  /** Modo atual do editor: decide em qual slot a seção fica. */
  previewOpen: boolean;
  /** Desliga tudo (formulário embutido não embute filhos: um nível só). */
  disabled?: boolean;
  /** Um filho foi renomeado: `[[antigo]]` deve ser reescrito no corpo local do pai. */
  onChildRenamed: (oldTitle: string, newTitle: string) => void;
}

/**
 * Cola do recurso de zettels embutidos nas páginas de criação/edição: o mesmo
 * estado para o Preview (hover no `MarkdownRenderer`), o Editar (hover no
 * TipTap) e a seção de faixas. Os filhos vêm do corpo em edição, não da tabela
 * de links.
 */
export function useEditorEmbeds({ parentId, body, previewOpen, disabled, onChildRenamed }: Options) {
  const embed = useEmbeddedChildren({
    parentId,
    body: disabled ? '' : body,
    useLinkTable: false,
  });
  const { childForTitle, isOpen, toggleChild } = embed;

  const wikiLinkAction = useCallback(
    (title: string) => {
      const child = childForTitle(title);
      if (!child) return null;
      return <EmbedActionButton open={isOpen(child.id)} onToggle={() => toggleChild(child.id)} />;
    },
    [childForTitle, isOpen, toggleChild],
  );

  const bridge = useMemo<EmbedHoverBridge | undefined>(
    () =>
      embed.hasChildren
        ? { resolve: childForTitle, isOpen, toggle: toggleChild }
        : undefined,
    [embed.hasChildren, childForTitle, isOpen, toggleChild],
  );

  // O Preview e o TipTap ficam os dois montados (só `hidden` alterna). Renderizar
  // a seção em cada um duplicaria as faixas — dois formulários de filho em
  // paralelo, e o estado de edição se perderia ao trocar de modo. A seção é
  // renderizada uma vez, por portal, num host DOM persistente que é MOVIDO para
  // o slot do modo visível: a identidade do host não muda, então o React não
  // desmonta nada.
  const previewSlotRef = useRef<HTMLDivElement>(null);
  const editorSlotRef = useRef<HTMLDivElement>(null);
  const [host] = useState<HTMLDivElement | null>(() =>
    typeof document === 'undefined' ? null : document.createElement('div'),
  );
  useLayoutEffect(() => {
    const slot = previewOpen ? previewSlotRef.current : editorSlotRef.current;
    if (host && slot && host.parentElement !== slot) slot.appendChild(host);
  }, [host, previewOpen]);

  const portal =
    host &&
    createPortal(
      <EmbeddedChildrenSection
        zettels={embed.children}
        isOpen={embed.isOpen}
        onCollapse={embed.toggleChild}
        onChildTitleChanged={onChildRenamed}
      />,
      host,
    );

  return { embed, wikiLinkAction, bridge, portal, previewSlotRef, editorSlotRef };
}
