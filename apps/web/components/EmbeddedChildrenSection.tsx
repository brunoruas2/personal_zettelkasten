'use client';

import type { Zettel } from '@zettelkasten/core';
import { EmbeddedZettel } from './EmbeddedZettel';

interface Props {
  zettels: Zettel[];
  isOpen: (id: string) => boolean;
  onCollapse: (id: string) => void;
  onChildTitleChanged?: (oldTitle: string, newTitle: string) => void;
}

/**
 * Faixas dos filhos abertos, na ordem em que aparecem no corpo do pai. Vive
 * dentro do container de rolagem do pai; `data-toc-ignore` tira os headings
 * dos filhos do Sumário do pai.
 */
export function EmbeddedChildrenSection({ zettels, isOpen, onCollapse, onChildTitleChanged }: Props) {
  const open = zettels.filter((c) => isOpen(c.id));
  if (open.length === 0) return null;
  return (
    <section data-toc-ignore="" aria-label="Zettels embutidos" className="mt-8 space-y-4">
      {open.map((c) => (
        <EmbeddedZettel
          key={c.id}
          zettel={c}
          onCollapse={() => onCollapse(c.id)}
          onTitleChanged={onChildTitleChanged}
        />
      ))}
    </section>
  );
}
