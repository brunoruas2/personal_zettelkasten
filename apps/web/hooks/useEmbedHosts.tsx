'use client';

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { EmbedSlotAnchor } from '../components/EmbedSlotAnchor';
import { EmbeddedZettel } from '../components/EmbeddedZettel';
import { EmbedSlotRegistry, type EmbedMode } from '../lib/embedSlots';
import type { EmbeddedChildrenState } from './useEmbeddedChildren';

interface Options {
  embed: EmbeddedChildrenState;
  /** Modo visível: em qual slot cada faixa deve estar. */
  mode: EmbedMode;
  onTitleChanged?: (oldTitle: string, newTitle: string) => void;
}

/**
 * Ancora as faixas dos filhos abertos nos slots do texto.
 *
 * Cada filho aberto tem UM host DOM persistente e UMA `EmbeddedZettel`,
 * renderizada por portal dentro do host. O host é o que se move: para o slot do
 * modo visível, ou para lugar nenhum quando não há slot. Como a identidade do
 * host não muda, o React nunca desmonta a faixa — um formulário de filho em
 * edição sobrevive à troca Editar/Preview do pai e à recriação do widget do
 * ProseMirror. (Renderizar a faixa direto em cada modo duplicaria o formulário
 * do filho, já que Preview e TipTap ficam montados juntos.)
 */
export function useEmbedHosts({ embed, mode, onTitleChanged }: Options) {
  const [registry] = useState(() => new EmbedSlotRegistry());
  const hostsRef = useRef(new Map<string, HTMLDivElement>());
  const [, setTick] = useState(0);
  const { children, isOpen, childForTitle } = embed;

  const open = children.filter((c) => isOpen(c.id));
  const hosts = hostsRef.current;
  if (typeof document !== 'undefined') {
    for (const c of open) {
      if (!hosts.has(c.id)) hosts.set(c.id, document.createElement('div'));
    }
  }

  // Layout effect, não effect: os slots se registram no layout effect dos filhos
  // e o de um ancestral roda depois; o registro já está preenchido quando este
  // lê. Sem lista de deps de propósito — é barato e precisa reposicionar a cada
  // render (modo, abertura/fechamento, slots que mudaram).
  useLayoutEffect(() => {
    const openIds = new Set(open.map((c) => c.id));
    for (const [id, host] of hosts) {
      if (!openIds.has(id)) {
        host.remove();
        hosts.delete(id);
        continue;
      }
      const slot = registry.get(mode, id);
      if (slot) {
        if (host.parentElement !== slot) slot.appendChild(host);
      } else if (host.parentElement) {
        host.remove();
      }
    }
  });

  // Slot registrado ou removido fora de um render do React (o widget do
  // ProseMirror) precisa provocar um render para o efeito acima reposicionar.
  useLayoutEffect(() => registry.subscribe(() => setTick((t) => t + 1)), [registry]);

  const portals: ReactNode = open.map((c) => {
    const host = hosts.get(c.id);
    if (!host) return null;
    return createPortal(
      <EmbeddedZettel
        zettel={c}
        onCollapse={() => embed.toggleChild(c.id)}
        onTitleChanged={onTitleChanged}
      />,
      host,
      c.id,
    );
  });

  /** Para o `MarkdownRenderer`: âncora só para filho aberto cujo título resolve. */
  const embedSlot = useCallback(
    (titles: string[]): ReactNode => {
      const anchors: ReactNode[] = [];
      for (const t of titles) {
        const child = childForTitle(t);
        if (child && isOpen(child.id)) {
          anchors.push(<EmbedSlotAnchor key={child.id} registry={registry} mode="preview" id={child.id} />);
        }
      }
      return anchors.length > 0 ? anchors : null;
    },
    [childForTitle, isOpen, registry],
  );

  return { registry, portals, embedSlot };
}
