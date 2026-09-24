'use client';

import { useLayoutEffect, useRef } from 'react';
import type { EmbedMode, EmbedSlotRegistry } from '../lib/embedSlots';

/**
 * Ponto de ancoragem emitido pelo `MarkdownRenderer` depois do bloco que contém
 * a referência. O React não gerencia os filhos deste `<div>`: a faixa do filho é
 * movida para dentro dele por DOM (`useEmbedHosts`), e re-renderizar a âncora
 * não a toca.
 */
export function EmbedSlotAnchor({
  registry,
  mode,
  id,
}: {
  registry: EmbedSlotRegistry;
  mode: EmbedMode;
  id: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    registry.register(mode, id, el);
    return () => registry.unregister(mode, id, el);
  }, [registry, mode, id]);
  return <div ref={ref} data-embed-slot="" />;
}
