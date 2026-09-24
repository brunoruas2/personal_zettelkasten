'use client';

import { useCallback, useMemo } from 'react';
import { useEmbeddedChildren } from './useEmbeddedChildren';
import { useEmbedHosts } from './useEmbedHosts';
import { EmbedActionButton } from '../components/EmbeddedZettel';
import type { EmbedHoverBridge } from '../lib/embedHoverExtension';

interface Options {
  parentId: string;
  body: string;
  /** Modo visível. O leitor só tem Preview: passe `true`. */
  previewOpen: boolean;
  /**
   * true no leitor: a relação pai→filho vem da tabela de links persistida. false
   * nos editores, onde o corpo em edição (ainda não salvo) é a verdade.
   */
  useLinkTable?: boolean;
  /** Desliga tudo (formulário embutido não embute filhos: um nível só). */
  disabled?: boolean;
  /** Um filho foi renomeado: `[[antigo]]` deve ser reescrito no corpo do pai. */
  onChildRenamed: (oldTitle: string, newTitle: string) => void;
}

/**
 * Cola do recurso de zettels embutidos, compartilhada pelo leitor e pelos dois
 * formulários de edição: estado (filhos, toggle global, abertos/fechados), a
 * ação de hover para o Preview e o TipTap, os slots onde as faixas ancoram e os
 * portais que as renderizam.
 */
export function useEmbeds({
  parentId,
  body,
  previewOpen,
  useLinkTable = false,
  disabled,
  onChildRenamed,
}: Options) {
  const embed = useEmbeddedChildren({
    parentId,
    body: disabled ? '' : body,
    useLinkTable,
  });
  const { childForTitle, isOpen, toggleChild } = embed;

  const { registry, portals, embedSlot } = useEmbedHosts({
    embed,
    mode: previewOpen ? 'preview' : 'edit',
    onTitleChanged: onChildRenamed,
  });

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
        ? { resolve: childForTitle, isOpen, toggle: toggleChild, registry }
        : undefined,
    [embed.hasChildren, childForTitle, isOpen, toggleChild, registry],
  );

  return { embed, wikiLinkAction, embedSlot, bridge, portals };
}
